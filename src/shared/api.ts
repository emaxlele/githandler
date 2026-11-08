import type { BlameFile } from "../core/blame.ts";
import type { Account, RemoteRepo } from "../core/providers.ts";
import type { PatchMode } from "../core/patch.ts";
import type { ResetMode } from "../core/ops.ts";
import type { Settings, TrashUsage } from "../core/settings.ts";
import type {
	Commit,
	CommitDetails,
	CommitFile,
	CommitPage,
	DiffFile,
	Snapshot,
	StashEntry,
	SubmoduleInfo,
} from "../core/types.ts";

/**
 * Contratto fra renderer e main. È l'unico punto in cui il renderer può chiedere qualcosa:
 * niente accesso a Node, niente filesystem, niente `child_process`.
 *
 * Le chiamate valgono per il repository attivo: `open` e `use` lo impostano, così il renderer può
 * tenere aperti più repository senza passare il path a ogni richiesta.
 */
export interface GitApi {
	/**
	 * Apre un repository; senza path mostra il dialog di sistema, a meno che `interactive` sia
	 * falso: all'avvio l'app non deve aprire nulla da sola.
	 */
	open(path?: string, interactive?: boolean): Promise<Snapshot | null>;
	/** Rende attivo un repository già aperto (schede della UI). */
	use(root: string): Promise<void>;
	/** Rilegge storia, ref e stato del repository corrente. */
	refresh(): Promise<Snapshot>;
	/** Autore, committer, SHA, genitori e messaggio di un commit. */
	commitDetails(sha: string): Promise<CommitDetails | null>;
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
	/** Solo fast-forward: un ramo divergente si ferma con il messaggio di Git. */
	pull(): Promise<Snapshot>;
	/** Push senza forza; il primo push crea il tracking su origin. */
	push(): Promise<Snapshot>;
	stashList(): Promise<StashEntry[]>;
	stashSave(message: string): Promise<Snapshot>;
	stashApply(index: number, drop: boolean): Promise<Snapshot>;
	stashDrop(index: number): Promise<Snapshot>;
	submodules(): Promise<SubmoduleInfo[]>;
	updateSubmodules(): Promise<Snapshot>;
	merge(branch: string): Promise<Snapshot>;
	rebase(onto: string): Promise<Snapshot>;
	cherryPick(sha: string): Promise<Snapshot>;
	/** Crea un ramo che punta a un commit, senza spostare HEAD. */
	createBranchAt(name: string, sha: string): Promise<Snapshot>;
	/** Porta HEAD su un commit, staccato da ogni ramo. */
	checkoutCommit(sha: string): Promise<Snapshot>;
	/** Chiude un repository: il main dimentica il backend e ferma il watcher. */
	closeRepo(root: string): Promise<void>;
	/** Crea un repository vuoto e lo apre. */
	initRepo(path: string, identity: Identity | null): Promise<Snapshot>;
	/** Clona un repository in una cartella e lo apre. */
	cloneRepo(url: string, dest: string): Promise<Snapshot>;
	/** Cartella scelta con il dialog di sistema (per i campi «Sfoglia…»). */
	chooseFolder(title?: string, start?: string): Promise<string | null>;
	/** Account collegati: metadati, token in memoria, presenza di un credential helper. */
	accounts(): Promise<AccountsInfo>;
	/** Salva o aggiorna un account; il token è facoltativo e non viene scritto su disco. */
	saveAccount(account: AccountInput, token?: string): Promise<AccountsInfo>;
	removeAccount(id: string): Promise<AccountsInfo>;
	/** Elenco dei repository dell'account, letto dall'API del provider. */
	accountRepos(id: string): Promise<RemoteRepo[]>;
	/** Reset del ramo attuale a un commit (soft, mixed, hard). */
	reset(sha: string, mode: ResetMode): Promise<Snapshot>;
	renameBranch(from: string, to: string): Promise<Snapshot>;
	deleteBranch(name: string, force: boolean): Promise<Snapshot>;
	/** Crea un ramo locale con tracking da un ref remoto. */
	checkoutTracking(remoteRef: string, local: string): Promise<Snapshot>;
	/** Annulla un merge, rebase o cherry-pick sospeso a metà. */
	abortOperation(): Promise<Snapshot>;
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
	/** Esegue un comando nella shell, nel root del repository attivo; l'output arriva a pezzi. */
	terminalRun(id: string, command: string): Promise<void>;
	terminalKill(id: string): Promise<void>;
	/** Si iscrive all'output del terminale; restituisce la funzione per disiscriversi. */
	onTerminal(listener: (event: TerminalEvent) => void): () => void;
	/** Apre il pannello dei dettagli in una finestra separata. */
	detachPanel(): Promise<boolean>;
	/** Pubblica la selezione corrente: la finestra del pannello la segue. */
	syncPanel(state: PanelStateInput): Promise<void>;
	/** Si iscrive alla selezione pubblicata dalla finestra principale. */
	onPanelState(listener: (state: PanelState) => void): () => void;
	/** Si iscrive all'apertura e alla chiusura della finestra del pannello. */
	onPanelDetached(listener: (detached: boolean) => void): () => void;
}

