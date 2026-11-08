/** Modelli condivisi fra main, renderer e test. Nessuna dipendenza da Electron. */

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

export interface RepoInfo {
	root: string;
	gitDir: string;
	name: string;
	branch: string | null;
	detached: boolean;
}

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
}
