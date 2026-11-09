/**
 * Controlli (checks) di una pull request: indirizzi e parser nel core, rete nel main.
 *
 * I quattro servizi chiamano «controllo» cose diverse: GitHub ha le check run dei workflow, GitLab
 * gli status dei job della pipeline, Gitea gli status dei commit, Bitbucket gli status dei build.
 * Qui si tiene una sola forma — nome, esito, indirizzo — e si traduce l'esito in quattro valori:
 * `ok`, `failed`, `pending`, `neutral`.
 */

import type { Account } from "./providers.ts";

export type CheckState = "ok" | "failed" | "pending" | "neutral";

export interface CheckRun {
	name: string;
	state: CheckState;
	/** pagina web del controllo, solo se `https` e sull'host dell'account */
	url: string;
	/** riga di dettaglio del servizio, ridotta */
	detail: string;
}

export interface CheckSummary {
	/** esito complessivo: il peggiore fra i controlli, `none` se non ce ne sono */
	state: CheckState | "none";
	total: number;
	ok: number;
	failed: number;
	pending: number;
	runs: CheckRun[];
}

/** Uno SHA può finire in un indirizzo: deve sembrare uno SHA, non un percorso o un'opzione. */
export function assertCommitSha(sha: string): string {
	const value = sha.trim();
	if (!/^[0-9a-f]{7,64}$/i.test(value))
		throw new Error(`SHA del commit non valido: ${sha}`);
	return value;
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

/** Indirizzo che elenca i controlli del commit in testa alla pull request. */
export function checksUrl(
	account: Account,
	namespace: string,
	name: string,
	sha: string,
	limit = 50
): string {
	const base = apiBase(account);
	const path = projectPath(account, namespace, name);
	const commit = assertCommitSha(sha);
	const size = Math.max(1, Math.min(100, Math.round(limit)));
	if (account.provider === "gitlab")
		return `${base}/projects/${path}/repository/commits/${commit}/statuses?per_page=${size}`;
	if (account.provider === "bitbucket")
		return `${base}/repositories/${path}/commit/${commit}/statuses?pagelen=${size}`;
	if (account.provider === "gitea")
		return `${base}/repos/${path}/commits/${commit}/statuses?limit=${size}`;
	return `${base}/repos/${path}/commits/${commit}/check-runs?per_page=${size}`;
}

function asRecord(value: unknown): Record<string, unknown> | null {
	return typeof value === "object" && value !== null
		? (value as Record<string, unknown>)
		: null;
}

function text(value: unknown): string {
	return typeof value === "string" ? value : "";
}

/** Un indirizzo che arriva dall'API si accetta solo se è `https` e resta sull'host dell'account. */
function safeUrl(account: Account, raw: string): string {
	if (!raw) return "";
	try {
		const url = new URL(raw);
		if (url.protocol === "https:" && url.hostname === account.host)
			return url.toString();
	} catch {
		// indirizzo non valido: si lascia vuoto
	}
	return "";
}

/**
 * Traduce lo stato grezzo del servizio nei quattro valori della finestra.
 *
 * GitHub separa `status` (dove è arrivato) e `conclusion` (com'è finito): quando c'è una conclusione
 * è quella che conta, altrimenti il controllo è ancora in corso.
 */
function normalize(state: string, conclusion = ""): CheckState {
	const result = conclusion.toLowerCase();
	if (result) {
		if (result === "success") return "ok";
		if (result === "neutral" || result === "skipped" || result === "stale")
			return "neutral";
		// failure, timed_out, action_required, cancelled: non è verde
		return "failed";
	}
	switch (state.toLowerCase()) {
		case "queued":
		case "pending":
		case "running":
		case "in_progress":
		case "inprogress":
		case "waiting":
			return "pending";
		case "success":
		case "successful":
			return "ok";
		case "failed":
		case "failure":
		case "error":
		case "timed_out":
		case "action_required":
		case "canceled":
		case "cancelled":
			return "failed";
		case "skipped":
		case "neutral":
		case "manual":
		case "stopped":
		case "warning":
			return "neutral";
		default:
			// uno stato che non si conosce non si può dichiarare verde
			return "pending";
	}
}

function assemble(
	account: Account,
	raw: {
		name: string;
		state: string;
		conclusion?: string;
		url: string;
		detail: string;
	}
): CheckRun | null {
	const name = raw.name.trim();
	if (!name) return null;
	return {
		name,
		state: normalize(raw.state, raw.conclusion ?? ""),
		url: safeUrl(account, raw.url),
		detail: raw.detail.replace(/\s+/g, " ").trim().slice(0, 300),
	};
}

/** Legge i controlli dalla risposta di qualsiasi dei quattro servizi. */
export function parseChecks(account: Account, payload: unknown): CheckRun[] {
	const record = asRecord(payload);
	const list = Array.isArray(payload)
		? payload
		: Array.isArray(record?.check_runs)
		? (record!.check_runs as unknown[])
		: Array.isArray(record?.statuses)
		? (record!.statuses as unknown[])
		: Array.isArray(record?.values)
		? (record!.values as unknown[])
		: [];

	const runs: CheckRun[] = [];
	for (const item of list) {
		const entry = asRecord(item);
		if (!entry) continue;
		let run: CheckRun | null = null;
		if (account.provider === "github") {
			const output = asRecord(entry.output);
			run = assemble(account, {
				name: text(entry.name),
				state: text(entry.status),
				conclusion: text(entry.conclusion),
				url: text(entry.details_url) || text(entry.html_url),
				detail: text(output?.summary) || text(output?.title),
			});
		} else if (account.provider === "gitlab") {
			run = assemble(account, {
				name: text(entry.name),
				state: text(entry.status),
				url: text(entry.target_url),
				detail: text(entry.description),
			});
		} else if (account.provider === "gitea") {
			run = assemble(account, {
				name: text(entry.context),
				state: text(entry.status),
				url: text(entry.target_url),
				detail: text(entry.description),
			});
		} else {
			run = assemble(account, {
				name: text(entry.name) || text(entry.key),
				state: text(entry.state),
				url: text(entry.url),
				detail: text(entry.description),
			});
		}
		if (run) runs.push(run);
	}
	return runs;
}

/** Esito complessivo: basta un controllo fallito per non essere verde. */
export function summarizeChecks(runs: CheckRun[]): CheckSummary {
	const count = (state: CheckState): number =>
		runs.filter((run) => run.state === state).length;
	const failed = count("failed");
	const pending = count("pending");
	const ok = count("ok");
	const neutral = count("neutral");
	let state: CheckSummary["state"] = "none";
	if (failed > 0) state = "failed";
	else if (pending > 0) state = "pending";
	else if (ok > 0) state = "ok";
	else if (neutral > 0) state = "neutral";
	return { state, total: runs.length, ok, failed, pending, runs };
}
