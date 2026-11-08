/**
 * Account remoti e provider: solo dati e funzioni pure.
 *
 * Un account è **metadati** (provider, host, API, utente): il token non entra mai in questo modulo
 * né in un file dell'app. Serve al main per parlare con l'API del provider e a `git` tramite
 * `GIT_ASKPASS`, quindi vive in memoria e, se l'utente ha un credential helper, anche nel suo
 * archivio gestito da Git.
 */

export type ProviderId = "github" | "gitlab" | "gitea" | "bitbucket";

export interface ProviderInfo {
	id: ProviderId;
	label: string;
	/** host di default; per i server self-hosted si cambia */
	host: string;
	/** base dell'API, senza slash finale */
	apiBase: string;
	/** l'host e l'API si possono cambiare (Gitea/Forgejo e installazioni proprie) */
	editable: boolean;
}

export const PROVIDERS: readonly ProviderInfo[] = [
	{
		id: "github",
		label: "GitHub",
		host: "github.com",
		apiBase: "https://api.github.com",
		editable: false,
	},
	{
		id: "gitlab",
		label: "GitLab",
		host: "gitlab.com",
		apiBase: "https://gitlab.com/api/v4",
		editable: true,
	},
	{
		id: "gitea",
		label: "Gitea / Forgejo",
		host: "",
		apiBase: "",
		editable: true,
	},
	{
		id: "bitbucket",
		label: "Bitbucket",
		host: "bitbucket.org",
		apiBase: "https://api.bitbucket.org/2.0",
		editable: false,
	},
];

export function providerInfo(id: ProviderId): ProviderInfo {
	const found = PROVIDERS.find((provider) => provider.id === id);
	if (!found) throw new Error(`Provider sconosciuto: ${id}`);
	return found;
}

export function isProviderId(value: unknown): value is ProviderId {
	return PROVIDERS.some((provider) => provider.id === value);
}

export interface Account {
	/** `provider:host:utente`: stabile, così un salvataggio non duplica l'account */
	id: string;
	provider: ProviderId;
	/** etichetta scelta dall'utente; vuota = `<utente> @ <host>` */
	label: string;
	host: string;
	apiBase: string;
	username: string;
	addedAt: number;
	/**
	 * Client ID dell'applicazione OAuth, per l'accesso dal browser. È **pubblico** (viaggia nell'URL
	 * di autorizzazione), non è un segreto: può stare qui accanto agli altri metadati.
	 */
	oauthClientId: string;
}

export function accountId(
	provider: ProviderId,
	host: string,
	username: string
): string {
	return `${provider}:${host}:${username}`;
}

export function accountLabel(account: Account): string {
	return account.label || `${account.username} @ ${account.host}`;
}

