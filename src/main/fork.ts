import {
	checkRemoteUrl,
	parseForkParent,
	parseRemoteBranches,
	repoApiUrl,
	type ForkInfo,
	type ForkPending,
	type ForkSyncResult,
	type UpstreamLocal,
} from "../core/fork.ts";
import { assertRefName, mergeArgs, rebaseArgs } from "../core/ops.ts";
import {
	authHeaders,
	remoteIdentity,
	type Account,
} from "../core/providers.ts";
import { credentialEnvFor, repoAccountChoice, tokenFor } from "./accounts.ts";
import { runGit } from "./git.ts";
import { listRemotes, originRemote, remoteUrl } from "./remote.ts";

/**
 * Fork: riconoscere l'originale e sincronizzarsi con lui.
 *
 * Un fork è un repository GitHub/GitLab/… che ha un `parent`: l'informazione sta nell'API, non
 * nel repository. Per sincronizzarsi serve un remoto `upstream` (creato qui la prima volta) e poi
 * un `fetch` + `merge`/`rebase` del ramo predefinito dell'originale. Nessuna forza, nessuna
 * riscrittura silenziosa: se il merge non è possibile Git lo dice e l'operazione resta annullabile.
 */

async function context(root: string): Promise<{
	identity: NonNullable<ReturnType<typeof remoteIdentity>>;
	account: Account;
	token: string;
}> {
	const remote = await originRemote(root);
	const identity = remote ? remoteIdentity(remote) : null;
	if (!identity)
		throw new Error(
			"Il remoto «origin» non è un repository su un servizio web."
		);
	const choice = await repoAccountChoice(root);
	const account = choice.account;
	if (!account)
		throw new Error(
			`Serve un account ${identity.host}: collegalo negli account e riprova.`
		);
	const token = await tokenFor(account);
	if (!token)
		throw new Error(
			`Token non disponibile per ${account.username}: reinseriscilo nell'account.`
		);
	return { identity, account, token };
}

/** Interroga l'API del repository e dice se è un fork e qual è l'originale. */
export async function forkInfo(root: string): Promise<ForkInfo> {
	const { identity, account, token } = await context(root);
	let payload: unknown = null;
	try {
		const response = await fetch(
			repoApiUrl(account, identity.namespace, identity.name),
			{
				headers: authHeaders(account, token),
				signal: AbortSignal.timeout(20_000),
			}
		);
		if (response.status === 401 || response.status === 403)
			throw new Error(
				"Token non valido o scaduto: aggiornalo nell'account."
			);
		if (!response.ok)
			throw new Error(
				`${account.host}: ${response.status} ${response.statusText}`
			);
		payload = await response.json().catch(() => null);
	} catch (error) {
		if (
			error instanceof Error &&
			/Token non valido|non risponde/.test(error.message)
		)
			throw error;
		if (error instanceof Error && /^\S+: \d{3}/.test(error.message))
			throw error;
		throw new Error(
			`${account.host} non raggiungibile: ${
				error instanceof Error ? error.message : String(error)
			}`
		);
	}
	return {
		host: identity.host,
		namespace: identity.namespace,
		name: identity.name,
		parent: parseForkParent(account.provider, payload),
		upstreamUrl: await remoteUrl(root, "upstream"),
		accountId: account.id,
	};
}

/** Il remoto `upstream` esiste già o viene aggiunto ora; un mirror configurato non si riscrive. */
async function ensureUpstream(
	root: string,
	info: ForkInfo
): Promise<{ url: string; created: boolean }> {
	if (!info.parent)
		throw new Error(
			"Questo repository non risulta un fork: non c'è un originale con cui sincronizzarsi."
		);
	if (info.upstreamUrl) return { url: info.upstreamUrl, created: false };
	await runGit(root, ["remote", "add", "upstream", info.parent.cloneUrl]);
	return { url: info.parent.cloneUrl, created: true };
}

/**
 * Il remoto `upstream` come sta sul disco. Niente rete: la finestra mostra subito questo, e
 * l'originale arriva dopo dall'API.
 */
export async function upstreamRemotes(root: string): Promise<UpstreamLocal> {
	const [url, remotes] = await Promise.all([
		remoteUrl(root, "upstream"),
		listRemotes(root),
	]);
	return { url, remotes };
}

/**
 * Crea il remoto `upstream` o ne cambia l'indirizzo. Nessun commit, nessun ramo, nessun altro
 * remoto viene toccato: è solo la configurazione di dove sta l'originale.
 */
