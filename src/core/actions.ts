/**
 * Esecuzioni delle GitHub Actions: indirizzi e parser nel core, rete nel main.
 */

import type { Account } from "./providers.ts";

function asRecord(value: unknown): Record<string, unknown> | null {
	return typeof value === "object" && value !== null
		? (value as Record<string, unknown>)
		: null;
}

function text(value: unknown): string {
	return typeof value === "string" ? value : "";
}

/** Esecuzione di un workflow (GitHub Actions), nella forma che serve alla lista. */
export interface WorkflowRun {
	/** numero interno dell'esecuzione, come stringa: non entra in nessun comando */
	id: string;
	/** nome del workflow (`CI`) */
	name: string;
	branch: string;
	event: string;
	status: string;
	/** `success`, `failure`, `cancelled`, `null` se non è finita */
	conclusion: string | null;
	createdAt: string;
	/** pagina web dell'esecuzione */
	url: string;
}

/** `/repos/{owner}/{repo}/actions/runs`, solo GitHub. */
export function workflowRunsUrl(
	account: Account,
	namespace: string,
	name: string,
	limit = 20
): string {
	const base = account.apiBase.replace(/\/+$/, "");
	return `${base}/repos/${namespace}/${name}/actions/runs?per_page=${Math.max(
		1,
		Math.min(100, Math.round(limit))
	)}`;
}

export function parseWorkflowRuns(payload: unknown): WorkflowRun[] {
	const record = asRecord(payload);
	const list = Array.isArray(record?.workflow_runs)
		? (record!.workflow_runs as unknown[])
		: [];
	const runs: WorkflowRun[] = [];
	for (const item of list) {
		const entry = asRecord(item);
		if (!entry) continue;
		const id = entry.id;
		if (typeof id !== "number" && typeof id !== "string") continue;
		const idText = String(id);
		if (!/^\d+$/.test(idText)) continue;
		const conclusion = text(entry.conclusion);
		runs.push({
			id: idText,
			name: text(entry.name) || text(entry.display_title) || "workflow",
			branch: text(entry.head_branch),
			event: text(entry.event),
			status: text(entry.status),
			conclusion: conclusion || null,
			createdAt: text(entry.created_at),
			url: text(entry.html_url),
		});
	}
	return runs;
}

/** Azioni possibili su un'esecuzione: tutte quelle che l'API di GitHub espone come POST. */
export type WorkflowAction = "rerun" | "rerun-failed" | "cancel";

/**
 * Indirizzo per ri-eseguire un'esecuzione: `rerun` ripete tutti i job, `rerun-failed` solo quelli
 * falliti (GitHub li espone come due endpoint, e «Re-run failed jobs» è il pulsante dei fallimenti).
 * L'id deve essere numerico, così non può diventare un pezzo di percorso arbitrario.
 */
export function workflowRunActionUrl(
	account: Account,
	namespace: string,
	name: string,
	id: string,
	action: WorkflowAction
): string {
	if (!/^\d+$/.test(id)) throw new Error(`Esecuzione non valida: ${id}`);
	const base = account.apiBase.replace(/\/+$/, "");
	const path =
		action === "rerun"
			? "rerun"
			: action === "rerun-failed"
			? "rerun-failed-jobs"
			: "cancel";
	return `${base}/repos/${namespace}/${name}/actions/runs/${id}/${path}`;
}

/** Conclusioni in cui «ri-esegui i job falliti» ha senso: c'è almeno un job da riprovare. */
const RERUN_FAILED_CONCLUSIONS = new Set([
	"failure",
	"timed_out",
	"startup_failure",
	"action_required",
]);

export function canRerunFailed(run: WorkflowRun): boolean {
	return (
		run.status === "completed" &&
		run.conclusion !== null &&
		RERUN_FAILED_CONCLUSIONS.has(run.conclusion)
	);
}

/** Etichetta breve dello stato: quello che l'utente vuole vedere in una riga. */
export function describeRun(run: WorkflowRun): string {
	if (run.status !== "completed") return run.status || "in corso";
	return run.conclusion ?? "concluso";
}
