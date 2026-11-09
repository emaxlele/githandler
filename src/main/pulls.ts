import {
	commentPayload,
	commentsUrl,
	parseComment,
	parseComments,
	type PullComment,
} from "../core/comments.ts";
import {
	assertCommitSha,
	checksUrl,
	parseChecks,
	summarizeChecks,
	type CheckSummary,
} from "../core/checks.ts";
import {
	createPullPayload,
	createPullUrl,
	parsePullRequest,
	parsePullRequests,
	pullRequestLabel,
	pullsPageUrl,
	pullsUrl,
	type NewPullRequest,
	type PullList,
	type PullRequest,
} from "../core/pulls.ts";
import {
	authHeaders,
	remoteIdentity,
	type Account,
} from "../core/providers.ts";
import { repoAccountChoice, tokenFor } from "./accounts.ts";
import { originRemote } from "./remote.ts";

/**
 * Pull request / merge request: elenco delle aperte e creazione da due rami.
 *
 * Le richieste vivono sul servizio remoto, non nel repository: si passa dall'API con il token
 * dell'account che possiede il repository, come per le GitHub Actions. Gli indirizzi e i corpi delle
 * richieste sono nel core (`src/core/pulls.ts`), testati senza rete; qui c'è solo il trasporto.
 */

interface PullsContext {
	namespace: string;
	name: string;
	account: Account;
	token: string;
}

async function contextFor(root: string): Promise<PullsContext> {
	const remote = await originRemote(root);
	const identity = remote ? remoteIdentity(remote) : null;
	if (!identity)
		throw new Error(
			"Il remoto «origin» non è un repository su un servizio web: le pull request non ci sono."
		);
	const choice = await repoAccountChoice(root);
	const account = choice.account;
	if (!account)
		throw new Error(
			`Serve un account ${identity.host}: collegalo negli account e riprova.`
		);
	if (account.host !== identity.host)
		throw new Error(
			`L'account scelto è su ${account.host}, il remoto su ${identity.host}: scegli l'account giusto per questo repository.`
		);
	const token = await tokenFor(account);
	if (!token)
		throw new Error(
			`Token non disponibile per ${account.username}: reinseriscilo nell'account.`
		);
	return {
		namespace: identity.namespace,
		name: identity.name,
		account,
		token,
	};
}

/** Messaggio d'errore leggibile: i servizi rispondono con `message` o `error.message`. */
function apiMessage(raw: string): string {
	const trimmed = raw.trim();
	if (!trimmed) return "";
	try {
		const payload = JSON.parse(trimmed) as unknown;
		if (typeof payload === "object" && payload !== null) {
			const record = payload as Record<string, unknown>;
			const direct = record.message;
			if (typeof direct === "string" && direct.trim())
				return direct.trim();
			const error = record.error;
			if (typeof error === "string" && error.trim()) return error.trim();
			if (typeof error === "object" && error !== null) {
				const nested = (error as Record<string, unknown>).message;
				if (typeof nested === "string" && nested.trim())
					return nested.trim();
			}
		}
	} catch {
		// non è JSON: si mostra il testo, ridotto
	}
	return trimmed.replace(/\s+/g, " ").slice(0, 300);
}

async function request(
	context: PullsContext,
	url: string,
	init: RequestInit
): Promise<unknown> {
	let response: Response;
	try {
		response = await fetch(url, {
			...init,
			headers: {
				...authHeaders(context.account, context.token),
				...(init.headers ?? {}),
			},
			signal: AbortSignal.timeout(20_000),
		});
	} catch (error) {
		throw new Error(
			`${context.account.host} non raggiungibile: ${
				error instanceof Error ? error.message : String(error)
			}`
		);
	}
	if (response.status === 401 || response.status === 403)
		throw new Error("Token non valido o scaduto: aggiornalo nell'account.");
	if (!response.ok) {
		const detail = apiMessage(await response.text().catch(() => ""));
		throw new Error(
			`${context.account.host}: ${response.status} ${
				response.statusText
			}${detail ? ` — ${detail}` : ""}`
		);
	}
	return response.json().catch(() => null);
}

export async function listPulls(root: string): Promise<PullList> {
	const context = await contextFor(root);
	const payload = await request(
		context,
		pullsUrl(context.account, context.namespace, context.name),
		{ method: "GET" }
	);
	return {
		provider: context.account.provider,
		label: pullRequestLabel(context.account.provider),
		webUrl: pullsPageUrl(context.account, context.namespace, context.name),
		pulls: parsePullRequests(
			context.account,
			context.namespace,
			context.name,
			payload
		),
	};
}

/** Controlli del commit in testa a una pull request, dal servizio del repository. */
export async function pullChecks(
	root: string,
	sha: string
): Promise<CheckSummary> {
	const context = await contextFor(root);
	const payload = await request(
		context,
		checksUrl(
			context.account,
			context.namespace,
			context.name,
			assertCommitSha(sha)
		),
		{ method: "GET" }
	);
	return summarizeChecks(parseChecks(context.account, payload));
}

/** La conversazione di una pull request, dal più vecchio. */
export async function pullComments(
	root: string,
	number: number
): Promise<PullComment[]> {
	const context = await contextFor(root);
	const payload = await request(
		context,
		commentsUrl(context.account, context.namespace, context.name, number),
		{ method: "GET" }
	);
	return parseComments(context.account, payload);
}

/** Aggiunge un commento alla conversazione e restituisce quello creato. */
export async function addPullComment(
	root: string,
	number: number,
	body: string
): Promise<PullComment> {
	const context = await contextFor(root);
	// il testo si valida nel core prima della rete: vuoto o troppo lungo non parte
	const payload = commentPayload(context.account, body);
	const created = await request(
		context,
		commentsUrl(context.account, context.namespace, context.name, number),
		{
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify(payload),
		}
	);
	return parseComment(context.account, created);
}

export async function createPull(
	root: string,
	input: NewPullRequest
): Promise<PullRequest> {
	const context = await contextFor(root);
	// il corpo si valida nel core prima di usare la rete: un ramo sbagliato non diventa una richiesta
	const body = createPullPayload(context.account, input);
	const payload = await request(
		context,
		createPullUrl(context.account, context.namespace, context.name),
		{
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify(body),
		}
	);
	return parsePullRequest(
		context.account,
		context.namespace,
		context.name,
		payload
	);
}
