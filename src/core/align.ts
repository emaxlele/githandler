import type { DiffHunk, DiffLine } from "./types.ts";

/**
 * Una riga del diff affiancato: a sinistra il file prima, a destra quello dopo.
 *
 * `left`/`right` nulli indicano che in quel lato la riga non esiste: è il caso delle aggiunte
 * (solo destra) e delle rimozioni (solo sinistra).
 */
export type AlignedRow =
	| {
			kind: "pair";
			left: DiffLine | null;
			right: DiffLine | null;
			/** Indice delle righe in `hunk.lines`: serve alla UI per selezionarle. */
			leftIndex: number | null;
			rightIndex: number | null;
	  }
	| { kind: "note"; line: DiffLine };

/**
 * Accoppia rimozioni e aggiunte consecutive, come fanno le forge web.
 *
 * Dentro un blocco di modifiche Git elenca prima tutte le righe rimosse, poi tutte quelle aggiunte.
 * Accoppiandole per posizione si ottiene la lettura più naturale: la riga 10 di prima contro la
 * riga 10 di dopo, e le righe in eccesso restano da sole su un lato.
 */
export function alignHunk(hunk: DiffHunk): AlignedRow[] {
	const rows: AlignedRow[] = [];
	const lines = hunk.lines;

	let i = 0;
	while (i < lines.length) {
		const line = lines[i]!;

		if (line.type === "nonewline") {
			rows.push({ kind: "note", line });
			i++;
			continue;
		}

		if (line.type === "context") {
			rows.push({ kind: "pair", left: line, right: line, leftIndex: i, rightIndex: i });
			i++;
			continue;
		}

		const dels: number[] = [];
		const adds: number[] = [];
		while (i < lines.length) {
			const next = lines[i]!;
			if (next.type !== "del" && next.type !== "add") break;
			if (next.type === "del") dels.push(i);
			else adds.push(i);
			i++;
		}

		const count = Math.max(dels.length, adds.length);
		for (let k = 0; k < count; k++) {
			const leftIndex = dels[k] ?? null;
			const rightIndex = adds[k] ?? null;
			rows.push({
				kind: "pair",
				left: leftIndex === null ? null : lines[leftIndex]!,
				right: rightIndex === null ? null : lines[rightIndex]!,
				leftIndex,
				rightIndex,
			});
		}
	}

	return rows;
}

export interface ChangedRanges {
	left: [number, number];
	right: [number, number];
}

/**
 * Porzione di testo che cambia davvero fra due righe accoppiate.
 *
 * Serve a evitare di colorare un'intera riga quando cambia un solo numero: si toglie il prefisso e
 * il suffisso comune e si mette in evidenza solo il mezzo. Restituisce `null` quando non c'è nulla
 * di comune (evidenziare tutto sarebbe rumore) o quando le due righe coincidono.
 */
export function changedRanges(
	left: string,
	right: string
): ChangedRanges | null {
	if (left === right) return null;

	const max = Math.min(left.length, right.length);
	let prefix = 0;
	while (prefix < max && left[prefix] === right[prefix]) prefix++;

	let suffix = 0;
	while (
		suffix < max - prefix &&
		left[left.length - 1 - suffix] === right[right.length - 1 - suffix]
	)
		suffix++;

	if (prefix === 0 && suffix === 0) return null;

	const leftEnd = left.length - suffix;
	const rightEnd = right.length - suffix;
	if (prefix >= leftEnd && prefix >= rightEnd) return null;

	return { left: [prefix, leftEnd], right: [prefix, rightEnd] };
}

/** Numero di righe visibili di un diff affiancato, utile per i test e per stimare lo spazio. */
export function alignedRowCount(hunk: DiffHunk): number {
	return alignHunk(hunk).length;
}
