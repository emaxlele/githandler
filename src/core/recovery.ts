/**
 * Cosa si può recuperare, in una riga: l'ultima operazione, gli stash e le copie dei file scartati.
 *
 * È un riassunto, non un'azione: serve alla finestra «Recupero» per dire cosa c'è senza che ogni
 * chiamante ricostruisca le stesse condizioni.
 */
import type { TrashUsage } from "./settings.ts";
import { describeUndo, type UndoEntry } from "./undo.ts";

export interface RecoveryInput {
	undo: UndoEntry | null;
	stashes: number;
	trash: TrashUsage;
}

export interface RecoverySummary {
	undoable: boolean;
	/** descrizione leggibile dell'ultima operazione, `null` quando non c'è */
	undoDescription: string | null;
	stashes: number;
	trashFiles: number;
	trashBytes: number;
	trashEntries: number;
	/** c'è almeno qualcosa da mostrare */
	anything: boolean;
}

function count(value: number): number {
	return Number.isFinite(value) && value > 0 ? Math.floor(value) : 0;
}

export function summarizeRecovery(input: RecoveryInput): RecoverySummary {
	const stashes = count(input.stashes);
	const trashFiles = count(input.trash.files);
	const trashBytes = count(input.trash.bytes);
	const trashEntries = count(input.trash.entries);
	return {
		undoable: input.undo !== null,
		undoDescription: input.undo ? describeUndo(input.undo) : null,
		stashes,
		trashFiles,
		trashBytes,
		trashEntries,
		anything: input.undo !== null || stashes > 0 || trashFiles > 0,
	};
}
