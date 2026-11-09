/**
 * Approvazione di una pull request: indirizzi, corpo e parser nel core, rete nel main.
 *
 * I quattro servizi chiamano la stessa cosa in modi diversi: GitHub e Gitea creano una review con
 * `event: APPROVE`, GitLab e Bitbucket hanno un endpoint `approve` dedicato. Lo stato si legge da
 * fonti diverse: review per GitHub e Gitea, `approved_by` per GitLab, `participants` per Bitbucket.
 *
 * Delle tre azioni possibili, solo l'approvazione esiste ovunque. «Chiedi modifiche» manca su
 * GitLab, che non ha quello stato; ritirare l'approvazione manca su GitHub e Gitea, dove serve
 * dismissare una review con permessi da maintainer. La UI mostra un pulsante solo dove il servizio
 * lo offre davvero, invece di tentare e mostrare un errore.
 */

import type { Account, ProviderId } from "./providers.ts";

export interface ReviewSummary {
	/** quante persone hanno approvato */
	count: number;
	/** nomi di chi ha approvato, in ordine alfabetico */
	approvers: string[];
	/** l'utente dell'account ha già approvato */
	approved: boolean;
	/** nomi di chi ha chiesto modifiche, in ordine alfabetico */
	changesRequested: string[];
}

/** Le due azioni oltre all'approvazione. */
export type ReviewAction = "request-changes" | "withdraw-approval";

/** Il servizio espone l'azione per l'utente che ha collegato l'account? */
export function supportsReviewAction(
	provider: ProviderId,
	action: ReviewAction
): boolean {
	if (action === "request-changes") return provider !== "gitlab";
	// GitHub e Gitea richiedono permessi da maintainer per dismissare una review
	return provider === "gitlab" || provider === "bitbucket";
}

export interface ReviewActionRequest {
	url: string;
	method: "POST" | "DELETE";
	body: Record<string, unknown> | null;
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

/**
 * Indirizzo, metodo e corpo di «chiedi modifiche» o del ritiro dell'approvazione. `null` quando il
 * servizio non offre l'azione: il chiamante non deve inventare una richiesta che verrà rifiutata.
 *
 * GitHub e Gitea passano dalla review con `event: REQUEST_CHANGES` e vogliono un messaggio; GitLab
 * non ha lo stato «modifiche richieste». Bitbucket ha endpoint dedicati per entrambe le azioni.
 */
export function reviewActionRequest(
	account: Account,
	namespace: string,
	name: string,
	number: number,
	action: ReviewAction,
	message = ""
): ReviewActionRequest | null {
	if (!supportsReviewAction(account.provider, action)) return null;

	const id = assertNumber(number);
	const base = apiBase(account);
	const path = projectPath(account, namespace, name);

	if (action === "request-changes") {
		// Bitbucket ha l'endpoint dedicato e non vuole il testo nel corpo
		if (account.provider === "bitbucket") {
			return {
				url: `${base}/repositories/${path}/pullrequests/${id}/request-changes`,
				method: "POST",
				body: null,
			};
		}
		const body = message.trim();
		if (!body) {
			throw new Error(
				"Scrivi il motivo delle modifiche richieste: il servizio lo richiede."
			);
		}
		if (body.length > 60_000) {
			throw new Error("Il messaggio supera i 60.000 caratteri.");
		}
		return {
			// stesso indirizzo dell'approvazione, senza la query di lettura
			url: `${base}/repos/${path}/pulls/${id}/reviews`,
			method: "POST",
			body: { event: "REQUEST_CHANGES", body },
		};
	}

	if (account.provider === "gitlab") {
		return {
			url: `${base}/projects/${path}/merge_requests/${id}/unapprove`,
			method: "POST",
			body: null,
		};
	}
	return {
		url: `${base}/repositories/${path}/pullrequests/${id}/approve`,
		method: "DELETE",
		body: null,
	};
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
 * (GitHub e Gitea la riportano come `DISMISSED` o con `dismissed`) non conta. Per GitHub e Gitea
 * vale l'ultima review di ogni persona: chi ha approvato e poi chiesto modifiche non è più
 * un'approvazione.
 */
export function parseReviewSummary(
	account: Account,
	payload: unknown,
	username: string
): ReviewSummary {
	const approved: string[] = [];
	const changes: string[] = [];

	if (account.provider === "bitbucket") {
		const participants = asRecord(payload)?.participants;
		if (Array.isArray(participants)) {
			for (const item of participants) {
				const participant = asRecord(item);
				if (!participant) continue;
				const state = text(participant.state).toLowerCase();
				if (state === "changes_requested") {
					changes.push(personName(participant.user));
					continue;
				}
				if (participant.approved !== true) continue;
				approved.push(personName(participant.user));
			}
		}
	} else if (account.provider === "gitlab") {
		const items = asRecord(payload)?.approved_by;
		if (Array.isArray(items)) {
			for (const item of items) {
				// il campo è una persona, a volte annidata in `user` a seconda della versione
				approved.push(personName(asRecord(item)?.user ?? item));
			}
		}
	} else {
		// l'elenco delle review è cronologico: l'ultima di ogni persona decide lo stato. GitHub
		// scrive `CHANGES_REQUESTED`, Gitea `REQUEST_CHANGES`: sono lo stesso stato.
		const latest = new Map<
			string,
			{ name: string; state: "APPROVED" | "CHANGES_REQUESTED" }
		>();
		if (Array.isArray(payload)) {
			for (const item of payload) {
				const review = asRecord(item);
				if (!review || review.dismissed === true) continue;
				const name = personName(review.user);
				if (!name) continue;
				const state = text(review.state).toUpperCase();
				if (state === "APPROVED") {
					latest.set(name.toLowerCase(), { name, state });
				} else if (
					state === "CHANGES_REQUESTED" ||
					state === "REQUEST_CHANGES"
				) {
					latest.set(name.toLowerCase(), {
						name,
						state: "CHANGES_REQUESTED",
					});
				}
			}
		}
		for (const { name, state } of latest.values()) {
			if (state === "APPROVED") approved.push(name);
			else changes.push(name);
		}
	}

	const approvers = unique(approved);
	const me = username.trim().toLowerCase();
	return {
		count: approvers.length,
		approvers,
		approved:
			me.length > 0 &&
			approvers.some((name) => name.toLowerCase() === me),
		changesRequested: unique(changes),
	};
}
