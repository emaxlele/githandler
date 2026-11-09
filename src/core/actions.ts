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
	/** quale tentativo è questa esecuzione: 1 il primo, 2 dopo «Ri-esegui» */
	attempt: number;
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
			attempt:
				typeof entry.run_attempt === "number" && entry.run_attempt > 0
					? Math.floor(entry.run_attempt)
					: 1,
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

/** Workflow del repository, come li elenca GitHub. */
export interface WorkflowInfo {
	/** id numerico, come stringa */
	id: string;
	name: string;
	/** percorso nel repository (`.github/workflows/ci.yml`) */
	path: string;
	state: string;
}

/** `/repos/{owner}/{repo}/actions/workflows`: solo GitHub. */
export function workflowsUrl(
	account: Account,
	namespace: string,
	name: string,
	limit = 100
): string {
	const base = account.apiBase.replace(/\/+$/, "");
	return `${base}/repos/${namespace}/${name}/actions/workflows?per_page=${Math.max(
		1,
		Math.min(100, Math.round(limit))
	)}`;
}

/** I workflow attivi, dal più recente nell'ordine in cui li dà GitHub. */
export function parseWorkflows(payload: unknown): WorkflowInfo[] {
	const record = asRecord(payload);
	const list = Array.isArray(record?.workflows)
		? (record!.workflows as unknown[])
		: [];
	const workflows: WorkflowInfo[] = [];
	for (const item of list) {
		const entry = asRecord(item);
		if (!entry) continue;
		const id = entry.id;
		if (typeof id !== "number" && typeof id !== "string") continue;
		const idText = String(id);
		if (!/^\d+$/.test(idText)) continue;
		const name = text(entry.name).trim();
		if (!name) continue;
		workflows.push({
			id: idText,
			name,
			path: text(entry.path),
			state: text(entry.state),
		});
	}
	return workflows;
}

/**
 * Nome di ramo o tag accettato dall'API: niente spazi, caratteri di controllo, trattino iniziale o
 * risalita di percorso. La regola è la stessa dei rami delle pull request.
 */
export function assertWorkflowRef(ref: string): string {
	const trimmed = ref.trim();
	if (
		!trimmed ||
		trimmed.length > 250 ||
		trimmed.startsWith("-") ||
		trimmed.includes("..") ||
		/[\x00-\x20\x7f~^:?*[\\]/.test(trimmed)
	) {
		throw new Error(`Riferimento non valido: ${ref}`);
	}
	return trimmed;
}

/** GitHub accetta al massimo dieci input per `workflow_dispatch`. */
const MAX_DISPATCH_INPUTS = 10;

/**
 * Corpo di `workflow_dispatch`: il riferimento e, se ci sono, gli input come oggetto di stringhe.
 * Gli input arrivano da un testo JSON: un valore numerico o un annidamento viene rifiutato invece di
 * essere convertito in silenzio, perché il workflow si aspetta il tipo che ha dichiarato.
 */
export function dispatchPayload(
	ref: string,
	inputsText: string
): { ref: string; inputs?: Record<string, string> } {
	const target = assertWorkflowRef(ref);
	const raw = inputsText.trim();
	if (!raw) return { ref: target };

	let parsed: unknown;
	try {
		parsed = JSON.parse(raw);
	} catch {
		throw new Error("Gli input non sono JSON valido.");
	}
	const record = asRecord(parsed);
	if (!record || Array.isArray(parsed))
		throw new Error("Gli input devono essere un oggetto JSON: { \"nome\": \"valore\" }.");
	const entries = Object.entries(record);
	if (entries.length === 0) return { ref: target };
	if (entries.length > MAX_DISPATCH_INPUTS)
		throw new Error(
			`Un workflow accetta al massimo ${MAX_DISPATCH_INPUTS} input.`
		);
	const inputs: Record<string, string> = {};
	for (const [key, value] of entries) {
		if (!/^[A-Za-z_][A-Za-z0-9_-]*$/.test(key))
			throw new Error(`Nome di input non valido: ${key}`);
		if (typeof value !== "string")
			throw new Error(`L'input «${key}» deve essere una stringa.`);
		inputs[key] = value;
	}
	return { ref: target, inputs };
}

/** `POST .../actions/workflows/{id}/dispatches`: avvia il workflow sul riferimento scelto. */
export function dispatchWorkflowUrl(
	account: Account,
	namespace: string,
	name: string,
	id: string
): string {
	if (!/^\d+$/.test(id)) throw new Error(`Workflow non valido: ${id}`);
	const base = account.apiBase.replace(/\/+$/, "");
	return `${base}/repos/${namespace}/${name}/actions/workflows/${id}/dispatches`;
}
