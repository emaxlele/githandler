import { chmod, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

import {
	accountId,
	ASKPASS_SCRIPT,
	askpassEnv,
	authHeaders,
	chooseRepoAccount,
	credentialInput,
	normalizeAccount,
	parseAccounts,
	parseRemoteRepos,
	reposUrl,
	serializeAccounts,
	assertToken,
	type Account,
	type AccountChoice,
	type RemoteRepo,
} from "../core/providers.ts";
import { runGit } from "./git.ts";
import { githubCliToken } from "./machine-auth.ts";
import { originRemote } from "./remote.ts";
import { loadSettings, saveSettings, settingsDirectory } from "./settings.ts";

/**
 * Account collegati: metadati su disco, token in memoria.
 *
 * GitHandler non scrive token in nessun file proprio. Il token arriva dalla finestra oppure dalla
 * macchina (`gh`, credential helper: `hydrateTokens` lo cerca all'avvio), resta in memoria per la
 * sessione e serve a due cose: le chiamate all'API del provider e `GIT_ASKPASS` per `git clone`,
 * `fetch`, `pull`, `push`. Se l'utente ha un credential helper configurato, un token inserito a mano
 * viene anche consegnato a Git con `git credential approve`: così lo ritrova lui, nel suo archivio,
 * e non l'app. Alla rimozione dell'account il token esce dalla memoria; quel che Git ha salvato
 * resta di Git e non lo cancelliamo di nascosto.
 */

export interface AccountsInfo {
	accounts: Account[];
	/** id degli account con un token disponibile in questa sessione */
	tokens: string[];
	/** Git ha un credential helper? Senza, il token vale solo per la sessione. */
	credentialHelper: boolean;
}

let cache: Account[] | null = null;
const tokens = new Map<string, string>();
/** Ricerche in corso, per account: due richieste insieme non lanciano due volte `gh`. */
const recoveries = new Map<string, Promise<string | null>>();
/** Account per cui la macchina non aveva niente: non si richiede a ogni operazione. */
const noToken = new Set<string>();
let askpassPath: string | null = null;
let helper: boolean | null = null;

export function accountsFile(): string {
	return join(settingsDirectory(), "accounts.json");
}

export async function loadAccounts(): Promise<Account[]> {
	if (cache) return cache;
	try {
		cache = parseAccounts(await readFile(accountsFile(), "utf8"));
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
		cache = [];
	}
	return cache;
}

async function persist(accounts: Account[]): Promise<void> {
	cache = accounts;
	const path = accountsFile();
	await mkdir(dirname(path), { recursive: true });
	const temporary = `${path}.tmp`;
	await writeFile(temporary, serializeAccounts(accounts), {
		encoding: "utf8",
		mode: 0o600,
	});
	await rename(temporary, path);
}

/** Lo script di askpass è generico: legge le credenziali dall'ambiente, non le contiene. */
async function ensureAskpass(): Promise<string> {
	if (askpassPath) return askpassPath;
	const path = join(settingsDirectory(), "askpass.sh");
	await mkdir(dirname(path), { recursive: true });
	let current = "";
	try {
		current = await readFile(path, "utf8");
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
	}
	if (current !== ASKPASS_SCRIPT) {
		await writeFile(path, ASKPASS_SCRIPT, {
			encoding: "utf8",
			mode: 0o700,
		});
	}
	// `writeFile` non cambia i permessi di un file che esiste già
	await chmod(path, 0o700);
	askpassPath = path;
	return path;
}

async function hasCredentialHelper(): Promise<boolean> {
	if (helper !== null) return helper;
	const result = await runGit(
		"/",
		["config", "--get-all", "credential.helper"],
		{
			allowFailure: true,
		}
	);
	helper = result.code === 0 && result.stdout.trim() !== "";
	return helper;
}

/**
 * Cerca un token per l'account già presente sulla macchina. Prima il credential helper, chiesto
 * per **quell'utente**: due account sullo stesso host non si scambiano il token. Poi GitHub CLI,
 * che tiene un token per host e quindi vale solo se l'account su quell'host è uno solo.
 */
async function recoverToken(account: Account): Promise<string | null> {
	const result = await runGit("/", ["credential", "fill"], {
		allowFailure: true,
		timeoutMs: 20_000,
		input: `protocol=https\nhost=${account.host}\nusername=${account.username}\n\n`,
	});
	if (result.code === 0) {
		const match = /^password=(.+)$/m.exec(result.stdout);
		const password = match?.[1]?.trim();
		if (password) return password;
	}

	const accounts = await loadAccounts();
	const sameHost = accounts.filter(
		(item) => item.host.toLowerCase() === account.host.toLowerCase()
	);
	if (sameHost.length > 1) return null;
	const found = await githubCliToken(account.host);
	return found?.token ?? null;
}

/**
 * Token dell'account: quello appena inserito, altrimenti quello già presente sulla macchina. Un
 * esito negativo si ricorda per la sessione, così un'operazione senza token non riapre un helper
 * grafico ogni volta.
 */
export async function tokenFor(account: Account): Promise<string | null> {
	const known = tokens.get(account.id);
	if (known) return known;
	if (noToken.has(account.id)) return null;
	const running = recoveries.get(account.id);
	if (running) return running;
	const recovery = recoverToken(account)
		.then((found) => {
			if (!found) {
				noToken.add(account.id);
				return null;
			}
			tokens.set(account.id, found);
			return found;
		})
		.finally(() => recoveries.delete(account.id));
	recoveries.set(account.id, recovery);
	return recovery;
}

/**
 * All'avvio cerca i token degli account già sulla macchina, così chiudere l'app non obbliga a
 * rifare «Accedi». Parte dopo la finestra e non la blocca: se non c'è niente, si resta senza token
 * fino a un «Accedi» o al prossimo avvio (un esito negativo non si ritenta a ogni operazione).
 */
export async function hydrateTokens(): Promise<void> {
	const accounts = await loadAccounts();
	const results = await Promise.allSettled(
		accounts.map((account) => tokenFor(account))
	);
	for (const result of results) {
		if (result.status === "rejected") {
			console.warn("token non recuperato:", result.reason);
		}
	}
}

export async function accountsInfo(): Promise<AccountsInfo> {
	const accounts = await loadAccounts();
	return {
		accounts,
		tokens: [...tokens.keys()],
		credentialHelper: await hasCredentialHelper(),
	};
}

/** Salva (o aggiorna) un account; il token è facoltativo e non viene mai riscritto su disco. */
export async function saveAccount(
	input: unknown,
	token?: string
): Promise<AccountsInfo> {
	const account = normalizeAccount(input);
	if (!account)
		throw new Error(
			"Account non valido: provider, host e utente sono obbligatori."
		);

	if (token !== undefined && token.trim()) {
		assertToken(token.trim());
		tokens.set(account.id, token.trim());
		noToken.delete(account.id);
		if (await hasCredentialHelper()) {
			await runGit("/", ["credential", "approve"], {
				allowFailure: true,
				input: credentialInput(
					account.host,
					account.username,
					token.trim()
				),
			});
		}
	}

	const accounts = await loadAccounts();
	const index = accounts.findIndex((item) => item.id === account.id);
	if (index >= 0) accounts[index] = account;
	else accounts.push(account);
	await persist(accounts);
	return accountsInfo();
}

export async function removeAccount(id: string): Promise<AccountsInfo> {
	const accounts = await loadAccounts();
	const next = accounts.filter((item) => item.id !== id);
	if (next.length === accounts.length)
		throw new Error("Account non trovato.");
	tokens.delete(id);
	noToken.delete(id);
	await persist(next);
	return accountsInfo();
}

/** Elenco dei repository dell'account, letto dall'API del provider (una pagina per volta). */
export async function accountRepos(
	id: string,
	page = 1
): Promise<RemoteRepo[]> {
	const account = (await loadAccounts()).find((item) => item.id === id);
	if (!account) throw new Error("Account non trovato.");
	const token = await tokenFor(account);
	if (!token)
		throw new Error(
			`Token non disponibile per ${account.username}: reinseriscilo nell'account.`
		);

	let response: Response;
	try {
		const safePage = Number.isFinite(page) && page > 1 ? Math.floor(page) : 1;
		response = await fetch(reposUrl(account, safePage), {
			headers: authHeaders(account, token),
			signal: AbortSignal.timeout(20_000),
		});
	} catch (error) {
		throw new Error(
			`Provider non raggiungibile: ${
				error instanceof Error ? error.message : String(error)
			}`
		);
	}

	if (response.status === 401 || response.status === 403)
		throw new Error("Token non valido o scaduto: aggiornalo nell'account.");
	if (!response.ok) {
		const detail = (await response.text().catch(() => "")).slice(0, 200);
		throw new Error(
			`${account.host}: ${response.status} ${response.statusText}${
				detail ? ` — ${detail.replace(/\s+/g, " ").trim()}` : ""
			}`
		);
	}

	const payload = await response.json().catch(() => null);
	const repos = parseRemoteRepos(account.provider, payload);
	if (repos.length === 0) {
		const message = (payload as { message?: unknown } | null)?.message;
		if (typeof message === "string")
			throw new Error(`L'API risponde: ${message}`);
	}
	return repos;
}

/**
 * Quale account «possiede» questo repository.
 *
 * Il remoto dice l'host e il proprietario; la scelta salvata dell'utente, se c'è, vince. Il resto
 * delle regole è in `chooseRepoAccount` (core, testato).
 */
export async function repoAccountChoice(root: string): Promise<AccountChoice> {
	const [accounts, settings, remote] = await Promise.all([
		loadAccounts(),
		loadSettings(),
		originRemote(root),
	]);
	return chooseRepoAccount(accounts, settings.repoAccounts[root] ?? null, remote);
}

/** Sceglie (o dimentica, con `null`) l'account di un repository: è una preferenza, non un segreto. */
export async function setRepoAccount(
	root: string,
	accountId: string | null
): Promise<AccountChoice> {
	const accounts = await loadAccounts();
	if (accountId && !accounts.some((item) => item.id === accountId))
		throw new Error("Account non trovato.");
	const settings = await loadSettings();
	const repoAccounts = { ...settings.repoAccounts };
	if (accountId) repoAccounts[root] = accountId;
	else delete repoAccounts[root];
	await saveSettings({ ...settings, repoAccounts });
	return repoAccountChoice(root);
}

/**
 * Ambiente per far usare a Git il token in memoria durante un'operazione di rete.
 *
 * Con il root si rispetta la scelta fatta per **quel** repository: due account sullo stesso host
 * altrimenti userebbero sempre il primo salvato.
 */
export async function credentialEnvFor(
	host: string | null,
	root?: string
): Promise<Record<string, string> | null> {
	if (!host) return null;
	const accounts = await loadAccounts();
	let account: Account | null = null;
	if (root) {
		const choice = await repoAccountChoice(root);
		if (choice.account && choice.account.host.toLowerCase() === host.toLowerCase())
			account = choice.account;
	}
	if (!account)
		account =
			accounts.find((item) => item.host.toLowerCase() === host.toLowerCase()) ??
			null;
	if (!account) return null;
	const token = await tokenFor(account);
	if (!token) return null;
	return askpassEnv(await ensureAskpass(), account.username, token);
}

/** Nome leggibile dell'account, usato nei messaggi. */
export function describeAccount(account: Account): string {
	return (
		account.label ||
		accountId(account.provider, account.host, account.username)
	);
}
