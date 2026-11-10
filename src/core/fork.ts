/**
 * Il repository «originale» di un fork: solo dati e funzioni pure.
 *
 * Il parent di un fork è un fatto dell'API del provider, non del repository: qui si costruisce
 * l'indirizzo e si legge la risposta, la rete resta nel main.
 */

import type { Account, ProviderId } from "./providers.ts";

export interface ForkParent {
	/** `proprietario/repository` */
	fullName: string;
	/** URL https da dare a `git remote add upstream` */
	cloneUrl: string;
	webUrl: string;
	/** ramo predefinito dell'originale */
	defaultBranch: string;
}

function asRecord(value: unknown): Record<string, unknown> | null {
	return typeof value === "object" && value !== null
		? (value as Record<string, unknown>)
		: null;
}

function text(value: unknown): string {
	return typeof value === "string" ? value : "";
}

/** Indirizzo del repository sull'API, con il namespace codificato (GitLab usa `%2F`). */
export function repoApiUrl(
	account: Account,
	namespace: string,
	name: string
): string {
	const base = account.apiBase.replace(/\/+$/, "");
	const path = `${namespace}/${name}`;
	if (account.provider === "gitlab")
		return `${base}/projects/${encodeURIComponent(path)}`;
	if (account.provider === "bitbucket")
		return `${base}/repositories/${namespace}/${name}`;
	return `${base}/repos/${path}`;
}

/**
 * Il parent di un fork, se il repository ne è uno. Ogni provider lo chiama in modo diverso e
 * omette campi diversi: quel che manca si ricava da quel che c'è, e se manca l'URL il fork non è
 * sincronizzabile (meglio dirlo che aggiungere un remoto vuoto).
 */
export function parseForkParent(
	provider: ProviderId,
	payload: unknown
): ForkParent | null {
	const record = asRecord(payload);
	if (!record) return null;

	if (provider === "github" || provider === "gitea") {
		const parent = asRecord(record.parent);
		if (!parent) return null;
		const fullName = text(parent.full_name);
		const cloneUrl = text(parent.clone_url);
		if (!fullName || !cloneUrl) return null;
		return {
			fullName,
			cloneUrl,
			webUrl: text(parent.html_url),
			defaultBranch: text(parent.default_branch) || "main",
		};
	}

	if (provider === "gitlab") {
		const parent = asRecord(record.forked_from_project);
		if (!parent) return null;
		const fullName = text(parent.path_with_namespace);
		const cloneUrl = text(parent.http_url_to_repo);
		if (!fullName || !cloneUrl) return null;
		return {
			fullName,
			cloneUrl,
			webUrl: text(parent.web_url),
			defaultBranch: text(parent.default_branch) || "main",
		};
	}

	// Bitbucket: il parent ha la stessa forma di un repository, con `mainbranch`
	const parent = asRecord(record.parent);
	if (!parent) return null;
	const fullName = text(parent.full_name);
	const links = asRecord(parent.links);
	const clone = Array.isArray(links?.clone) ? (links.clone as unknown[]) : [];
	let cloneUrl = "";
	for (const entry of clone) {
		const link = asRecord(entry);
		if (link && text(link.name) === "https") cloneUrl = text(link.href);
	}
	if (!fullName || !cloneUrl) return null;
	return {
		fullName,
		cloneUrl,
		webUrl: text(asRecord(links?.html)?.href),
		defaultBranch: text(asRecord(parent.mainbranch)?.name) || "main",
	};
}

/**
 * Cosa l'app sa di un repository rispetto all'originale: `parent: null` significa «non è un fork»
 * (o il servizio non lo dice), non un errore.
 */
export interface ForkInfo {
	host: string;
	namespace: string;
	name: string;
	/** `null` se il repository non è un fork (o non è un servizio conosciuto) */
	parent: ForkParent | null;
	/** URL del remoto `upstream`, se già configurato */
	upstreamUrl: string | null;
	/** account con cui si è interrogata l'API */
	accountId: string | null;
}

/** Cosa cambierebbe un sync, prima di eseguirlo: il ramo scelto e i commit in arrivo. */
export interface ForkPending {
	/** ramo dell'originale scelto */
	branch: string;
	/** ref remoto locale (`upstream/main`) */
	upstreamRef: string;
	upstreamUrl: string;
	/** il remoto `upstream` è stato creato adesso */
	created: boolean;
	/** ramo locale su cui si applicherà il merge o il rebase */
	localBranch: string;
	/** commit che arriverebbero dall'originale */
	behind: number;
	/** commit locali non ancora nell'originale */
	ahead: number;
}

/** Un remoto configurato: il nome che Git conosce e l'indirizzo di fetch. */
export interface RemoteRef {
	name: string;
	url: string;
}

/**
 * Righe di `git remote -v`: `nome\tindirizzo (fetch)`. Il lato push si scarta, perché può avere un
 * indirizzo diverso e qui serve solo sapere dove si legge l'originale.
 */
export function parseRemotes(output: string): RemoteRef[] {
	const seen = new Map<string, string>();
	for (const line of output.split("\n")) {
		const match = /^(\S+)\t(.+?)\s+\(fetch\)$/.exec(line.trim());
		if (!match) continue;
		seen.set(match[1], match[2]);
	}
	return [...seen].map(([name, url]) => ({ name, url }));
}

