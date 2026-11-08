import {
	parseForkParent,
	repoApiUrl,
	type ForkInfo,
	type ForkSyncResult,
} from "../core/fork.ts";
import { mergeArgs, rebaseArgs } from "../core/ops.ts";
import {
	authHeaders,
	remoteIdentity,
	type Account,
} from "../core/providers.ts";
import { credentialEnvFor, repoAccountChoice, tokenFor } from "./accounts.ts";
import { runGit } from "./git.ts";
import { originRemote, remoteUrl } from "./remote.ts";

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

export async function syncFork(
	root: string,
	mode: "merge" | "rebase"
): Promise<ForkSyncResult> {
	const info = await forkInfo(root);
	if (!info.parent)
		throw new Error(
			"Questo repository non risulta un fork: non c'è un originale con cui sincronizzarsi."
		);

	const branch = (
		await runGit(root, ["symbolic-ref", "--short", "-q", "HEAD"], {
			allowFailure: true,
		})
	).stdout.trim();
	if (!branch)
		throw new Error(
			"HEAD è staccato: torna su un ramo prima di sincronizzare con l'originale."
		);

	const { identity } = await context(root);

	let upstreamUrl = info.upstreamUrl;
	let created = false;
	if (!upstreamUrl) {
		await runGit(root, ["remote", "add", "upstream", info.parent.cloneUrl]);
		upstreamUrl = info.parent.cloneUrl;
		created = true;
	}
	// il remoto già configurato può puntare altrove (un mirror): si usa quello, non si riscrive
	await runGit(root, ["fetch", "upstream", "--prune"], {
		timeoutMs: 180_000,
		env: (await credentialEnvFor(identity.host, root)) ?? undefined,
	});

	const upstreamRef = `upstream/${info.parent.defaultBranch}`;
	const exists = await runGit(
		root,
		["rev-parse", "--verify", "--quiet", `refs/remotes/${upstreamRef}`],
		{ allowFailure: true }
	);
	if (exists.code !== 0)
		throw new Error(
			`Il remoto upstream non ha il ramo «${info.parent.defaultBranch}».`
		);

	await runGit(
		root,
		mode === "merge" ? mergeArgs(upstreamRef) : rebaseArgs(upstreamRef),
		{
			timeoutMs: 180_000,
		}
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
		upstreamRef,
		upstreamUrl,
		behind: behind ?? 0,
		ahead: ahead ?? 0,
		created,
	};
}
