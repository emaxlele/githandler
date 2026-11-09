/**
 * Un livello di albero Git: `git ls-tree -z` ridotto a oggetti.
 *
 * Ogni riga è `<mode> <type> <object>\t<path>\0`. Il parser è puro: il comando resta nel main e
 * l'albero completo non viene mai materializzato in una volta, solo la cartella che si apre.
 */

export type TreeEntryType = "blob" | "tree" | "commit";

export interface TreeEntry {
	/** ultimo pezzo del percorso: quello che si legge nella riga */
	name: string;
	/** percorso completo dalla radice del repository */
	path: string;
	type: TreeEntryType;
	mode: string;
}

export function parseTreeEntries(output: string): TreeEntry[] {
	const entries: TreeEntry[] = [];
	for (const record of output.split("\u0000")) {
		const tab = record.indexOf("\t");
		if (tab === -1) continue;
		const meta = record.slice(0, tab).trim().split(/\s+/);
		if (meta.length < 3) continue;
		const [mode, type] = meta;
		const path = record.slice(tab + 1);
		if (!path || !mode) continue;
		if (type !== "blob" && type !== "tree" && type !== "commit") continue;
		entries.push({
			name: path.split("/").pop() ?? path,
			path,
			type,
			mode,
		});
	}
	return entries;
}

/** Cartelle prima, poi i file: l'ordine che ci si aspetta da un albero. */
export function sortTreeEntries(entries: TreeEntry[]): TreeEntry[] {
	return [...entries].sort((a, b) => {
		const aDir = a.type === "tree";
		const bDir = b.type === "tree";
		if (aDir !== bDir) return aDir ? -1 : 1;
		return a.name.localeCompare(b.name);
	});
}
