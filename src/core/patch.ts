import type { DiffFile, DiffHunk } from "./types.ts";

/**
 * Direzione della patch.
 *
 * -   `stage`: si parte dal diff **index → worktree** e si applica all'indice. Le righe rimosse
 *     non selezionate restano nell'indice, quindi diventano righe di contesto; le aggiunte non
 *     selezionate semplicemente non si applicano.
 * -   `unstage`: si parte dal diff **HEAD → index** e si applica all'indice al contrario. Qui il lato
 *     che deve restare contiguo è quello nuovo, quindi sono le aggiunte non selezionate a diventare
 *     contesto (l'indice le ha già) e le rimozioni non selezionate a sparire.
 *
 * È la stessa trasformazione che fa `git add -p` quando si sceglie una parte di un hunk: senza
 * questa conversione la patch conterrebbe buchi e Git la rifiuterebbe.
 */
export type PatchMode = "stage" | "unstage";

export interface HunkSelection {
	/** Indice dell'hunk dentro `file.hunks`. */
	hunk: number;
	/** Indici delle righe `+`/`-` selezionate; assente = tutto l'hunk. */
	lines?: number[];
}

/** Il file ammette staging parziale? Nuovi, eliminati, binari e rinominati si gestiscono interi. */
export function canStagePartially(file: DiffFile): boolean {
	return (
		!file.binary &&
		file.hunks.length > 0 &&
		(file.status === "modified" || file.status === "typechange")
	);
}

function fileHeader(file: DiffFile): string[] {
	const path = file.path;
	return [`diff --git a/${path} b/${path}`, `--- a/${path}`, `+++ b/${path}`];
}

/**
 * Costruisce una patch applicabile all'indice con `git apply --cached` (o `--reverse`) a partire
 * da un diff parziale.
 *
 * Restituisce `null` quando la selezione non produce modifiche reali: il chiamante deve trattarlo
 * come "niente da fare", non come una patch vuota da inviare a Git.
 */
export function buildPatch(
	file: DiffFile,
	selection: HunkSelection[],
	mode: PatchMode
): string | null {
	if (!canStagePartially(file) || selection.length === 0) return null;

	const chunks: string[] = [];
	let touched = false;

	for (const item of selection) {
		const hunk = file.hunks[item.hunk];
		if (!hunk) continue;

		const picked = item.lines ? new Set(item.lines) : null;
		if (picked && picked.size === 0) continue;

		const body = renderHunkBody(hunk, picked, mode);
		if (body === null) continue;

		touched = true;
		chunks.push(
			`@@ -${hunk.oldStart},${body.oldCount} +${hunk.newStart},${
				body.newCount
			} @@${hunk.header ? ` ${hunk.header}` : ""}`,
			...body.lines
		);
	}

	if (!touched) return null;
	return `${fileHeader(file).join("\n")}\n${chunks.join("\n")}\n`;
}

interface RenderedBody {
	lines: string[];
	oldCount: number;
	newCount: number;
}

function renderHunkBody(
	hunk: DiffHunk,
	picked: Set<number> | null,
	mode: PatchMode
): RenderedBody | null {
	const lines: string[] = [];
	let oldCount = 0;
	let newCount = 0;
	let changed = false;

	for (let i = 0; i < hunk.lines.length; i++) {
		const line = hunk.lines[i]!;

		if (line.type === "nonewline") {
			// il marcatore vale per la riga emessa subito prima: se quella riga è stata scartata
			// non ha senso e va omesso
			if (lines.length > 0) lines.push("\\ No newline at end of file");
			continue;
		}

		if (line.type === "context") {
			lines.push(` ${line.text}`);
			oldCount++;
			newCount++;
			continue;
		}

		const selected = picked === null || picked.has(i);

		if (line.type === "del") {
			if (selected) {
				lines.push(`-${line.text}`);
				oldCount++;
				changed = true;
			} else if (mode === "stage") {
				// resta nell'indice: nel contesto del patch è una riga presente da entrambi i lati
				lines.push(` ${line.text}`);
				oldCount++;
				newCount++;
			}
			continue;
		}

		if (line.type === "add") {
			if (selected) {
				lines.push(`+${line.text}`);
				newCount++;
				changed = true;
			} else if (mode === "unstage") {
				// è già nell'indice e deve restare: diventa contesto
				lines.push(` ${line.text}`);
				oldCount++;
				newCount++;
			}
		}
	}

	if (!changed) return null;
	return { lines, oldCount, newCount };
}

/**
 * Le patch arrivano dal renderer, quindi non si fidano: ogni riga `---`/`+++` deve riferirsi al
 * file che il main ha ricevuto come argomento. Impedisce che una patch costruita male tocchi
 * altri file del repository.
 */
export function patchTargetsOnly(patch: string, path: string): boolean {
	const allowed = new Set([`a/${path}`, `b/${path}`, "/dev/null"]);
	for (const line of patch.split("\n")) {
		if (line.startsWith("--- ") || line.startsWith("+++ ")) {
			const name = line.slice(4).trim();
			if (!allowed.has(name)) return false;
		}
		if (line.startsWith("diff --git ")) {
			// `diff --git a/x b/x`: entrambi i lati devono essere il file atteso
			if (line !== `diff --git a/${path} b/${path}`) return false;
		}
	}
	return true;
}

/** Etichetta dell'azione, per non duplicare le stringhe fra UI e messaggi. */
export function patchActionLabel(
	mode: PatchMode,
	lines: number | null
): string {
	const verb = mode === "stage" ? "Stage" : "Unstage";
	if (lines === null) return `${verb} hunk`;
	return `${verb} ${lines} ${lines === 1 ? "riga" : "righe"}`;
}
