import type { BlameFile } from "../core/blame.ts";
import type { CheckSummary } from "../core/checks.ts";
import type { ContentQuery, ContentSearchResult } from "../core/content.ts";
import type { HealthReport } from "../core/health.ts";
import type { RemoteCheck } from "../core/remotes.ts";
import type { TreeEntry } from "../core/tree.ts";
import type { WorktreeInfo } from "../core/worktrees.ts";
import type { WorkflowAction, WorkflowRun } from "../core/actions.ts";
import type {
	ForkInfo,
	ForkPending,
	ForkSyncResult,
} from "../core/fork.ts";
import type { Account, AccountChoice, RemoteRepo } from "../core/providers.ts";
import type { NewPullRequest, PullList, PullRequest } from "../core/pulls.ts";
import type { PatchMode } from "../core/patch.ts";
import type { ResetMode } from "../core/ops.ts";
import type { ReflogEntry } from "../core/reflog.ts";
import type { Settings, TrashUsage } from "../core/settings.ts";
import type {
	Commit,
	CommitDetails,
	CommitFile,
	CommitPage,
	CommitStat,
	CommitTemplate,
	ConflictDetail,
	ConflictFile,
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
	/** Righe aggiunte e rimosse dal commit, più il numero di file binari. */
	commitStat(sha: string): Promise<CommitStat>;
	/** Patch di un singolo file in un commit. */
	commitPatch(sha: string, path: string): Promise<DiffFile>;
	/** Patch di un file nel working tree (staged o unstaged). */
	worktreePatch(path: string, staged: boolean): Promise<DiffFile>;
	stage(paths: string[]): Promise<Snapshot>;
	/** Stage o unstage di un hunk o di singole righe, tramite patch parziale. */
	applyPatch(path: string, patch: string, mode: PatchMode): Promise<Snapshot>;
	unstage(paths: string[]): Promise<Snapshot>;
	discard(paths: string[]): Promise<Snapshot>;
	/** Crea un commit; `all` include le modifiche tracciate (`-a`), `sign` firma (`-S`). */
	commit(message: string, all: boolean, sign?: boolean): Promise<Snapshot>;
	checkout(branch: string): Promise<Snapshot>;
	createBranch(name: string): Promise<Snapshot>;
	fetch(): Promise<Snapshot>;
	/** Solo fast-forward: un ramo divergente si ferma con il messaggio di Git. */
	pull(): Promise<Snapshot>;
	/** Push senza forza; il primo push crea il tracking su origin. */
	push(): Promise<Snapshot>;
	stashList(): Promise<StashEntry[]>;
	stashSave(message: string, paths?: string[]): Promise<Snapshot>;
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
	/** Elenco dei repository dell'account, letto dall'API del provider (una pagina per volta). */
	accountRepos(id: string, page?: number): Promise<RemoteRepo[]>;
	/** Prova a usare un token già presente sulla macchina (`gh`, credential helper). */
	claimAccount(input: AccountInput): Promise<ClaimResult>;
	/** Quale account l'app userebbe per il repository attivo, e perché. */
	repoAccount(): Promise<AccountChoice>;
	/** Sceglie (o dimentica, con `null`) l'account di un repository. */
	setRepoAccount(id: string | null): Promise<AccountChoice>;
	/** Il repository attivo è un fork? E qual è l'originale? */
	forkInfo(): Promise<ForkInfo>;
	/** Rami disponibili sull'originale, senza scaricare gli oggetti. */
	forkBranches(): Promise<string[]>;
	/** Cosa cambierebbe un sync sul ramo scelto: commit in arrivo e commit locali. */
	forkPreview(branch?: string): Promise<ForkPending>;
	/** Porta nel ramo locale i commit dell'originale (`merge` o `rebase`, mai forza). */
	syncFork(mode: "merge" | "rebase", branch?: string): Promise<ForkSyncResult>;
	/** Ultime esecuzioni delle GitHub Actions del repository. */
	workflowRuns(): Promise<WorkflowRun[]>;
	/** Ri-esegue tutti o solo i job falliti, oppure annulla un'esecuzione. */
	workflowRunAction(id: string, action: WorkflowAction): Promise<void>;
	/** Pull request aperte del repository, con la parola e la pagina web del servizio. */
	pullRequests(): Promise<PullList>;
	/** Apre una pull request dai due rami indicati. */
	createPullRequest(input: NewPullRequest): Promise<PullRequest>;
	/** Controlli del commit in testa a una pull request. */
	pullChecks(sha: string): Promise<CheckSummary>;
	/** File tracciati nel ref indicato (o in HEAD); serve al selettore dei file. */
	listRepoFiles(ref?: string | null): Promise<RepoFileList>;
	/** Salva il contenuto di HEAD in un archivio zip scelto dall'utente. */
	exportZip(): Promise<string | null>;
	/** Apre nel browser un file del repository (nel ramo indicato o in HEAD). */
	openFileInBrowser(path: string, ref?: string | null): Promise<void>;
	/** Apre la cartella del repository nel gestore file di sistema. */
	openRepoFolder(root: string): Promise<void>;
	/** Apre un file del repository con l'applicazione associata. */
	openFile(root: string, path: string): Promise<void>;
	/** Mostra un file nella sua cartella. */
	revealFile(root: string, path: string): Promise<void>;
	/** Salva fuori dal repository una copia del file (dal working tree o da un commit). */
	saveCopy(
		root: string,
		path: string,
		sha: string | null
	): Promise<string | null>;
	/** Apre nel browser il repository del remoto `origin`. */
	openInBrowser(root: string): Promise<void>;
	/** Apre nel browser il commit indicato. */
	openCommitInBrowser(root: string, sha: string): Promise<void>;
	/** Apre un indirizzo http/https nel browser di sistema. */
	openExternal(url: string): Promise<void>;
	/** Avvia l'accesso dal browser (device flow): restituisce il codice da mostrare. */
	oauthStart(input: AccountInput, clientId: string): Promise<OAuthStart>;
	/** Ferma un accesso dal browser in corso. */
	oauthCancel(): Promise<void>;
	/** Esito dell'accesso dal browser, uno per flusso. */
	onOauth(listener: (event: OAuthEvent) => void): () => void;
	/** Reset del ramo attuale a un commit (soft, mixed, hard). */
	reset(sha: string, mode: ResetMode): Promise<Snapshot>;
	renameBranch(from: string, to: string): Promise<Snapshot>;
	deleteBranch(name: string, force: boolean): Promise<Snapshot>;
	/** Crea un ramo locale con tracking da un ref remoto. */
	checkoutTracking(remoteRef: string, local: string): Promise<Snapshot>;
	/** Annulla un merge, rebase o cherry-pick sospeso a metà. */
	abortOperation(): Promise<Snapshot>;
	/** File in conflitto dell'operazione sospesa. */
	conflicts(): Promise<ConflictFile[]>;
	/** Le tre versioni di un conflitto e il testo attuale del file. */
	conflictDetail(path: string): Promise<ConflictDetail>;
	/** Tiene la versione di un lato per l'intero file. */
	resolveConflictFile(
		path: string,
		side: "ours" | "theirs"
	): Promise<Snapshot>;
	/** Scrive il risultato scelto dall'utente; il file resta da segnare come risolto. */
	writeResolvedFile(path: string, text: string): Promise<void>;
	/** Segna i file come risolti (`git add`). */
	markResolved(paths: string[]): Promise<Snapshot>;
	/** Riprende l'operazione sospesa dopo la risoluzione. */
	continueOperation(): Promise<Snapshot>;
	/** Ricerca nella storia: testo libero, `author:`, `file:`. */
	search(query: string): Promise<Commit[]>;
	/** Ricerca nel contenuto dei file tracciati; il testo resta letterale salvo `regex`. */
	searchContent(query: ContentQuery): Promise<ContentSearchResult>;
	/** Spostamenti di HEAD (commit, checkout, reset…), dal più recente. */
	reflog(limit?: number): Promise<ReflogEntry[]>;
	/** Pagina successiva della storia, a partire da `skip`. */
	moreCommits(skip: number): Promise<CommitPage>;
	/** Attribuzione riga per riga di un file. */
	blame(path: string, start?: number, end?: number): Promise<BlameFile>;
	/** Annulla l'ultima operazione registrata (commit, checkout, scarto). */
	undo(): Promise<Snapshot>;
	/** Modello del messaggio di commit (`commit.template`), vuoto se non configurato. */
	commitTemplate(): Promise<CommitTemplate>;
	/** Rami divergenti, stash vecchi, submodule non puliti e HEAD staccato. */
	health(): Promise<HealthReport>;
	/** Prova a contattare ogni remoto con `git ls-remote`; un errore non ferma gli altri. */
	remoteChecks(): Promise<RemoteCheck[]>;
	/** I worktree del repository, il principale per primo. */
	worktrees(): Promise<WorktreeInfo[]>;
	/** Aggiunge un worktree; crea il ramo se non esiste. */
	createWorktree(path: string, branch: string): Promise<WorktreeInfo[]>;
	/** Toglie un worktree pulito, mai il principale. */
	removeWorktree(path: string): Promise<WorktreeInfo[]>;
	/** Un livello dell'albero di HEAD o di un commit: la radice è il percorso vuoto. */
	treeEntries(ref: string | null, path: string): Promise<TreeEntry[]>;
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
	/** Avanzamento di clone, fetch, pull e push; restituisce la funzione per disiscriversi. */
	onNetwork(listener: (event: NetworkEvent) => void): () => void;
	/** Trascina un file del working tree fuori dalla finestra, come farebbe un gestore file. */
	startDrag(root: string, path: string): void;
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

/** Esito di un accesso con un token già presente sulla macchina. */
export interface ClaimResult {
	accountId: string;
	/** da dove arriva: `gh auth token` o il credential helper di Git */
	source: "github-cli" | "git";
}

/** Elenco dei file tracciati: `truncated` dice che ce ne sono altri. */
export interface RepoFileList {
	files: string[];
	truncated: boolean;
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
> & {
	/** Client ID dell'applicazione OAuth: pubblico, facoltativo (serve all'accesso dal browser). */
	oauthClientId?: string;
};

/** Codice da mostrare all'utente per l'accesso dal browser. */
export interface OAuthStart {
	userCode: string;
	verificationUri: string;
	expiresIn: number;
}

export interface OAuthEvent {
	state: "ok" | "error";
	message?: string;
	accountId?: string;
}

export type PanelTab = "commit" | "tree" | "blame" | "term";

/** Quello che il pannello sta mostrando: la finestra staccata lo riceve e si allinea. */
export interface PanelState {
	root: string;
	tab: PanelTab;
	selectedCommit: string | null;
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
	| "git:commitStat"
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
	| "git:conflicts"
	| "git:conflictDetail"
	| "git:resolveConflictFile"
	| "git:writeResolvedFile"
	| "git:markResolved"
	| "git:continueOperation"
	| "git:search"
	| "git:searchContent"
	| "git:reflog"
	| "git:moreCommits"
	| "git:blame"
	| "git:undo"
	| "git:commitTemplate"
	| "git:health"
	| "git:remoteChecks"
	| "git:worktrees"
	| "git:createWorktree"
	| "git:removeWorktree"
	| "git:treeEntries"
	| "app:watching"
	| "app:settings"
	| "app:chooseFolder"
	| "app:openExternal"
	| "repo:init"
	| "repo:clone"
	| "accounts:list"
	| "accounts:save"
	| "accounts:remove"
	| "accounts:repos"
	| "accounts:claim"
	| "accounts:oauthStart"
	| "accounts:oauthCancel"
	| "repo:account"
	| "repo:account:set"
	| "repo:forkInfo"
	| "repo:forkBranches"
	| "repo:forkPreview"
	| "repo:syncFork"
	| "actions:runs"
	| "actions:run"
	| "pulls:list"
	| "pulls:create"
	| "pulls:checks"
	| "repo:listFiles"
	| "repo:exportZip"
	| "repo:openFileInBrowser"
	| "repo:openFolder"
	| "repo:openFile"
	| "repo:revealFile"
	| "repo:saveCopy"
	| "repo:openInBrowser"
	| "repo:openCommitInBrowser"
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
/** Esito dell'accesso dal browser: `ok` porta solo l'id dell'account, mai il token. */
export const OAUTH_CHANNEL = "accounts:oauth";

/** Canale di solo invio: selezione del pannello, per la finestra staccata. */
export const PANEL_STATE_CHANNEL = "panel:state";

/** Canale di solo invio: apertura e chiusura della finestra del pannello. */
export const PANEL_DETACHED_CHANNEL = "panel:detached";

/** Canale di solo invio: inizio del trascinamento di un file fuori dalla finestra. */
export const DRAG_CHANNEL = "app:startDrag";

/** Canale di solo invio: avanzamento delle operazioni di rete letto da `stderr` di Git. */
export const NETWORK_CHANNEL = "net:progress";

export type NetworkScope = "clone" | "fetch" | "pull" | "push";

/** Un aggiornamento di rete: `root` nullo per il clone, che avviene prima di aprire il repository. */
export interface NetworkEvent {
	root: string | null;
	scope: NetworkScope;
	phase: string;
	percent: number;
	detail: string;
}

export type TerminalEvent =
	| { kind: "data"; id: string; text: string }
	| { kind: "exit"; id: string; code: number | null }
	| { kind: "error"; id: string; message: string };

export type RepoChangeEvent =
	| { kind: "snapshot"; snapshot: Snapshot }
	| { kind: "error"; message: string };
