/**
 * Discussione di una pull request: indirizzi, parser e corpo del commento.
 *
 * I quattro servizi espongono la conversazione in modi diversi: GitHub e Gitea la trattano come i
 * commenti di una issue, GitLab parla di `notes`, Bitbucket annida il testo in `content.raw`. Qui si
 * nasconde la differenza e si tiene una sola forma; la rete resta nel main.
 */

import type { Account } from "./providers.ts";

export interface PullComment {
	/** identificativo nel servizio, come stringa */
	id: string;
	author: string;
	/** testo del commento, senza spazi ai bordi */
	body: string;
	/** data ISO 8601 del servizio */
	createdAt: string;
	/** pagina web del commento, quando il servizio la offre */
	url: string;
}

const MAX_BODY = 60_000;

function asRecord(value: unknown): Record<string, unknown> | null {
	return typeof value === "object" && value !== null
		? (value as Record<string, unknown>)
		: null;
}

function text(value: unknown): string {
	return typeof value === "string" ? value : "";
}

function apiBase(account: Account): string {
	return account.apiBase.replace(/\/+$/, "");
}

/** `namespace/name` come lo vuole l'API del servizio. */
function projectPath(
	account: Account,
	namespace: string,
	name: string
): string {
	if (account.provider === "gitlab")
		return encodeURIComponent(`${namespace}/${name}`);
	return `${namespace}/${name}`;
}

/** Numero di pull request positivo: lo stesso controllo vale per leggere e commentare. */
function assertNumber(number: number): number {
	if (!Number.isInteger(number) || number <= 0)
		throw new Error(`Numero di pull request non valido: ${number}`);
	return number;
}

/** Indirizzo che elenca i commenti della conversazione, dal più vecchio. */
export function commentsUrl(
	account: Account,
	namespace: string,
	name: string,
	number: number,
	limit = 50
): string {
	const id = assertNumber(number);
	const size = Math.max(1, Math.min(100, Math.round(limit)));
	const base = apiBase(account);
	if (account.provider === "gitlab")
		return `${base}/projects/${projectPath(
			account,
			namespace,
			name
		)}/merge_requests/${id}/notes?sort=asc&order_by=created_at&per_page=${size}`;
	if (account.provider === "bitbucket")
		return `${base}/repositories/${projectPath(
			account,
			namespace,
			name
		)}/pullrequests/${id}/comments?pagelen=${size}`;
	if (account.provider === "gitea")
		return `${base}/repos/${projectPath(
			account,
			namespace,
			name
		)}/issues/${id}/comments?limit=${size}`;
	return `${base}/repos/${projectPath(
		account,
		namespace,
		name
	)}/issues/${id}/comments?per_page=${size}`;
}

/** Corpo del nuovo commento, nella forma del servizio. */
export function commentPayload(
	account: Account,
	body: string
): Record<string, unknown> {
	const trimmed = body.trim();
	if (!trimmed) throw new Error("Il commento è vuoto.");
	if (trimmed.length > MAX_BODY)
		throw new Error(
			`Il commento supera i ${MAX_BODY.toLocaleString(
				"en-US"
			)} caratteri.`
		);
	if (account.provider === "bitbucket") return { content: { raw: trimmed } };
	return { body: trimmed };
}

function parseOne(account: Account, value: unknown): PullComment | null {
	const entry = asRecord(value);
	if (!entry) return null;
	// GitLab registra anche le azioni automatiche, Bitbucket i commenti in revisione e cancellati
	if (entry.system === true || entry.deleted === true) return null;
	if (entry.parent) return null;

	const author = asRecord(entry.user) ?? asRecord(entry.author);
	const body =
		account.provider === "bitbucket"
			? text(asRecord(entry.content)?.raw).trim()
			: text(entry.body).trim();
	if (!body) return null;
	const id =
		typeof entry.id === "number" || typeof entry.id === "string"
			? String(entry.id)
			: "";
	if (!id) return null;
	const links = asRecord(asRecord(entry.links)?.html);
	const createdAt =
		account.provider === "bitbucket"
			? text(entry.created_on)
			: text(entry.created_at);
	return {
		id,
		author:
			text(author?.login) ||
			text(author?.username) ||
			text(author?.display_name) ||
			text(author?.nickname),
		body,
		createdAt,
		url: text(entry.html_url) || text(links?.href),
	};
}

/** Il commento appena creato, dalla risposta del servizio. */
export function parseComment(account: Account, payload: unknown): PullComment {
	const parsed = parseOne(account, payload);
	if (!parsed)
		throw new Error(
			"Il servizio non ha restituito un commento riconoscibile."
		);
	return parsed;
}

/**
 * I commenti della conversazione, dal più vecchio al più recente. Le voci senza testo (cancellate o
 * automatiche) si scartano, come le azioni di sistema di GitLab.
 */
export function parseComments(
	account: Account,
	payload: unknown
): PullComment[] {
	const record = asRecord(payload);
	const list = Array.isArray(payload)
		? payload
		: Array.isArray(record?.values)
		? (record!.values as unknown[])
		: [];
	const comments: PullComment[] = [];
	for (const item of list) {
		const parsed = parseOne(account, item);
		if (parsed) comments.push(parsed);
	}
	// una data assente non deve rompere l'ordine: resta in fondo
	const when = (value: string): number => {
		const parsed = Date.parse(value);
		return Number.isFinite(parsed) ? parsed : Number.POSITIVE_INFINITY;
	};
	comments.sort((a, b) => when(a.createdAt) - when(b.createdAt));
	return comments;
}