/**
 * Indirizzo da dare a `git remote add/set-url`. Git accetta URL e percorsi locali; qui si rifiuta
 * solo quello che sarebbe pericoloso o quasi certamente un errore di copia: un valore che comincia
 * con `-` diventerebbe un'opzione, i caratteri di controllo spezzerebbero la riga, e uno spazio in un
 * URL non esiste (in un percorso locale sì, quindi lì è consentito).
 */
export function checkRemoteUrl(value: string): string {
	const url = value.trim();
	if (!url) throw new Error("Scrivi l'indirizzo del remoto.");
	if (url.startsWith("-"))
		throw new Error("Indirizzo non valido: non può cominciare con «-».");
	if (/[\u0000-\u001f\u007f]/.test(url))
		throw new Error(
			"Indirizzo non valido: contiene caratteri di controllo."
		);
	const localPath = /^(\/|\.{1,2}\/|~\/)/.test(url);
	if (!localPath && /\s/.test(url))
		throw new Error(
			"Indirizzo non valido: contiene spazi. Per un percorso locale usa /, ./ o ../."
		);
	return url;
}

/**
 * Forma confrontabile di due indirizzi dello stesso repository: schema, utente, `.git` finale e
 * `www.` non contano, la parte `host/proprietario/repository` sì.
 */
export function remoteUrlKey(url: string): string {
	let value = url
		.trim()
		.replace(/\/+$/, "")
		.replace(/\.git$/i, "");
	const scp = /^[^\s/@]+@([^\s/:]+):(.+)$/.exec(value);
	if (scp) value = `${scp[1]}/${scp[2]}`;
	value = value.replace(/^[a-zA-Z][\w+.-]*:\/\//, "");
	value = value.replace(/^[^\s/@]+@/, "");
	value = value.replace(/^www\./i, "");
	return value.toLowerCase();
}

/** Righe di `git ls-remote --heads`: `sha\trefs/heads/nome`, senza duplicati e in ordine. */
export function parseRemoteBranches(output: string): string[] {
	const names = new Set<string>();
	for (const line of output.split("\n")) {
		const tab = line.indexOf("\t");
		if (tab === -1) continue;
		const ref = line.slice(tab + 1).trim();
		if (!ref.startsWith("refs/heads/")) continue;
		const name = ref.slice("refs/heads/".length).trim();
		if (name) names.add(name);
	}
	return [...names].sort((a, b) => a.localeCompare(b));
}

/** Esito di una sincronizzazione con l'originale. */
export interface ForkSyncResult {
	/** ramo locale su cui si è lavorato */
	branch: string;
	/** ref remoto usato (`upstream/main`) */
	upstreamRef: string;
	/** URL del remoto upstream (creato se mancava) */
	upstreamUrl: string;
	/** quanti commit ha in più l'originale (`behind`) e quanti ne ha il ramo locale (`ahead`) */
	behind: number;
	ahead: number;
	created: boolean;
}

/** Quello che il repository dice del remoto `upstream`: solo Git, nessuna rete. */
export interface UpstreamLocal {
	/** URL del remoto `upstream`, `null` se non è configurato */
	url: string | null;
	/** tutti i remoti, per sapere se l'originale è già raggiungibile con un altro nome */
	remotes: RemoteRef[];
}

/** Come sta il remoto `upstream`: assente, uguale all'originale, diverso, o non verificabile. */
export type UpstreamRelation =
	| "missing"
	| "aligned"
	| "different"
	| "configured";

/** Quadro completo del remoto `upstream`, con l'originale letto dal provider quando si può. */
export interface UpstreamStatus {
	url: string | null;
	/** `null` se il repository non è un fork o se l'API non ha risposto */
	parent: ForkParent | null;
	/** perché l'originale manca: rete, account, oppure «non è un fork» */
	parentError: string | null;
	state: UpstreamRelation;
	/** altro remoto che punta già all'originale: di solito `origin` */
	sameAsOther: string | null;
	/** indirizzo consigliato, quando l'originale è noto */
	suggestion: string | null;
}

/**
 * Unisce il lato locale e quello del provider. Il confronto dice se i due indirizzi sembrano lo
 * stesso repository, non lo dimostra: forme esotiche restano `different` senza bloccare niente.
 */
export function describeUpstream(
	local: UpstreamLocal,
	parent: ForkParent | null,
	parentError: string | null = null
): UpstreamStatus {
	const sameAsOther = parent
		? local.remotes.find(
				(remote) =>
					remote.name !== "upstream" &&
					remoteUrlKey(remote.url) === remoteUrlKey(parent.cloneUrl)
		  )?.name ?? null
		: null;
	const state: UpstreamRelation = !local.url
		? "missing"
		: !parent
		? "configured"
		: remoteUrlKey(local.url) === remoteUrlKey(parent.cloneUrl)
		? "aligned"
		: "different";
	return {
		url: local.url,
		parent,
		parentError,
		state,
		sameAsOther,
		suggestion: parent?.cloneUrl ?? null,
	};
}
