/**
 * Undo generale: prima di un'operazione che non si può ricostruire si registra lo stato da cui
 * partire per tornare indietro.
 *
 * - `commit`    → HEAD prima del commit; l'annullamento è un `reset --soft`.
 * - `checkout`  → ramo (o HEAD staccato) prima dello spostamento.
 * - `discard`   → un commit di stash con il contenuto del working tree, più i path toccati.
 *   I file non tracciati non entrano nello stash: se la copia di sicurezza è attiva, i loro byte
 *   diventano blob Git raggiungibili da `refs/githandler/trash/<scope>/<id>` e vengono ripristinati
 *   da lì. Quando la voce esce dal journal il ref viene eliminato e gli oggetti diventano
 *   irraggiungibili: lo spazio lo recupera il `git gc` dell'utente.
 *
 * Il commit a cui punta una voce resta raggiungibile tramite `refs/githandler/snapshots/<id>`, così
 * `git gc` non lo cancella mentre l'annullamento è ancora possibile.
 */

import { isAbsolutePath } from "./paths.ts";

export type UndoKind = "commit" | "checkout" | "discard";

export interface UndoEntry {
	/** tempo in ms + suffisso: unico dentro il repository e ordinabile */
	id: string;
	kind: UndoKind;
	at: number;
	/** HEAD al momento della registrazione (null su repository senza commit) */
	head: string | null;
	/**
	 * HEAD prodotto dall'operazione, scritto quando l'operazione è riuscita. Serve ad annullare
	 * reset e rebase, dove il pre-HEAD non è un antenato del nuovo: se HEAD non è più questo, la
	 * storia è cambiata e annullare perderebbe altro lavoro.
	 */
	target?: string | null;
	/** ramo corrente al momento della registrazione (null = HEAD staccato) */
	branch: string | null;
	/** descrizione breve per la UI */
	label: string;
	/** solo per `discard`: file tracciati, ripristinati dallo stash */
	paths?: string[];
	/** solo per `discard`: commit di stash con il working tree di allora */
	stash?: string | null;
	/** solo per `discard`: file non tracciati, conservati prima della cancellazione */
	untrackedPaths?: string[];
	/** solo per `discard`: id del ref/cartella della copia di sicurezza */
	trash?: string | null;
	/** solo per `discard`: byte e file logici conservati dalla copia (per la quota totale) */
	trashBytes?: number;
	trashFiles?: number;
}

export const UNDO_REF_PREFIX = "refs/githandler/snapshots/";
export const UNDO_LIMIT = 50;

const SHA = /^[0-9a-f]{7,64}$/;

export function snapshotRef(id: string): string {
	return `${UNDO_REF_PREFIX}${id}`;
}

export function isUndoKind(value: unknown): value is UndoKind {
	return value === "commit" || value === "checkout" || value === "discard";
}

/**
 * Legge il journal scartando le voci malformate invece di fidarsi del file: un journal corrotto
 * non deve poter far eseguire un `reset` su uno SHA inventato.
 */
export function parseUndoLog(raw: string): UndoEntry[] {
	if (!raw.trim()) return [];

	let data: unknown;
	try {
		data = JSON.parse(raw);
	} catch {
		return [];
	}
	if (!Array.isArray(data)) return [];

	const entries: UndoEntry[] = [];
	for (const item of data) {
		if (typeof item !== "object" || item === null) continue;
		const record = item as Record<string, unknown>;
		const id = record.id;
		const kind = record.kind;
		const at = record.at;
		const head = record.head;
		const branch = record.branch;
		const label = record.label;
		const paths = record.paths;
		const stash = record.stash;
		const target = record.target;

		if (typeof id !== "string" || !id) continue;
		if (!isUndoKind(kind)) continue;
		if (typeof at !== "number" || !Number.isFinite(at)) continue;
		if (head !== null && (typeof head !== "string" || !SHA.test(head)))
			continue;
		if (branch !== null && typeof branch !== "string") continue;
		if (typeof label !== "string") continue;

		const entry: UndoEntry = {
			id,
			kind,
			at,
			head: head ?? null,
			branch: branch ?? null,
			label,
		};
		// un target malformato non rende inutilizzabile la voce: si torna al controllo sui progenitori
		if (target === null) entry.target = null;
		else if (typeof target === "string" && SHA.test(target))
			entry.target = target;

		const safePaths = (value: unknown): string[] | undefined => {
			if (!Array.isArray(value)) return undefined;
			const safe = value.filter(
				(path): path is string =>
					typeof path === "string" &&
					path.length > 0 &&
					!isAbsolutePath(path) &&
					!path.startsWith("-") &&
					!path.split("/").includes("..")
			);
			return safe.length > 0 ? safe : undefined;
		};

		const tracked = safePaths(paths);
		if (tracked) entry.paths = tracked;
		const untracked = safePaths(record.untrackedPaths);
		if (untracked) entry.untrackedPaths = untracked;

		// uno scarto senza path non dice cosa ripristinare: non è una voce usabile
		if (kind === "discard" && !entry.paths && !entry.untrackedPaths)
			continue;
		if (stash === null || (typeof stash === "string" && SHA.test(stash))) {
			entry.stash = stash ?? null;
		} else if (stash !== undefined) {
			continue;
		}

		// l'id del trash diventa un nome di ref: niente separatori né risalite
		const trash = record.trash;
		if (trash === null) entry.trash = null;
		else if (typeof trash === "string" && /^[0-9A-Za-z._-]+$/.test(trash))
			entry.trash = trash;
		else if (trash !== undefined) continue;
		if (kind === "discard" && entry.untrackedPaths && !entry.trash)
			continue;

		const bytes = record.trashBytes;
		const files = record.trashFiles;
		if (typeof bytes === "number" && Number.isInteger(bytes) && bytes >= 0)
			entry.trashBytes = bytes;
		if (typeof files === "number" && Number.isInteger(files) && files >= 0)
			entry.trashFiles = files;

		entries.push(entry);
	}
	return entries;
}

export function serializeUndoLog(entries: UndoEntry[]): string {
	return `${JSON.stringify(entries, null, "\t")}\n`;
}

/** Testo del pulsante di annullamento. */
export function describeUndo(entry: UndoEntry): string {
	if (entry.kind === "commit") {
		return entry.branch
			? `Annulla il commit su ${entry.branch}`
			: "Annulla il commit";
	}
	if (entry.kind === "checkout") {
		return entry.branch
			? `Torna al ramo ${entry.branch}`
			: `Torna a HEAD staccato (${entry.head?.slice(0, 7) ?? "?"})`;
	}
	const count =
		(entry.paths?.length ?? 0) + (entry.untrackedPaths?.length ?? 0);
	if (count === 1) {
		const only = entry.paths?.[0] ?? entry.untrackedPaths?.[0] ?? "il file";
		return `Ripristina ${only}`;
	}
	return `Ripristina ${count} file scartati`;
}

/** L'id contiene il tempo: `1789999999999-commit`. */
export function undoId(kind: UndoKind, now = Date.now()): string {
	return `${now}-${kind}`;
}