export interface Identity {
	name: string;
	email: string;
}

export interface AccountsInfo {
	accounts: Account[];
	/** id degli account con un token disponibile in questa sessione */
	tokens: string[];
	credentialHelper: boolean;
}

/** I campi che la finestra compila; id e data li calcola il main. */
export type AccountInput = Pick<
	Account,
	"provider" | "host" | "apiBase" | "username" | "label"
>;

export type PanelTab = "changes" | "commit" | "tree" | "blame" | "term";
export type PanelSide = "changes" | "commits";

/** Quello che il pannello sta mostrando: la finestra staccata lo riceve e si allinea. */
export interface PanelState {
	root: string;
	tab: PanelTab;
	side: PanelSide;
	selectedCommit: string | null;
	commitPath: string | null;
	changePath: string | null;
	changeStaged: boolean;
	treePath: string | null;
	layout: "unified" | "split";
}

export type PanelStateInput = Omit<PanelState, "root">;

export type IpcChannel =
	| "git:open"
	| "git:use"
	| "git:refresh"
	| "git:commitDetails"
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
	| "git:pull"
	| "git:push"
	| "git:stashList"
	| "git:stashSave"
	| "git:stashApply"
	| "git:stashDrop"
	| "git:submodules"
	| "git:updateSubmodules"
	| "git:merge"
	| "git:rebase"
	| "git:cherryPick"
	| "git:createBranchAt"
	| "git:checkoutCommit"
	| "git:close"
	| "git:reset"
	| "git:renameBranch"
	| "git:deleteBranch"
	| "git:checkoutTracking"
	| "git:abortOperation"
	| "git:search"
	| "git:moreCommits"
	| "git:blame"
	| "git:undo"
	| "app:watching"
	| "app:settings"
	| "app:chooseFolder"
	| "repo:init"
	| "repo:clone"
	| "accounts:list"
	| "accounts:save"
	| "accounts:remove"
	| "accounts:repos"
	| "app:settings:save"
	| "app:trashUsage"
	| "term:run"
	| "term:kill"
	| "panel:detach"
	| "panel:sync";

/** Canale di solo invio: il main avvisa il renderer che il repository è cambiato. */
export const CHANGED_CHANNEL = "repo:changed";

/** Canale di solo invio: output e fine dei comandi del terminale integrato. */
export const TERMINAL_CHANNEL = "term:event";

/** Canale di solo invio: selezione del pannello, per la finestra staccata. */
export const PANEL_STATE_CHANNEL = "panel:state";

/** Canale di solo invio: apertura e chiusura della finestra del pannello. */
export const PANEL_DETACHED_CHANNEL = "panel:detached";

export type TerminalEvent =
	| { kind: "data"; id: string; text: string }
	| { kind: "exit"; id: string; code: number | null }
	| { kind: "error"; id: string; message: string };

export type RepoChangeEvent =
	| { kind: "snapshot"; snapshot: Snapshot }
	| { kind: "error"; message: string };
