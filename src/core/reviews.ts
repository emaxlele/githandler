/**
 * Approvazione di una pull request: indirizzi, corpo e parser nel core, rete nel main.
 *
 * I quattro servizi chiamano la stessa cosa in modi diversi: GitHub e Gitea creano una review con
 * `event: APPROVE`, GitLab e Bitbucket hanno un endpoint `approve` dedicato. Lo stato si legge da
 * fonti diverse: review per GitHub e Gitea, `approved_by` per GitLab, `participants` per Bitbucket.
 *
 * Qui si offre una sola operazione, quella che tutti e quattro sanno fare: approvare. Ritirare
 * l'approvazione non è disponibile ovunque, quindi resta nella pagina web del servizio.
 */

import type { Account } from "./providers.ts";

export interface ReviewSummary {
	/** quante persone hanno approvato */
	count: number;
	/** nomi di chi ha approvato, in ordine alfabetico */
	approvers: string[];
	/** l'utente dell'account ha già approvato */
	approved: boolean;
}

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

function projectPath(
	account: Account,
	namespace: string,
	name: string
): string {
	if (account.provider === "gitlab")
		return encodeURIComponent(`${namespace}/${name}`);
	return `${namespace}/${name}`;
}

/** Numero di pull request positivo: vale per leggere lo stato e per approvare. */
function assertNumber(number: number): number {
	if (!Number.isInteger(number) || number <= 0)
		throw new Error(`Numero di pull request non valido: ${number}`);
	return number;
}

/** Indirizzo da cui si legge lo stato delle approvazioni. */
export function reviewsUrl(
	account: Account,
	namespace: string,
	name: string,
	number: number,
	limit = 100
): string {
	const id = assertNumber(number);
	const size = Math.max(1, Math.min(100, Math.round(limit)));
	const base = apiBase(account);
	if (account.provider === "gitlab")
		return `${base}/projects/${projectPath(
			account,
			namespace,
			name
		)}/merge_requests/${id}/approvals`;
	if (account.provider === "bitbucket")
		return `${base}/repositories/${projectPath(
			account,
			namespace,
			name
		)}/pullrequests/${id}`;
	if (account.provider === "gitea")
		return `${base}/repos/${projectPath(
			account,
			namespace,
			name
		)}/pulls/${id}/reviews?limit=${size}`;
	return `${base}/repos/${projectPath(
		account,
		namespace,
		name
	)}/pulls/${id}/reviews?per_page=${size}`;
}

/** Indirizzo su cui si invia l'approvazione. */
export function approveUrl(
	account: Account,
	namespace: string,
	name: string,
	number: number
): string {
	const id = assertNumber(number);
	const base = apiBase(account);
	if (account.provider === "gitlab")
		return `${base}/projects/${projectPath(
			account,
			namespace,
			name
		)}/merge_requests/${id}/approve`;
	if (account.provider === "bitbucket")
		return `${base}/repositories/${projectPath(
			account,
			namespace,
			name
		)}/pullrequests/${id}/approve`;
	if (account.provider === "gitea")
		return `${base}/repos/${projectPath(
			account,
			namespace,
			name
		)}/pulls/${id}/reviews`;
	return `${base}/repos/${projectPath(
		account,
		namespace,
		name
	)}/pulls/${id}/reviews`;
}

/**
 * Corpo dell'approvazione: GitHub e Gitea creano una review con `event: APPROVE`; GitLab e
 * Bitbucket non vogliono niente nel corpo.
 */
export function approvePayload(
	account: Account
): Record<string, unknown> | null {
	if (account.provider === "github") return { event: "APPROVE" };
	// l'API di Gitea usa il participio, non l'imperativo di GitHub
	if (account.provider === "gitea") return { event: "APPROVED" };
	return null;
}

/** Nome da mostrare per una persona, con il login come ripiego. */
function personName(value: unknown): string {
	const person = asRecord(value);
	if (!person) return "";
	return (
		text(person.login) ||
		text(person.username) ||
		text(person.nickname) ||
		text(person.display_name) ||
		text(person.name)
	);
}

function unique(names: string[]): string[] {
	const seen = new Set<string>();
	for (const name of names) {
		const trimmed = name.trim();
		if (trimmed) seen.add(trimmed);
	}
	return [...seen].sort((a, b) => a.localeCompare(b));
}

/**
 * Lo stato delle approvazioni, dalla risposta del servizio. Un'approvazione ritirata o respinta
 * (GitHub e Gitea la riportano come `DISMISSED` o con `dismissed`) non conta.
 */
export function parseReviewSummary(
	account: Account,
	payload: unknown,
	username: string
): ReviewSummary {
	const names: string[] = [];

	if (account.provider === "bitbucket") {
		const participants = asRecord(payload)?.participants;
		if (Array.isArray(participants)) {
			for (const item of participants) {
				const participant = asRecord(item);
				if (!participant || participant.approved !== true) continue;
				names.push(personName(participant.user));
			}
		}
	} else if (account.provider === "gitlab") {
		const approved = asRecord(payload)?.approved_by;
		if (Array.isArray(approved)) {
			for (const item of approved) {
				// il campo è una persona, a volte annidata in `user` a seconda della versione
				names.push(personName(asRecord(item)?.user ?? item));
			}
		}
	} else {
		if (Array.isArray(payload)) {
			for (const item of payload) {
				const review = asRecord(item);
				if (!review || review.dismissed === true) continue;
				if (text(review.state).toUpperCase() !== "APPROVED") continue;
				names.push(personName(review.user));
			}
		}
	}

	const approvers = unique(names);
	const me = username.trim().toLowerCase();
	return {
		count: approvers.length,
		approvers,
		approved:
			me.length > 0 &&
			approvers.some((name) => name.toLowerCase() === me),
	};
}
