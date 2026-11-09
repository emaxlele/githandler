/**
 * Notifiche dei workflow: quali esecuzioni meritano un avviso.
 *
 * Il primo giro non avvisa nulla: senza, aprendo l'app arriverebbero insieme tutte le esecuzioni
 * fallite della settimana. Dal secondo in poi si avvisa quando un'esecuzione diventa un errore — una
 * nuova, o una che era in corso — una volta sola: l'esito già visto resta nella mappa.
 */

import type { WorkflowRun } from "./actions.ts";

export interface CiState {
	/** ultimo esito visto per ogni esecuzione */
	seen: Map<string, string>;
	/** il primo giro è solo una fotografia, anche quando non c'è ancora nessuna esecuzione */
	seeded: boolean;
}

export function createCiState(): CiState {
	return { seen: new Map(), seeded: false };
}

/** Esiti che meritano un avviso: `success` e `skipped` no, `cancelled` nemmeno (l'ha fermata qualcuno). */
export function isCiFailure(conclusion: string | null): boolean {
	return (
		conclusion === "failure" ||
		conclusion === "timed_out" ||
		conclusion === "startup_failure" ||
		conclusion === "action_required"
	);
}

/**
 * Confronta le esecuzioni con l'ultimo esito visto.
 *
 * La mappa si aggiorna sul posto con ogni esecuzione presente; le esecuzioni sparite non si
 * conservano, così non cresce fra un giro e l'altro. Il primo giro è solo una fotografia e
 * restituisce un elenco vuoto.
 */
export function newFailures(
	state: CiState,
	runs: WorkflowRun[]
): WorkflowRun[] {
	const seed = !state.seeded;
	const found: WorkflowRun[] = [];
	for (const run of runs) {
		const next = run.conclusion ?? "pending";
		const previous = state.seen.get(run.id);
		if (!seed && previous !== next && isCiFailure(run.conclusion))
			found.push(run);
	}
	state.seen.clear();
	for (const run of runs) state.seen.set(run.id, run.conclusion ?? "pending");
	state.seeded = true;
	return found;
}
