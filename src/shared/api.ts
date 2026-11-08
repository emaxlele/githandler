import type { BlameFile } from "../core/blame.ts";
import type { PatchMode } from "../core/patch.ts";
import type { Settings, TrashUsage } from "../core/settings.ts";
import type {
	Commit,
	CommitFile,
	CommitPage,
	DiffFile,
	Snapshot,
} from "../core/types.ts";

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
	/** Stage o unstage di un hunk o di singole righe, tramite patch parziale. */
	applyPatch(path: string, patch: string, mode: PatchMode): Promise<Snapshot>;
	unstage(paths: string[]): Promise<Snapshot>;
	discard(paths: string[]): Promise<Snapshot>;
	commit(message: string, all: boolean): Promise<Snapshot>;
	checkout(branch: string): Promise<Snapshot>;
	createBranch(name: string): Promise<Snapshot>;
	fetch(): Promise<Snapshot>;
	/** Ricerca nella storia: testo libero, `author:`, `file:`. */
	search(query: string): Promise<Commit[]>;
	/** Pagina successiva della storia, a partire da `skip`. */
	moreCommits(skip: number): Promise<CommitPage>;
	/** Attribuzione riga per riga di un file. */
	blame(path: string, start?: number, end?: number): Promise<BlameFile>;
	/** Annulla l'ultima operazione registrata (commit, checkout, scarto). */
	undo(): Promise<Snapshot>;
	/** Impostazioni correnti (permessi API, copia dei file non tracciati). */
	settings(): Promise<Settings>;
	/** Salva le impostazioni e restituisce la versione normalizzata. */
	saveSettings(settings: Settings): Promise<Settings>;
	/** Byte e file conservati dalle copie di sicurezza ancora annullabili. */
	trashUsage(): Promise<TrashUsage>;
	/** La sorveglianza del repository è attiva (`--watch`). */
	watching(): Promise<boolean>;
	/** Si iscrive agli aggiornamenti spontanei; restituisce la funzione per disiscriversi. */
	onChanged(listener: (event: RepoChangeEvent) => void): () => void;
}

export type IpcChannel =
	| "git:open"
	| "git:refresh"
	| "git:commitFiles"
	| "git:commitPatch"
	| "git:worktreePatch"
	| "git:stage"
	| "git:applyPatch"
	| "git:unstage"
	| "git:discard"
	| "git:commit"
	| "git:checkout"
	| "git:createBranch"
	| "git:fetch"
	| "git:search"
	| "git:moreCommits"
	| "git:blame"
	| "git:undo"
	| "app:watching"
	| "app:settings"
	| "app:settings:save"
	| "app:trashUsage";

/** Canale di solo invio: il main avvisa il renderer che il repository è cambiato. */
export const CHANGED_CHANNEL = "repo:changed";

export type RepoChangeEvent =
	| { kind: "snapshot"; snapshot: Snapshot }
	| { kind: "error"; message: string };