/** Nome host accettabile: dominio o indirizzo con porta, niente spazi né percorsi. */
const HOST_RE = /^[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?(?::\d{1,5})?$/i;
/** Caratteri ammessi nei valori del protocollo delle credenziali: niente a capo. */
const LINE_SAFE = /^[\x21-\x7e]+$/;

function asRecord(value: unknown): Record<string, unknown> | null {
	return typeof value === "object" && value !== null
		? (value as Record<string, unknown>)
		: null;
}

export function assertHost(host: string): void {
	if (!HOST_RE.test(host)) throw new Error(`Host non valido: ${host}`);
}

export function assertApiBase(apiBase: string): void {
	let url: URL;
	try {
		url = new URL(apiBase);
	} catch {
		throw new Error(`Indirizzo API non valido: ${apiBase}`);
	}
	if (url.protocol !== "https:" && url.protocol !== "http:")
		throw new Error(`L'API deve essere http o https: ${apiBase}`);
}

export function assertUsername(username: string): void {
	if (!username || !LINE_SAFE.test(username))
		throw new Error(`Utente non valido: ${username}`);
}

/**
 * Il token finisce in un header HTTP, in una variabile d'ambiente e nel protocollo delle credenziali:
 * deve essere una sola riga stampabile. Un a capo qui sarebbe un'iniezione di campi.
 */
export function assertToken(token: string): void {
	if (!token || !LINE_SAFE.test(token))
		throw new Error("Token non valido: usa una sola riga senza spazi.");
}

/** Un account salvato, normalizzato; `null` se manca qualcosa di indispensabile. */
export function normalizeAccount(value: unknown): Account | null {
	const record = asRecord(value);
	if (!record) return null;
	const provider = record.provider;
	if (!isProviderId(provider)) return null;
	const username = record.username;
	const host = record.host;
	if (typeof username !== "string" || typeof host !== "string") return null;
	const info = providerInfo(provider);
	const apiBase =
		typeof record.apiBase === "string" && record.apiBase.trim()
			? record.apiBase.trim().replace(/\/+$/, "")
			: info.apiBase;
	try {
		assertUsername(username);
		assertHost(host);
		assertApiBase(apiBase);
	} catch {
		return null;
	}
	const addedAt =
		typeof record.addedAt === "number" && Number.isFinite(record.addedAt)
			? record.addedAt
			: Date.now();
	const label = typeof record.label === "string" ? record.label.trim() : "";
	// il Client ID è pubblico ma finisce in un corpo HTTP: una sola riga stampabile, o niente
	const oauthRaw =
		typeof record.oauthClientId === "string" ? record.oauthClientId.trim() : "";
	const oauthClientId = oauthRaw && LINE_SAFE.test(oauthRaw) ? oauthRaw : "";
	return {
		id: accountId(provider, host, username),
		provider,
		label,
		host,
		apiBase,
		username,
		addedAt,
		oauthClientId,
	};
}

/** Elenco salvato su disco: un file corrotto vale come nessun account, non come errore. */
export function parseAccounts(raw: string): Account[] {
	if (!raw.trim()) return [];
	let data: unknown;
	try {
		data = JSON.parse(raw);
	} catch {
		return [];
	}
	const record = asRecord(data);
	const list = Array.isArray(record?.accounts)
		? record.accounts
		: Array.isArray(data)
		? data
		: [];
	const seen = new Set<string>();
	const accounts: Account[] = [];
	for (const item of list) {
		const account = normalizeAccount(item);
		if (!account || seen.has(account.id)) continue;
		seen.add(account.id);
		accounts.push(account);
	}
	return accounts;
}

export function serializeAccounts(accounts: Account[]): string {
	return `${JSON.stringify({ accounts }, null, "\t")}\n`;
}

export interface RemoteRepo {
	fullName: string;
	name: string;
	cloneUrl: string;
	webUrl: string;
	private: boolean;
	updatedAt: string;
}

/** URL dell'elenco repository dell'utente, una pagina per volta. */
export function reposUrl(account: Account, page = 1): string {
	const base = account.apiBase;
	switch (account.provider) {
		case "github":
			return `${base}/user/repos?per_page=100&page=${page}&sort=updated&affiliation=owner,collaborator,organization_member`;
		case "gitlab":
			return `${base}/projects?membership=true&per_page=100&page=${page}&order_by=last_activity_at`;
		case "gitea":
			return `${base}/user/repos?limit=50&page=${page}`;
		case "bitbucket":
			return `${base}/repositories/${encodeURIComponent(
				account.username
			)}?role=member&pagelen=100&page=${page}`;
	}
}

/** Header di autenticazione: nessun token finisce nell'URL (resterebbe nei log). */
export function authHeaders(
	account: Account,
	token: string
): Record<string, string> {
	assertToken(token);
	switch (account.provider) {
		case "github":
			return {
				Authorization: `Bearer ${token}`,
				Accept: "application/vnd.github+json",
				"X-GitHub-Api-Version": "2022-11-28",
			};
		case "gitlab":
			return { "PRIVATE-TOKEN": token };
		case "gitea":
			return { Authorization: `token ${token}` };
		case "bitbucket":
			// Bitbucket vuole utente e token in Basic: printable a una riga, quindi btoa è sicuro
			return {
				Authorization: `Basic ${btoa(`${account.username}:${token}`)}`,
			};
	}
}

function text(value: unknown): string {
	return typeof value === "string" ? value : "";
}

/** Trasforma la risposta dell'API in un elenco uniforme; le voci strane si scartano. */
export function parseRemoteRepos(
	provider: ProviderId,
	payload: unknown
): RemoteRepo[] {
	const list = Array.isArray(payload)
		? payload
		: Array.isArray(asRecord(payload)?.values)
		? (asRecord(payload)!.values as unknown[])
		: [];

	const repos: RemoteRepo[] = [];
	for (const item of list) {
		const record = asRecord(item);
		if (!record) continue;

		let fullName = "";
		let cloneUrl = "";
		let webUrl = "";
		let isPrivate = false;
		let updatedAt = "";

		switch (provider) {
			case "github":
			case "gitea":
				fullName = text(record.full_name);
				cloneUrl = text(record.clone_url);
				webUrl = text(record.html_url);
				isPrivate = record.private === true;
				updatedAt = text(record.updated_at);
				break;
			case "gitlab":
				fullName = text(record.path_with_namespace);
				cloneUrl = text(record.http_url_to_repo);
				webUrl = text(record.web_url);
				isPrivate = record.visibility === "private";
				updatedAt = text(record.last_activity_at);
				break;
			case "bitbucket": {
				fullName = text(record.full_name);
				const links = asRecord(record.links);
				const clone = Array.isArray(links?.clone)
					? (links!.clone as unknown[])
					: [];
				for (const entry of clone) {
					const link = asRecord(entry);
					if (link && text(link.name) === "https") {
						cloneUrl = text(link.href);
					}
				}
				webUrl = text(asRecord(links?.html)?.href);
				isPrivate = record.is_private === true;
				updatedAt = text(record.updated_on);
				break;
			}
		}

		if (!fullName || !cloneUrl) continue;
		repos.push({
			fullName,
			name: fullName.split("/").pop() ?? fullName,
			cloneUrl,
			webUrl,
			private: isPrivate,
			updatedAt,
		});
	}
	return repos;
}

/**
 * Nome della cartella per un clone: l'ultimo segmento dell'URL, senza `.git`.
 * Accetta https, ssh (`git@host:owner/repo.git`), `ssh://` e percorsi locali.
 */
export function repoNameFromUrl(url: string): string {
	let path = url.trim();
	const scp = /^[^/@\s]+@([^:/\s]+):(.+)$/.exec(path);
	if (scp) path = scp[2]!;
	else {
		try {
			const parsed = new URL(path);
			path = parsed.pathname;
		} catch {
			// percorso locale: resta com'è
		}
	}
	path = path.replace(/[/\\]+$/, "").replace(/\.git$/i, "");
	const name = path.split(/[/\\]/).pop() ?? "";
	if (!name || name === "." || name === "..")
		throw new Error(`Dall'URL non si ricava un nome: ${url}`);
	return name;
}

/** Host di un URL git: `null` per i percorsi locali (`file:///…`, `/srv/repo`). */
export function hostFromUrl(url: string): string | null {
	const scp = /^[^/@\s]+@([^:/\s]+):/.exec(url);
	if (scp) return scp[1]!.toLowerCase();
	try {
		const parsed = new URL(url);
		if (parsed.protocol === "file:") return null;
		const host = parsed.host.toLowerCase();
		return host || null;
	} catch {
		return null;
	}
}

export type RemoteKind = "github" | "gitlab" | "bitbucket" | "gitea" | "other";

export interface RemoteWeb {
	host: string;
	/** `https://host/proprietario/repository`, senza slash finale */
	base: string;
	kind: RemoteKind;
}

/**
 * Da un remoto git all'indirizzo web del repository: serve per «Apri nel browser» e per i link ai
 * commit. Riconosce https, `ssh://` e la forma `git@host:proprietario/repository.git`; per i percorsi
 * locali restituisce `null` (non c'è nessun sito da aprire).
 */
export function remoteWeb(remote: string): RemoteWeb | null {
	const value = remote.trim();
	if (!value) return null;
	let host = "";
	let path = "";
	const scp = /^[^/@\s]+@([^:/\s]+):(.+)$/.exec(value);
	if (scp) {
		host = scp[1]!;
		path = scp[2]!;
	} else {
		let url: URL;
		try {
			url = new URL(value);
		} catch {
			return null;
		}
		if (url.protocol === "file:") return null;
		host = url.host;
		path = url.pathname;
	}
	path = path
		.replace(/^\/+/, "")
		.replace(/\/+$/, "")
		.replace(/\.git$/i, "");
	if (!host || path.split("/").filter(Boolean).length < 2) return null;
	const lower = host.toLowerCase();
	const kind: RemoteKind = lower === "github.com"
		? "github"
		: lower === "bitbucket.org"
			? "bitbucket"
			: lower.includes("gitlab")
				? "gitlab"
				: "other";
	return { host: lower, base: `https://${lower}/${path}`, kind };
}

function encodePath(path: string): string {
	return path
		.split("/")
		.filter((segment) => segment !== "")
		.map((segment) => encodeURIComponent(segment))
		.join("/");
}

/** Link web a un commit; `null` se il remoto non è un servizio web o lo SHA non è valido. */
export function commitWebUrl(remote: string, sha: string): string | null {
	const web = remoteWeb(remote);
	if (!web) return null;
	if (!/^[0-9a-f]{7,64}$/.test(sha)) return null;
	switch (web.kind) {
		case "gitlab":
			return `${web.base}/-/commit/${sha}`;
		case "bitbucket":
			return `${web.base}/commits/${sha}`;
		default:
			return `${web.base}/commit/${sha}`;
	}
}

/**
 * Link web a un file in un ramo o in un commit.
 *
 * Il servizio non si può sempre dedurre dall'host: Gitea/Forgejo può stare su qualunque dominio.
 * Per questo il provider dell'account collegato, quando c'è, vince sulla deduzione; senza, le forme
 * note (GitHub, GitLab, Bitbucket) si riconoscono dall'host e per il resto nessun link, che è meglio
 * di uno sbagliato.
 */
export function fileWebUrl(
	remote: string,
	ref: string,
	path: string,
	provider?: ProviderId
): string | null {
	const web = remoteWeb(remote);
	if (!web) return null;
	const kind: RemoteKind = provider ?? web.kind;
	if (!ref.trim() || !path.trim()) return null;
	const encodedRef = encodePath(ref);
	const encodedPath = encodePath(path);
	if (!encodedRef || !encodedPath) return null;
	switch (kind) {
		case "github":
			return `${web.base}/blob/${encodedRef}/${encodedPath}`;
		case "gitlab":
			return `${web.base}/-/blob/${encodedRef}/${encodedPath}`;
		case "bitbucket":
			return `${web.base}/src/${encodedRef}/${encodedPath}`;
		// Gitea/Forgejo distingue i rami dai commit: `/src/branch/<ref>` e `/src/commit/<sha>`
		case "gitea":
			return `${web.base}/src/branch/${encodedRef}/${encodedPath}`;
		default:
			return null;
	}
}

/** Campi che `git credential fill` può scrivere oltre ai due che ci servono. */
const CREDENTIAL_KEYS = new Set([
	"protocol",
	"host",
	"path",
	"username",
	"password",
	"url",
	"wwwauth",
	"capability",
]);

/**
 * Nome utente e segreto letti da `git credential fill`.
 *
 * Il formato è `chiave=valore`, una per riga. Si accettano solo le chiavi del protocollo: una riga
 * che non ha la forma giusta significa output strano, e in quel caso si restituisce `null` invece di
 * indovinare. Un helper che scrivesse `password=x
password=y` farebbe vincere l'ultima, come fa git.
 */
export function parseCredentialOutput(raw: string): {
	username: string;
	password: string;
} | null {
	let username = "";
	let password = "";
	for (const line of raw.split("\n")) {
		const value = line.replace(/\r$/, "");
		if (!value.trim()) continue;
		const eq = value.indexOf("=");
		if (eq <= 0) return null;
		const key = value.slice(0, eq).trim();
		const field = value.slice(eq + 1).trim();
		if (!CREDENTIAL_KEYS.has(key)) return null;
		if (key === "username") username = field;
		if (key === "password") password = field;
	}
	if (!password) return null;
	if (username && !LINE_SAFE.test(username)) return null;
	if (!LINE_SAFE.test(password)) return null;
	return { username, password };
}

/** Identità di un repository a partire dal remoto: host, namespace (`gruppo/sotto`) e nome. */
export interface RemoteIdentity {
	host: string;
	/** tutto quello che sta fra l'host e il nome: `proprietario` o `gruppo/sottogruppo` */
	namespace: string;
	/** primo segmento del namespace: l'utente o l'organizzazione */
	owner: string;
	name: string;
	base: string;
	kind: RemoteKind;
}

export function remoteIdentity(remote: string): RemoteIdentity | null {
	const web = remoteWeb(remote);
	if (!web) return null;
	const segments = web.base
		.replace(/^https:\/\//, "")
		.split("/")
		.filter(Boolean);
	// il primo segmento è l'host (con eventuale porta)
	const path = segments.slice(1);
	if (path.length < 2) return null;
	const name = path[path.length - 1]!;
	const namespace = path.slice(0, -1).join("/");
	const owner = path[0]!;
	return { host: web.host, namespace, owner, name, base: web.base, kind: web.kind };
}

export type AccountChoiceReason = "saved" | "owner" | "single" | "first" | "none";

export interface AccountChoice {
	account: Account | null;
	/**
	 * Perché quell'account: scelto a mano per il repository, utente uguale al proprietario del
	 * remoto, unico account di quell'host, primo di più account, oppure nessuno.
	 */
	reason: AccountChoiceReason;
	/** account dello stesso host, in ordine di salvataggio: la UI li propone */
	candidates: Account[];
	/** host del remoto, se riconoscibile */
	host: string | null;
}

/**
 * Quale account usare per un repository.
 *
 * Un repository non dice con quale account è stato clonato: il remoto dice **l'host** (e il
 * namespace, che spesso è l'utente). Le regole, dalla più forte alla più debole:
 *
 * 1. la scelta salvata dall'utente per questo repository (`repoAccounts`);
 * 2. un account dello stesso host il cui utente è il proprietario del remoto (`github.com/emaxlele/x`);
 * 3. l'unico account di quell'host;
 * 4. il primo di più account dello stesso host — meglio di niente, e la UI lo dichiara.
 */
export function chooseRepoAccount(
	accounts: Account[],
	savedId: string | null,
	remote: string | null
): AccountChoice {
	const identity = remote ? remoteIdentity(remote) : null;
	const host = identity?.host ?? null;
	const candidates = host
		? accounts.filter((item) => item.host.toLowerCase() === host.toLowerCase())
		: [];
	const saved = savedId
		? candidates.find((item) => item.id === savedId) ?? null
		: null;
	if (saved) return { account: saved, reason: "saved", candidates, host };
	if (!identity) return { account: null, reason: "none", candidates, host };
	// confronto esatto: `emax` non deve prendere il repository di `emaxlele`
	const ownerMatch = candidates.find(
		(item) => item.username.toLowerCase() === identity.owner.toLowerCase()
	);
	if (ownerMatch)
		return { account: ownerMatch, reason: "owner", candidates, host };
	if (candidates.length === 1)
		return { account: candidates[0]!, reason: "single", candidates, host };
	if (candidates.length > 1)
		return { account: candidates[0]!, reason: "first", candidates, host };
	return { account: null, reason: "none", candidates, host };
}

/** Dimensione di una pagina dell'elenco repository: serve alla UI per sapere se c'è altro. */
export function reposPageSize(provider: ProviderId): number {
	return provider === "gitea" ? 50 : 100;
}

export function cloneArgs(url: string, dest: string): string[] {
	if (!url.trim()) throw new Error("URL del repository mancante.");
	if (!dest.startsWith("/"))
		throw new Error(`Destinazione non assoluta: ${dest}`);
	return ["clone", "--", url, dest];
}

export function initArgs(dest: string): string[] {
	if (!dest.startsWith("/"))
		throw new Error(`Destinazione non assoluta: ${dest}`);
	return ["init", dest];
}

/**
 * Script per `GIT_ASKPASS`. Legge utente e token dall'ambiente del processo figlio: niente segreti in
 * argv (che si legge con `ps`) e niente segreti nei file. Git lo chiama per il nome utente e per la
 * password; la prima riga richiesta contiene «sername».
 */
export const ASKPASS_SCRIPT = `#!/bin/sh
case "$1" in
  *sername*) printf '%s\\n' "$GITHANDLER_USER" ;;
  *) printf '%s\\n' "$GITHANDLER_TOKEN" ;;
esac
`;

/** Variabili per far usare a Git il token in memoria durante un'operazione di rete. */
export function askpassEnv(
	askpassPath: string,
	username: string,
	token: string
): Record<string, string> {
	assertUsername(username);
	assertToken(token);
	return {
		GIT_ASKPASS: askpassPath,
		GIT_TERMINAL_PROMPT: "0",
		GITHANDLER_USER: username,
		GITHANDLER_TOKEN: token,
	};
}

/** Riga di input per `git credential approve`: il token resta nel gestore scelto dall'utente. */
export function credentialInput(
	host: string,
	username: string,
	token: string
): string {
	assertHost(host);
	assertUsername(username);
	assertToken(token);
	return `protocol=https\nhost=${host}\nusername=${username}\npassword=${token}\n\n`;
}
