import type { CommitFile, DiffFile, Snapshot } from "../core/types.ts";

/**
 * Contratto fra renderer e main. È l'unico punto in cui il renderer può chiedere qualcosa:
 * niente accesso a Node, niente filesystem, niente `child_process`.
 */
export interface GitApi {
	/** Apre un repository; senza path mostra il dialog di sistema. */
	open(path?: string): Promise<Snapshot | null>;
	/** Rilegge storia, ref e stato del repository corrente. */
	refresh(): Promise<Snapshot>;
	/** File toccati da un commit. */
	commitFiles(sha: string): Promise<CommitFile[]>;
	/** Patch di un singolo file in un commit. */
	commitPatch(sha: string, path: string): Promise<DiffFile>;
	/** Patch di un file nel working tree (staged o unstaged). */
	worktreePatch(path: string, staged: boolean): Promise<DiffFile>;
	stage(paths: string[]): Promise<Snapshot>;
	unstage(paths: string[]): Promise<Snapshot>;
	discard(paths: string[]): Promise<Snapshot>;
	commit(message: string, all: boolean): Promise<Snapshot>;
	checkout(branch: string): Promise<Snapshot>;
	createBranch(name: string): Promise<Snapshot>;
	fetch(): Promise<Snapshot>;
}

export type IpcChannel =
	| "git:open"
	| "git:refresh"
	| "git:commitFiles"
	| "git:commitPatch"
	| "git:worktreePatch"
	| "git:stage"
	| "git:unstage"
	| "git:discard"
	| "git:commit"
	| "git:checkout"
	| "git:createBranch"
	| "git:fetch";
