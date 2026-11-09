/** Modelli condivisi fra main, renderer e test. Nessuna dipendenza da Electron. */

import type { UndoEntry } from "./undo.ts";

export type DecorationKind = "head" | "local" | "remote" | "tag";

export interface Decoration {
	kind: DecorationKind;
	name: string;
	label: string;
}

export interface Commit {
	sha: string;
	parents: string[];
	author: string;
	email: string;
	timestamp: number;
	subject: string;
	refs: Decoration[];
}

/** Autore o committer di un commit, con la data ISO 8601 che stampa Git (`%aI`). */
export interface CommitPerson {
	name: string;
	email: string;
	date: string;
}

/**
 * Dettaglio di un commit. Autore e committer possono essere persone diverse (rebase, cherry-pick,
 * patch applicate da terzi) e questa informazione non sta nella lista della storia.
 */
export interface CommitDetails {
	sha: string;
	parents: string[];
	author: CommitPerson;
	committer: CommitPerson;
	subject: string;
	/** corpo del messaggio, senza l'oggetto */
	body: string;
}

export interface RefInfo {
	name: string;
	short: string;
	kind: "local" | "remote" | "tag";
	sha: string;
	upstream: string | null;
	ahead: number;
	behind: number;
	current: boolean;
}

export interface GraphRow {
	sha: string;
	/** colonna del pallino */
	lane: number;
	/** corsie presenti sopra la riga; null = vuota */
	before: (string | null)[];
	/** corsie presenti sotto la riga */
	after: (string | null)[];
	/** corsie che convergono in questo commit (merge) */
	incoming: number[];
	/** corsie che nascono da questo commit (parent aggiuntivi) */
	outgoing: number[];
}

export type StatusKind =
	| "changed"
	| "renamed"
	| "unmerged"
	| "untracked"
	| "ignored";

export interface StatusEntry {
	path: string;
	origPath: string | null;
	/** codice dello staging (X) */
	index: string;
	/** codice del working tree (Y) */
	worktree: string;
	kind: StatusKind;
	/** descrizione breve, es. "Nuovo", "Modificato" */
	label: string;
}

/** Un file in conflitto, con le versioni presenti nell'indice (stage 1, 2, 3). */
export interface ConflictFile {
	path: string;
	/** lettere `git status --porcelain=v2`: X = indice, Y = working tree. */
	index: string;
	worktree: string;
	stages: { base: boolean; ours: boolean; theirs: boolean };
}

export interface ConflictDetail extends ConflictFile {
	/** Contenuto attuale del file su disco, marcatori compresi. */
	working: string;
	/** Versioni dall'indice; vuote quando lo stage corrispondente non esiste. */
	ours: string;
	theirs: string;
	base: string;
	/** Almeno una versione non è testo: niente vista a tre vie, solo la scelta per file. */
	binary: boolean;
}

export interface WorkingTree {
	oid: string | null;
	branch: string | null;
	upstream: string | null;
	ahead: number;
	behind: number;
	entries: StatusEntry[];
}

export interface DiffLine {
	type: "context" | "add" | "del" | "nonewline";
	text: string;
	oldNo: number | null;
	newNo: number | null;
}

export interface DiffHunk {
	header: string;
	oldStart: number;
	oldLines: number;
	newStart: number;
	newLines: number;
	lines: DiffLine[];
}

export type FileStatus =
	| "added"
	| "deleted"
	| "modified"
	| "renamed"
	| "copied"
	| "typechange"
	| "binary";

export interface DiffFile {
	path: string;
	oldPath: string | null;
	status: FileStatus;
	binary: boolean;
	additions: number;
	deletions: number;
	hunks: DiffHunk[];
}

export interface CommitFile {
	path: string;
	oldPath: string | null;
	status: string;
}

/** Righe aggiunte e rimosse da un commit, con i file binari contati a parte. */
export interface CommitStat {
	additions: number;
	deletions: number;
	binaries: number;
}

export interface RepoInfo {
	root: string;
	gitDir: string;
	name: string;
	branch: string | null;
	detached: boolean;
	/** merge, rebase o cherry-pick lasciato a metà: si può annullare */
	operation: RepoOperation | null;
}

export type RepoOperation = "merge" | "rebase" | "cherry-pick";

export interface CommitDetail {
	files: CommitFile[];
	diff: DiffFile | null;
}

/** Fotografia completa passata dal main al renderer. */
export interface Snapshot {
	info: RepoInfo;
	commits: Commit[];
	graph: GraphRow[];
	refs: RefInfo[];
	status: WorkingTree;
	/** ultima operazione annullabile, se c'è */
	undo: UndoEntry | null;
	/** la storia letta è solo la prima pagina: se ne possono chiedere altre */
	hasMore: boolean;
}

/** Una pagina di storia, per il caricamento progressivo oltre la prima. */
export interface CommitPage {
	commits: Commit[];
	hasMore: boolean;
}

/** Una voce di `git stash list`. */
export interface StashEntry {
	/** posizione nello stack: `stash@{index}` */
	index: number;
	sha: string;
	/** messaggio dello stash ("WIP on main: …" oppure quello scelto) */
	message: string;
	/** ramo su cui è stato creato, quando Git lo scrive nel messaggio */
	branch: string | null;
	/** secondi epoch */
	timestamp: number;
}

/** Modello del messaggio di commit letto da `commit.template`. */
export interface CommitTemplate {
	text: string;
	/** il file era più lungo del tetto: il resto non è stato letto. */
	truncated: boolean;
}

/** Stato di un submodule come lo stampa `git submodule status`. */
export type SubmoduleState =
	| "clean"
	| "modified"
	| "uninitialized"
	| "conflict";

export interface SubmoduleInfo {
	path: string;
	sha: string;
	state: SubmoduleState;
	/** descrizione fra parentesi, quando c'è (`(heads/main)`) */
	description: string | null;
}
