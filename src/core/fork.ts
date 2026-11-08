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