export async function setUpstream(
	root: string,
	url: string
): Promise<UpstreamLocal> {
	const value = checkRemoteUrl(url);
	const existing = await remoteUrl(root, "upstream");
	await runGit(
		root,
		existing
			? ["remote", "set-url", "upstream", value]
			: ["remote", "add", "upstream", value]
	);
	return upstreamRemotes(root);
}

/**
 * Toglie il remoto `upstream`. Se ne vanno la configurazione e i ref già scaricati da lì
 * (`refs/remotes/upstream/*`); rami locali e commit restano, e basta riaggiungerlo e fare `fetch`
 * per riavere gli stessi riferimenti.
 */
export async function removeUpstream(root: string): Promise<UpstreamLocal> {
	if (!(await remoteUrl(root, "upstream")))
		throw new Error("Nessun remoto «upstream» da togliere.");
	await runGit(root, ["remote", "remove", "upstream"]);
	return upstreamRemotes(root);
}

/** Rami disponibili sull'originale: `ls-remote` non scarica gli oggetti e non tocca la storia. */
export async function forkBranches(root: string): Promise<string[]> {
	const info = await forkInfo(root);
	const { identity } = await context(root);
	await ensureUpstream(root, info);
	const result = await runGit(root, ["ls-remote", "--heads", "upstream"], {
		timeoutMs: 60_000,
		env: (await credentialEnvFor(identity.host, root)) ?? undefined,
	});
	return parseRemoteBranches(result.stdout);
}

interface PreparedFork {
	branch: string;
	localBranch: string;
	upstreamRef: string;
	upstreamUrl: string;
	created: boolean;
	behind: number;
	ahead: number;
}

/**
 * Fa la parte comune di anteprima e sync: remoto, fetch, verifica del ramo scelto e conteggi.
 * Il fetch è uno solo per chiamata; l'anteprima non modifica la storia.
 */
async function prepareFork(
	root: string,
	requested?: string
): Promise<PreparedFork> {
	const info = await forkInfo(root);
	if (!info.parent)
		throw new Error(
			"Questo repository non risulta un fork: non c'è un originale con cui sincronizzarsi."
		);

	const localBranch = (
		await runGit(root, ["symbolic-ref", "--short", "-q", "HEAD"], {
			allowFailure: true,
		})
	).stdout.trim();
	if (!localBranch)
		throw new Error(
			"HEAD è staccato: torna su un ramo prima di sincronizzare con l'originale."
		);

	const branch = requested?.trim() || info.parent.defaultBranch;
	assertRefName(branch);
	const { identity } = await context(root);
	const upstream = await ensureUpstream(root, info);
	await runGit(root, ["fetch", "upstream", "--prune"], {
		timeoutMs: 180_000,
		env: (await credentialEnvFor(identity.host, root)) ?? undefined,
	});

	const upstreamRef = `upstream/${branch}`;
	const exists = await runGit(
		root,
		["rev-parse", "--verify", "--quiet", `refs/remotes/${upstreamRef}`],
		{ allowFailure: true }
	);
	if (exists.code !== 0)
		throw new Error(
			`Il remoto upstream non ha il ramo «${branch}».`
		);

	const counts = await runGit(
		root,
		["rev-list", "--left-right", "--count", `${upstreamRef}...HEAD`],
		{ allowFailure: true }
	);
	const [behind, ahead] = counts.stdout
		.trim()
		.split(/\s+/)
		.map((value) => Number.parseInt(value, 10) || 0);

	return {
		branch,
		localBranch,
		upstreamRef,
		upstreamUrl: upstream.url,
		created: upstream.created,
		behind: behind ?? 0,
		ahead: ahead ?? 0,
	};
}

/** Anteprima senza modifiche: ramo scelto, commit in arrivo e commit locali. */
export async function forkPreview(
	root: string,
	branch?: string
): Promise<ForkPending> {
	const prepared = await prepareFork(root, branch);
	return {
		branch: prepared.branch,
		upstreamRef: prepared.upstreamRef,
		upstreamUrl: prepared.upstreamUrl,
		created: prepared.created,
		localBranch: prepared.localBranch,
		behind: prepared.behind,
		ahead: prepared.ahead,
	};
}

export async function syncFork(
	root: string,
	mode: "merge" | "rebase",
	branch?: string
): Promise<ForkSyncResult> {
	const prepared = await prepareFork(root, branch);
	await runGit(
		root,
		mode === "merge"
			? mergeArgs(prepared.upstreamRef)
			: rebaseArgs(prepared.upstreamRef),
		{
			timeoutMs: 180_000,
		}
	);
	return {
		branch: prepared.localBranch,
		upstreamRef: prepared.upstreamRef,
		upstreamUrl: prepared.upstreamUrl,
		behind: prepared.behind,
		ahead: prepared.ahead,
		created: prepared.created,
	};
}
