import type { HunkSelection, PatchMode } from "../core/patch.ts";
import { buildPatch } from "../core/patch.ts";
import { layoutGraph } from "../core/graph.ts";
import type {
	ContentMatch,
	ContentQuery,
	ContentSearchResult,
} from "../core/content.ts";
import { localNameForRemote } from "../core/ops.ts";
import {
	APPEARANCE_DEFAULTS,
	API_TOOLS,
	MEBIBYTE,
	TRASH_DEFAULTS,
	normalizeAppearance,
	type ApiMode,
	type ApiTool,
	type AppearanceSettings,
	type Settings,
	type TrashUsage,
} from "../core/settings.ts";
import type {
	Commit,
	CommitDetails,
	CommitFile,
	CommitStat,
	DiffFile,
	RefInfo,
	Snapshot,
	ConflictDetail,
	ConflictFile,
	RepoOperation,
	StatusEntry,
} from "../core/types.ts";
import { describeUndo } from "../core/undo.ts";
import {
	PROVIDERS,
	isProviderId,
	providerInfo,
	accountId,
	accountLabel,
	repoNameFromUrl,
	reposPageSize,
	type Account,
	type AccountChoice,
	type RemoteRepo,
} from "../core/providers.ts";
import {
	canRerunFailed,
	describeRun,
	type WorkflowAction,
	type WorkflowRun,
} from "../core/actions.ts";
import type { HealthReport } from "../core/health.ts";
import type { RemoteCheck } from "../core/remotes.ts";
import {
	subjectOf,
	validateRebaseSteps,
	type RebaseAction,
	type RebaseStep,
} from "../core/rebase.ts";
import type { TreeEntry } from "../core/tree.ts";
import type { WorktreeInfo } from "../core/worktrees.ts";
import { summarizeRecovery, type RecoverySummary } from "../core/recovery.ts";
import type { CheckRun, CheckSummary } from "../core/checks.ts";
import type { PullComment } from "../core/comments.ts";
import type { PullList, PullRequest } from "../core/pulls.ts";
import type { ReflogEntry } from "../core/reflog.ts";
import { deviceFlow, tokenPageUrl } from "../core/oauth.ts";
import type {
	AccountInput,
	AccountsInfo,
	GitApi,
	PanelState,
	PanelStateInput,
	PanelTab,
} from "../shared/api.ts";
import {
	countConflicts,
	parseConflicts,
	resolveConflicts,
	type ConflictChoice,
} from "../core/conflicts.ts";
import { rankPalette } from "../core/palette.ts";
import { BlameView } from "./blame-view.ts";
import {
	pickKey,
	renderDiff,
	renderDiffs,
	type DiffLayout,
} from "./diff-view.ts";
import { avatarColor, byId, clear, el, initials, shortDate } from "./dom.ts";
import {
	LOCALE_STORAGE_KEY,
	currentLocale,
	localeTag,
	resolveLocale,
	setLocale,
	t,
	translateStatic,
} from "./i18n.ts";
import { LogView } from "./log-view.ts";

/*
 * The language must be chosen before anything is drawn: the stored preference is read
 * synchronously here, while the authoritative copy lives in the settings file.
 */
const localeOverride = new URLSearchParams(location.search).get("locale");
setLocale(
	resolveLocale(
		(localeOverride === "it" || localeOverride === "en"
			? localeOverride
			: localStorage.getItem(LOCALE_STORAGE_KEY) ?? "auto") as
			| "auto"
			| "it"
			| "en"
	)
);
translateStatic();

/** Appearance lives in localStorage too: the first paint must not flash the wrong theme. */
const APPEARANCE_STORAGE_KEY = "githandler.appearance";

function readStoredAppearance(): AppearanceSettings {
	try {
		const raw = localStorage.getItem(APPEARANCE_STORAGE_KEY);
		return normalizeAppearance(raw ? JSON.parse(raw) : null);
	} catch {
		return { ...APPEARANCE_DEFAULTS };
	}
}

let appearance = readStoredAppearance();
const systemLight = window.matchMedia("(prefers-color-scheme: light)");

function applyAppearance(next: AppearanceSettings): void {
	appearance = next;
	const theme =
		next.theme === "auto"
			? systemLight.matches
				? "light"
				: "dark"
			: next.theme;
	const root = document.documentElement;
	root.dataset.theme = theme;
	root.dataset.density = next.density;
	root.style.colorScheme = theme === "light" ? "light" : "dark";
}

/** A system switch only matters while the preference is `auto`. */
systemLight.addEventListener("change", () => {
	if (appearance.theme === "auto") applyAppearance(appearance);
});

applyAppearance(appearance);

declare global {
	interface Window {
		githandler: GitApi;
	}
}

const api = window.githandler;

/**
 * La finestra dei dettagli è lo stesso renderer con `?panel=1`: toolbar, schede dei repository,
 * barra laterale e storia spariscono e il pannello prende tutta la finestra.
 */
const query = new URLSearchParams(window.location.search);
const panelMode = query.get("panel") === "1";
const panelBootRoot = query.get("root");
if (panelMode) document.body.classList.add("panel-only");

/** La barra laterale decide cosa occupa l'area principale. */
type Side = "changes" | "commits";

/** La scheda del pannello inferiore: la stessa che riceve la finestra staccata. */
type Tab = PanelTab;

interface State {
	/** root del repository: identifica la sessione */
	root: string;
	snapshot: Snapshot | null;
	/** storia caricata: la prima pagina più quelle richieste scorrendo */
	commits: Commit[];
	/** esistono altre pagine dopo `commits` */
	hasMore: boolean;
	loadingMore: boolean;
	selectedCommit: string | null;
	commitDetails: CommitDetails | null;
	commitFiles: CommitFile[];
	/** Righe aggiunte e rimosse del commit: l'analisi in testa al pannello. */
	commitStat: CommitStat | null;
	/** Patch già lette per il diff del commit: cambiando formato non si rilegge il disco. */
	commitDiffs: DiffFile[];
	/** file selezionato nella scheda File Tree */
	treePath: string | null;
	/** cartelle chiuse nell'albero; vuoto = tutto aperto */
	treeCollapsed: Set<string>;
	/** albero completo pigro invece dei soli file modificati */
	treeAll: boolean;
	/** un livello per cartella già letto (`""` è la radice) */
	lazyTree: Map<string, TreeEntry[]>;
	/** cartelle aperte nell'albero pigro */
	lazyExpanded: Set<string>;
	/** richieste in corso: evita di chiedere due volte la stessa cartella */
	lazyLoading: Set<string>;
	changePath: string | null;
	changeStaged: boolean;
	/** Diff attualmente disegnato per il working tree: serve a ricostruire le patch parziali. */
	changeDiff: DiffFile | null;
	/** Righe scelte per lo staging parziale, nella forma `hunk:line`. */
	picked: Set<string>;
	diffLayout: DiffLayout;
	tab: Tab;
	/** filtro attivo sulla storia (null = storia normale) */
	searchQuery: string | null;
	/** Changes nell'area principale, oppure la storia */
	side: Side;
}

/** Stato di un repository aperto: uno per scheda. */
function emptyState(root = ""): State {
	return {
		root,
		snapshot: null,
		commits: [],
		hasMore: false,
		loadingMore: false,
		selectedCommit: null,
		commitDetails: null,
		commitFiles: [],
		commitStat: null,
		commitDiffs: [],
		treePath: null,
		treeCollapsed: new Set(),
		treeAll: false,
		lazyTree: new Map(),
		lazyExpanded: new Set(),
		lazyLoading: new Set(),
		changePath: null,
		changeStaged: false,
		changeDiff: null,
		picked: new Set(),
		// il diff parte unito; affiancato resta una scelta della sessione, non una preferenza salvata
		diffLayout: "unified",
		tab: "commit",
		searchQuery: null,
		side: "commits",
	};
}

/** Le sessioni aperte, per root; `state` è quella attiva (le funzioni la leggono al momento). */
const sessions = new Map<string, State>();
let state: State = emptyState();

/**
 * Le schede aperte sopravvivono alla chiusura della finestra: senza, ogni riavvio ripartiva dal
 * benvenuto e i repository andavano riaperti uno per uno. La lista sta in `localStorage` perché è
 * una vista della finestra, non una preferenza del repository.
 */
const SESSIONS_KEY = "githandler.sessions";
/** Finché l'avvio non ha finito, le aperture parziali non devono sovrascrivere la lista salvata. */
let sessionsReady = false;

interface SavedSessions {
	roots: string[];
	active: string | null;
}

function readSavedSessions(): SavedSessions {
	try {
		const raw = localStorage.getItem(SESSIONS_KEY);
		if (!raw) return { roots: [], active: null };
		const parsed = JSON.parse(raw) as { roots?: unknown; active?: unknown };
		const roots = Array.isArray(parsed.roots)
			? [
					...new Set(
						parsed.roots.filter(
							(root): root is string =>
								typeof root === "string" && root !== ""
						)
					),
			  ]
			: [];
		return {
			roots,
			active: typeof parsed.active === "string" ? parsed.active : null,
		};
	} catch (error) {
		// una lista illeggibile non deve impedire l'avvio: si riparte dal benvenuto
		console.warn("schede salvate non leggibili:", error);
		return { roots: [], active: null };
	}
}

function saveSessions(): void {
	if (!sessionsReady || panelMode) return;
	try {
		localStorage.setItem(
			SESSIONS_KEY,
			JSON.stringify({
				roots: [...sessions.keys()],
				active: state.root || null,
			})
		);
	} catch (error) {
		console.warn("schede non salvate:", error);
	}
}

const ui = {
	repoName: byId("repo-name"),
	repoBranch: byId("repo-branch"),
	repoTabs: byId("repo-tabs"),
	log: byId("log"),
	repoOperation: byId<HTMLButtonElement>("repo-operation"),
	sideRepo: byId("side-repo"),
	sideChanges: byId<HTMLButtonElement>("side-changes"),
	sideCommits: byId<HTMLButtonElement>("side-commits"),
	btnSearchFocus: byId<HTMLButtonElement>("btn-search-focus"),
	repoWatch: byId("repo-watch"),
	repoAccount: byId<HTMLButtonElement>("repo-account"),
	repoSync: byId("repo-sync"),
	panelDetachedChip: byId<HTMLButtonElement>("panel-detached-chip"),
	networkStatus: byId("network-status"),
	networkPhase: byId("network-phase"),
	networkFill: byId("network-fill"),
	networkPct: byId("network-pct"),
	btnOpen: byId<HTMLButtonElement>("btn-open"),
	btnNewTab: byId<HTMLButtonElement>("btn-new-tab"),
	btnClone: byId<HTMLButtonElement>("btn-clone"),
	btnFolder: byId<HTMLButtonElement>("btn-folder"),
	welcome: byId("welcome"),
	welcomeBase: byId("welcome-base"),
	btnWelcomeOpen: byId<HTMLButtonElement>("btn-welcome-open"),
	btnWelcomeCreate: byId<HTMLButtonElement>("btn-welcome-create"),
	btnWelcomeClone: byId<HTMLButtonElement>("btn-welcome-clone"),
	btnWelcomeAccount: byId<HTMLButtonElement>("btn-welcome-account"),
	settingBase: byId<HTMLInputElement>("setting-base"),
	settingLanguage: byId<HTMLSelectElement>("setting-language"),
	settingTheme: byId<HTMLSelectElement>("setting-theme"),
	settingDensity: byId<HTMLSelectElement>("setting-density"),
	settingFontScale: byId<HTMLSelectElement>("setting-font-scale"),
	btnChooseBase: byId<HTMLButtonElement>("btn-choose-base"),
	createDialog: byId<HTMLDialogElement>("create-dialog"),
	createForm: byId<HTMLFormElement>("create-form"),
	createParent: byId<HTMLInputElement>("create-parent"),
	createBrowse: byId<HTMLButtonElement>("create-browse"),
	createName: byId<HTMLInputElement>("create-name"),
	createUserName: byId<HTMLInputElement>("create-user-name"),
	createUserEmail: byId<HTMLInputElement>("create-user-email"),
	createCancel: byId<HTMLButtonElement>("create-cancel"),
	cloneDialog: byId<HTMLDialogElement>("clone-dialog"),
	cloneForm: byId<HTMLFormElement>("clone-form"),
	cloneUrl: byId<HTMLInputElement>("clone-url"),
	cloneParent: byId<HTMLInputElement>("clone-parent"),
	cloneBrowse: byId<HTMLButtonElement>("clone-browse"),
	cloneCancel: byId<HTMLButtonElement>("clone-cancel"),
	cloneTarget: byId("clone-target"),
	accountDialog: byId<HTMLDialogElement>("account-dialog"),
	accountForm: byId<HTMLFormElement>("account-form"),
	accountList: byId("account-list"),
	accountNew: byId<HTMLButtonElement>("account-new"),
	accountRemove: byId<HTMLButtonElement>("account-remove"),
	accountProvider: byId<HTMLSelectElement>("account-provider"),
	accountHost: byId<HTMLInputElement>("account-host"),
	accountApiField: byId("account-api-field"),
	accountApiBase: byId<HTMLInputElement>("account-api-base"),
	accountUsername: byId<HTMLInputElement>("account-username"),
	accountToken: byId<HTMLInputElement>("account-token"),
	accountOauthClientField: byId("account-oauth-client-field"),
	accountOauthClient: byId<HTMLInputElement>("account-oauth-client"),
	accountOauthClientHelp: byId<HTMLButtonElement>(
		"account-oauth-client-help"
	),
	accountClaim: byId<HTMLButtonElement>("account-claim"),
	accountOauthStart: byId<HTMLButtonElement>("account-oauth-start"),
	accountTokenPage: byId<HTMLButtonElement>("account-token-page"),
	accountOauthStatus: byId("account-oauth-status"),
	accountLabel: byId<HTMLInputElement>("account-label"),
	accountSave: byId<HTMLButtonElement>("account-save"),
	accountStatus: byId("account-status"),
	btnLoadRepos: byId<HTMLButtonElement>("btn-load-repos"),
	btnMoreRepos: byId<HTMLButtonElement>("btn-more-repos"),
	accountFilter: byId<HTMLInputElement>("account-filter"),
	remoteRepos: byId("remote-repos"),
	accountDest: byId<HTMLInputElement>("account-dest"),
	accountDestBrowse: byId<HTMLButtonElement>("account-dest-browse"),
	accountClose: byId<HTMLButtonElement>("account-close"),
	fileDialog: byId<HTMLDialogElement>("file-dialog"),
	fileForm: byId<HTMLFormElement>("file-form"),
	fileFilter: byId<HTMLInputElement>("file-filter"),
	fileList: byId("file-list"),
	fileStatus: byId("file-status"),
	fileOpen: byId<HTMLButtonElement>("file-open"),
	fileBrowser: byId<HTMLButtonElement>("file-browser"),
	fileClose: byId<HTMLButtonElement>("file-close"),
	actionsDialog: byId<HTMLDialogElement>("actions-dialog"),
	actionsForm: byId<HTMLFormElement>("actions-form"),
	actionsList: byId("actions-list"),
	actionsStatus: byId("actions-status"),
	actionsRefresh: byId<HTMLButtonElement>("actions-refresh"),
	actionsClose: byId<HTMLButtonElement>("actions-close"),
	actionsDispatch: byId<HTMLButtonElement>("actions-dispatch"),
	dispatchDialog: byId<HTMLDialogElement>("dispatch-dialog"),
	dispatchForm: byId<HTMLFormElement>("dispatch-form"),
	dispatchWorkflow: byId<HTMLSelectElement>("dispatch-workflow"),
	dispatchRef: byId<HTMLInputElement>("dispatch-ref"),
	dispatchInputs: byId<HTMLTextAreaElement>("dispatch-inputs"),
	dispatchStatus: byId("dispatch-status"),
	dispatchStart: byId<HTMLButtonElement>("dispatch-start"),
	dispatchClose: byId<HTMLButtonElement>("dispatch-close"),
	pullsDialog: byId<HTMLDialogElement>("pulls-dialog"),
	pullsForm: byId<HTMLFormElement>("pulls-form"),
	pullsTitle: byId("pulls-title"),
	pullsList: byId("pulls-list"),
	pullsStatus: byId("pulls-status"),
	pullsRefresh: byId<HTMLButtonElement>("pulls-refresh"),
	pullsOpenPage: byId<HTMLButtonElement>("pulls-open-page"),
	pullsClose: byId<HTMLButtonElement>("pulls-close"),
	pullsNewTitle: byId<HTMLInputElement>("pulls-new-title"),
	pullsNewBody: byId<HTMLTextAreaElement>("pulls-new-body"),
	pullsNewSource: byId<HTMLInputElement>("pulls-new-source"),
	pullsNewTarget: byId<HTMLInputElement>("pulls-new-target"),
	pullsCreate: byId<HTMLButtonElement>("pulls-create"),
	commentsDialog: byId<HTMLDialogElement>("comments-dialog"),
	commentsForm: byId<HTMLFormElement>("comments-form"),
	commentsTitle: byId("comments-title"),
	commentsPull: byId("comments-pull"),
	commentsList: byId("comments-list"),
	commentsStatus: byId("comments-status"),
	commentsBody: byId<HTMLTextAreaElement>("comments-body"),
	commentsSend: byId<HTMLButtonElement>("comments-send"),
	commentsRefresh: byId<HTMLButtonElement>("comments-refresh"),
	commentsOpen: byId<HTMLButtonElement>("comments-open"),
	commentsClose: byId<HTMLButtonElement>("comments-close"),
	reflogDialog: byId<HTMLDialogElement>("reflog-dialog"),
	reflogForm: byId<HTMLFormElement>("reflog-form"),
	reflogList: byId("reflog-list"),
	reflogStatus: byId("reflog-status"),
	reflogRefresh: byId<HTMLButtonElement>("reflog-refresh"),
	reflogClose: byId<HTMLButtonElement>("reflog-close"),
	contentDialog: byId<HTMLDialogElement>("content-dialog"),
	contentForm: byId<HTMLFormElement>("content-form"),
	contentQuery: byId<HTMLInputElement>("content-query"),
	contentRegex: byId<HTMLInputElement>("content-regex"),
	contentCase: byId<HTMLInputElement>("content-case"),
	contentList: byId("content-list"),
	contentStatus: byId("content-status"),
	contentClose: byId<HTMLButtonElement>("content-close"),
	healthDialog: byId<HTMLDialogElement>("health-dialog"),
	healthForm: byId<HTMLFormElement>("health-form"),
	healthList: byId("health-list"),
	healthStatus: byId("health-status"),
	healthRefresh: byId<HTMLButtonElement>("health-refresh"),
	healthRemotes: byId<HTMLButtonElement>("health-remotes"),
	healthRemotesList: byId("health-remotes-list"),
	healthClose: byId<HTMLButtonElement>("health-close"),
	recoveryDialog: byId<HTMLDialogElement>("recovery-dialog"),
	recoveryForm: byId<HTMLFormElement>("recovery-form"),
	recoveryList: byId("recovery-list"),
	recoveryStatus: byId("recovery-status"),
	recoveryRefresh: byId<HTMLButtonElement>("recovery-refresh"),
	recoveryClose: byId<HTMLButtonElement>("recovery-close"),
	worktreeDialog: byId<HTMLDialogElement>("worktree-dialog"),
	worktreeForm: byId<HTMLFormElement>("worktree-form"),
	worktreeList: byId("worktree-list"),
	worktreeStatus: byId("worktree-status"),
	worktreePath: byId<HTMLInputElement>("worktree-path"),
	worktreeBranch: byId<HTMLInputElement>("worktree-branch"),
	worktreeChoose: byId<HTMLButtonElement>("worktree-choose"),
	worktreeCreate: byId<HTMLButtonElement>("worktree-create"),
	worktreeRefresh: byId<HTMLButtonElement>("worktree-refresh"),
	worktreeClose: byId<HTMLButtonElement>("worktree-close"),
	rebaseDialog: byId<HTMLDialogElement>("rebase-dialog"),
	rebaseForm: byId<HTMLFormElement>("rebase-form"),
	rebaseList: byId("rebase-list"),
	rebaseRange: byId("rebase-range"),
	rebaseStatus: byId("rebase-status"),
	rebaseError: byId("rebase-error"),
	rebaseCancel: byId<HTMLButtonElement>("rebase-cancel"),
	rebaseApply: byId<HTMLButtonElement>("rebase-apply"),
	btnUndo: byId<HTMLButtonElement>("btn-undo"),
	btnRefresh: byId<HTMLButtonElement>("btn-refresh"),
	btnFetch: byId<HTMLButtonElement>("btn-fetch"),
	btnPull: byId<HTMLButtonElement>("btn-pull"),
	btnPush: byId<HTMLButtonElement>("btn-push"),
	btnStash: byId<HTMLButtonElement>("btn-stash"),
	btnSubmodule: byId<HTMLButtonElement>("btn-submodule"),
	btnSettings: byId<HTMLButtonElement>("btn-settings"),
	searchInput: byId<HTMLInputElement>("search-input"),
	searchInfo: byId("search-info"),
	btnSearchClear: byId<HTMLButtonElement>("btn-search-clear"),
	listBranches: byId("list-branches"),
	listRemotes: byId("list-remotes"),
	listTags: byId("list-tags"),
	newBranchForm: byId<HTMLFormElement>("new-branch-form"),
	newBranchName: byId<HTMLInputElement>("new-branch-name"),
	btnNewBranch: byId<HTMLButtonElement>("btn-new-branch"),
	commitCount: byId("commit-count"),
	tabCommit: byId<HTMLButtonElement>("tab-commit"),
	tabTree: byId<HTMLButtonElement>("tab-tree"),
	tabBlame: byId<HTMLButtonElement>("tab-blame"),
	tabTerm: byId<HTMLButtonElement>("tab-term"),
	main: byId("main"),
	panes: byId("panes"),
	panelTerm: byId("panel-term"),
	panelCommit: byId("panel-commit"),
	panelTree: byId("panel-tree"),
	panelBlame: byId("panel-blame"),
	treeList: byId("tree-list"),
	treeDiff: byId("tree-diff"),
	treeTitle: byId("tree-title"),
	btnTreeMode: byId<HTMLButtonElement>("btn-tree-mode"),
	btnTreeToggle: byId<HTMLButtonElement>("btn-tree-toggle"),
	blamePath: byId("blame-path"),
	changesCount: byId("changes-count"),
	changesListStaged: byId("changes-list-staged"),
	changesListUnstaged: byId("changes-list-unstaged"),
	changesDiff: byId("changes-diff"),
	commitHead: byId("commit-head"),
	commitDiff: byId("commit-diff"),
	commitMessage: byId<HTMLTextAreaElement>("commit-message"),
	commitError: byId<HTMLPreElement>("commit-error"),
	commitAll: byId<HTMLInputElement>("commit-all"),
	commitSign: byId<HTMLInputElement>("commit-sign"),
	btnCommit: byId<HTMLButtonElement>("btn-commit"),
	btnStageAll: byId<HTMLButtonElement>("btn-stage-all"),
	btnUnstageAll: byId<HTMLButtonElement>("btn-unstage-all"),
	settingsDialog: byId<HTMLDialogElement>("settings-dialog"),
	settingsForm: byId<HTMLFormElement>("settings-form"),
	apiTools: byId("api-tools"),
	settingTrash: byId<HTMLInputElement>("setting-trash"),
	settingTrashBytes: byId<HTMLInputElement>("setting-trash-bytes"),
	settingTrashFiles: byId<HTMLInputElement>("setting-trash-files"),
	settingTrashQuota: byId<HTMLInputElement>("setting-trash-quota"),
	trashUsage: byId("trash-usage"),
	settingsCancel: byId<HTMLButtonElement>("settings-cancel"),
	ctxMenu: byId("ctx-menu"),
	paletteDialog: byId<HTMLDialogElement>("palette-dialog"),
	paletteInput: byId<HTMLInputElement>("palette-input"),
	paletteList: byId("palette-list"),
	keysDialog: byId<HTMLDialogElement>("keys-dialog"),
	stashDialog: byId<HTMLDialogElement>("stash-dialog"),
	stashMessage: byId<HTMLInputElement>("stash-message"),
	stashPaths: byId("stash-paths"),
	stashAll: byId<HTMLButtonElement>("stash-all"),
	stashNone: byId<HTMLButtonElement>("stash-none"),
	stashPartialHint: byId("stash-partial-hint"),
	stashList: byId("stash-list"),
	btnStashSave: byId<HTMLButtonElement>("btn-stash-save"),
	stashClose: byId<HTMLButtonElement>("stash-close"),
	submoduleDialog: byId<HTMLDialogElement>("submodule-dialog"),
	submoduleList: byId("submodule-list"),
	btnSubmoduleUpdate: byId<HTMLButtonElement>("btn-submodule-update"),
	submoduleClose: byId<HTMLButtonElement>("submodule-close"),
	inputDialog: byId<HTMLDialogElement>("input-dialog"),
	inputForm: byId<HTMLFormElement>("input-form"),
	inputTitle: byId("input-title"),
	inputLabel: byId("input-label"),
	inputField: byId<HTMLInputElement>("input-field"),
	inputCancel: byId<HTMLButtonElement>("input-cancel"),
	termOutput: byId("term-output"),
	termForm: byId<HTMLFormElement>("term-form"),
	termInput: byId<HTMLInputElement>("term-input"),
	termStop: byId<HTMLButtonElement>("term-stop"),
	splitter: byId("bottom-splitter"),
	btnBottomCollapse: byId<HTMLButtonElement>("btn-bottom-collapse"),
	btnBottomDetach: byId<HTMLButtonElement>("btn-bottom-detach"),
	conflictDialog: byId<HTMLDialogElement>("conflict-dialog"),
	conflictOperation: byId("conflict-operation"),
	conflictFiles: byId("conflict-files"),
	conflictPath: byId("conflict-path"),
	conflictStages: byId("conflict-stages"),
	conflictHunks: byId("conflict-hunks"),
	conflictEditor: byId<HTMLTextAreaElement>("conflict-editor"),
	conflictStatus: byId("conflict-status"),
	conflictContinue: byId<HTMLButtonElement>("conflict-continue"),
	conflictUseOurs: byId<HTMLButtonElement>("conflict-use-ours"),
	conflictUseTheirs: byId<HTMLButtonElement>("conflict-use-theirs"),
	conflictMark: byId<HTMLButtonElement>("conflict-mark"),
	conflictApply: byId<HTMLButtonElement>("conflict-apply-hunks"),
	conflictSave: byId<HTMLButtonElement>("conflict-save"),
	conflictAbort: byId<HTMLButtonElement>("conflict-abort"),
	conflictClose: byId<HTMLButtonElement>("conflict-close"),
	toast: byId("toast"),
};

const BOTTOM_KEY = "githandler.bottomPanel";

interface BottomLayout {
	height: number;
	collapsed: boolean;
}

function savedBottom(): BottomLayout {
	try {
		const raw = localStorage.getItem(BOTTOM_KEY);
		if (!raw) return { height: 44, collapsed: false };
		const parsed = JSON.parse(raw) as Partial<BottomLayout>;
		const height = Number(parsed.height);
		return {
			height: Number.isFinite(height)
				? Math.min(78, Math.max(18, height))
				: 44,
			collapsed: parsed.collapsed === true,
		};
	} catch (error) {
		console.warn("layout del pannello non leggibile:", error);
		return { height: 44, collapsed: false };
	}
}

const bottomLayout = savedBottom();
let bottomCollapsed = bottomLayout.collapsed;

function applyBottomLayout(): void {
	ui.main.style.setProperty("--bottom-h", `${bottomLayout.height}%`);
	ui.main.classList.toggle("is-collapsed", bottomCollapsed);
	ui.btnBottomCollapse.textContent = bottomCollapsed ? "▴" : "▾";
	ui.btnBottomCollapse.title = bottomCollapsed
		? "Espandi il pannello"
		: "Riduci il pannello";
}

function saveBottomLayout(): void {
	try {
		localStorage.setItem(BOTTOM_KEY, JSON.stringify(bottomLayout));
	} catch (error) {
		console.warn("layout del pannello non salvato:", error);
	}
}

if (!panelMode) applyBottomLayout();

const logView = new LogView({
	onSelect: (sha) => void selectCommit(sha),
	onEndReached: () => void loadMore(),
});
const blameView = new BlameView();

let toastTimer: number | undefined;

function toast(message: string, kind: "error" | "ok" = "error"): void {
	ui.toast.textContent = t(message);
	ui.toast.classList.remove("hidden", "is-ok");
	if (kind === "ok") ui.toast.classList.add("is-ok");
	window.clearTimeout(toastTimer);
	toastTimer = window.setTimeout(
		() => ui.toast.classList.add("hidden"),
		5000
	);
}

/** `window.confirm` con il messaggio tradotto: la conferma è dell'utente, non della lingua. */
function askConfirm(message: string): boolean {
	return window.confirm(t(message));
}

/** Il messaggio vero, senza il prefisso che Electron aggiunge agli errori IPC. */
function readableError(error: unknown): string {
	const message = error instanceof Error ? error.message : String(error);
	return message.replace(
		/^Error invoking remote method '[^']+': (Error: )?/,
		""
	);
}

/**
 * Una lettura asincrona vale solo nella sessione che l'ha chiesta: senza questo controllo un diff
 * arrivato in ritardo finirebbe sul repository aperto nel frattempo.
 */
function isActive(root: string): boolean {
	return state.root === root;
}

/** Esegue un'operazione Git mostrando l'errore reale invece di fallire in silenzio. */
async function guard<T>(
	label: string,
	task: () => Promise<T>
): Promise<T | null> {
	try {
		return await task();
	} catch (error) {
		toast(`${t(label)}: ${readableError(error)}`);
		return null;
	}
}

/**
 * Come `guard`, ma dopo l'errore rilegge lo stato: merge, rebase e cherry-pick possono essere
 * rimasti a metà, e il chip «annulla» deve comparire subito, non al prossimo refresh.
 */
async function guardRepo<T>(
	label: string,
	task: () => Promise<T>
): Promise<T | null> {
	try {
		return await task();
	} catch (error) {
		toast(`${t(label)}: ${readableError(error)}`);
		try {
			applySnapshot(await api.refresh());
		} catch (refreshError) {
			console.warn("stato non rileggibile dopo l'errore:", refreshError);
		}
		// Un merge, rebase o cherry-pick che si ferma sui conflitti è un caso previsto:
		// si apre subito la risoluzione invece di lasciare solo il messaggio di Git.
		if (state.snapshot?.info.operation) {
			await openConflicts();
			if (conflictFiles.length > 0)
				toast(
					t(
						"Operazione fermata dai conflitti: scegli qui sotto la versione da tenere."
					)
				);
		}
		return null;
	}
}

/** La finestra dei dettagli è aperta: solo allora vale la pena pubblicare la selezione. */
let panelDetached = false;
let panelPublishTimer: number | undefined;

function panelSnapshot(): PanelStateInput {
	return {
		tab: state.tab,
		selectedCommit: state.selectedCommit,
		changePath: state.changePath,
		changeStaged: state.changeStaged,
		treePath: state.treePath,
		layout: state.diffLayout,
	};
}

/** Manda alla finestra staccata cosa si sta guardando: la pubblicazione è debounced. */
function publishPanel(): void {
	if (panelMode || !panelDetached || !state.root) return;
	window.clearTimeout(panelPublishTimer);
	panelPublishTimer = window.setTimeout(() => {
		void api.syncPanel(panelSnapshot()).catch((error: Error) => {
			console.warn("pannello non sincronizzato:", error);
		});
	}, 30);
}

let pendingPanelState: PanelState | null = null;
let panelApplyToken = 0;

/**
 * La finestra staccata segue la principale: stessa scheda, stesso commit, stesso file. Il pannello
 * non pubblica niente, quindi non può innescare un anello di sincronizzazione.
 */
async function applyPanelState(payload: PanelState): Promise<void> {
	if (!panelMode) return;
	if (payload.root !== state.root) {
		await followPanelRepo(payload.root, payload.selectedCommit);
		if (payload.root !== state.root) return;
	}

	const token = ++panelApplyToken;
	if (
		payload.selectedCommit &&
		payload.selectedCommit !== state.selectedCommit
	) {
		await selectCommit(payload.selectedCommit);
		if (token !== panelApplyToken) return;
	}
	if (payload.changePath && payload.changePath !== state.changePath) {
		await selectChange(payload.changePath, payload.changeStaged);
		if (token !== panelApplyToken) return;
	}
	if (
		payload.tab === "tree" &&
		payload.treePath &&
		payload.treePath !== state.treePath
	) {
		await selectTreeFile(payload.treePath);
		if (token !== panelApplyToken) return;
	}
	if (payload.layout !== state.diffLayout) setDiffLayout(payload.layout);
	if (payload.tab !== state.tab) setTab(payload.tab);
}

/**
 * Ultimo commit guardato nel pannello, per repository: quando la finestra principale non ne indica
 * uno (repository appena aperto, pubblicazione non ancora arrivata) il pannello riapre questo
 * invece del primo della storia.
 */
const PANEL_COMMIT_KEY = "githandler.panelCommit";

function readPanelCommits(): Record<string, string> {
	try {
		const parsed: unknown = JSON.parse(
			localStorage.getItem(PANEL_COMMIT_KEY) ?? "{}"
		);
		if (typeof parsed !== "object" || parsed === null) return {};
		const result: Record<string, string> = {};
		for (const [root, sha] of Object.entries(parsed)) {
			if (typeof sha === "string" && /^[0-9a-f]{7,64}$/.test(sha))
				result[root] = sha;
		}
		return result;
	} catch (error) {
		console.warn("ultimo commit del pannello non leggibile:", error);
		return {};
	}
}

function rememberedPanelCommit(root: string): string | null {
	return readPanelCommits()[root] ?? null;
}

function rememberPanelCommit(root: string, sha: string | null): void {
	if (!panelMode || !root || !sha) return;
	try {
		const commits = readPanelCommits();
		if (commits[root] === sha) return;
		commits[root] = sha;
		localStorage.setItem(PANEL_COMMIT_KEY, JSON.stringify(commits));
	} catch (error) {
		console.warn("ultimo commit del pannello non salvato:", error);
	}
}

/** Il pannello segue il repository attivo della finestra principale, senza chiedere niente. */
async function followPanelRepo(
	root: string,
	mainSelection: string | null
): Promise<void> {
	if (state.root === root && state.snapshot) return;
	try {
		// la sessione lasciata indietro può avere una selezione più recente di quella salvata
		const previous = sessions.get(root)?.selectedCommit ?? null;
		const restore =
			mainSelection ?? previous ?? rememberedPanelCommit(root);
		await api.use(root);
		const snapshot = await api.refresh();
		const session = emptyState(root);
		session.snapshot = snapshot;
		session.commits = snapshot.commits;
		session.hasMore = snapshot.hasMore;
		// prima di `renderSession`: senza selezione `loadLog` aprirebbe il primo commit della storia
		session.selectedCommit = restore;
		sessions.clear();
		sessions.set(root, session);
		state = session;
		renderSession();
		if (restore) await selectCommit(restore);
	} catch (error) {
		toast(`Cambio repository: ${readableError(error)}`);
	}
}

// ── rendering ────────────────────────────────────────────────────────────────

/**
 * Applica la fotografia del repository attivo. Un aggiornamento che arriva per un'altra scheda
 * finisce nella sua sessione: le risposte in ritardo non possono sovrascrivere la vista corrente.
 */
function applySnapshot(snapshot: Snapshot): void {
	if (snapshot.info.root !== state.root) {
		const other = sessions.get(snapshot.info.root);
		if (other) {
			other.snapshot = snapshot;
			other.commits = snapshot.commits;
			other.hasMore = snapshot.hasMore;
			other.loadingMore = false;
		}
		return;
	}

	const previousHead = state.snapshot?.commits[0]?.sha ?? null;
	state.snapshot = snapshot;
	// un commit nuovo cambia l'albero di HEAD: le cartelle già lette vanno rilette
	if (!state.selectedCommit && previousHead !== (snapshot.commits[0]?.sha ?? null)) {
		state.lazyTree.clear();
		state.lazyLoading.clear();
	}
	// il refresh riparte dalla prima pagina: le pagine accumulate non valgono più
	state.commits = snapshot.commits;
	state.hasMore = snapshot.hasMore;
	state.loadingMore = false;

	if (
		state.selectedCommit &&
		!state.commits.some((c) => c.sha === state.selectedCommit)
	) {
		state.selectedCommit = null;
	}

	renderHeader(snapshot);
	renderRepoTabs();
	updateCommitCount();
	void loadLog();
	if (state.selectedCommit) logView.select(state.selectedCommit);

	renderRefs(snapshot);
	renderChanges(snapshot);
	renderUndo();
	void updateWatchChip();
	void reloadOpenDiff();
	void refreshRepoAccount();
	if (state.tab === "blame") void loadBlame();
}

/** Nome, ramo, sincronizzazione e operazione sospesa del repository attivo. */
function renderHeader(snapshot: Snapshot | null): void {
	ui.repoName.textContent = snapshot?.info.name ?? t("nessun repository");
	ui.sideRepo.textContent = snapshot?.info.name ?? "—";
	ui.repoBranch.textContent = snapshot?.info.branch ?? "—";
	if (!snapshot) {
		ui.repoSync.classList.add("hidden");
		ui.repoAccount.classList.add("hidden");
		ui.btnPull.disabled = true;
		ui.btnPush.disabled = true;
		renderOperation(null);
		return;
	}
	renderRepoAccount();
	const { ahead, behind } = snapshot.status;
	ui.repoSync.textContent = `↑${ahead} ↓${behind}`;
	ui.repoSync.classList.remove("hidden");
	// i comandi restano attivi: se manca il remoto Git lo dice, e il messaggio è più utile
	ui.btnPull.disabled = false;
	ui.btnPush.disabled = false;
	renderOperation(snapshot);
}

/** Merge, rebase o cherry-pick lasciato a metà: un clic lo annulla. */
function renderOperation(snapshot: Snapshot | null): void {
	const operation = snapshot?.info.operation ?? null;
	ui.repoOperation.classList.toggle("hidden", operation === null);
	if (!operation) return;
	const label =
		operation === "merge"
			? "Merge in corso"
			: operation === "rebase"
			? "Rebase in corso"
			: "Cherry-pick in corso";
	ui.repoOperation.textContent = t(`${label} · risolvi`);
	ui.repoOperation.dataset.operation = operation;
}

// ── account del repository ──────────────────────────────────────────────────

/**
 * Quale account tiene questo repository. La risposta viene dal main, che applica le regole
 * (`chooseRepoAccount`): scelta salvata, proprietario del remoto, unico account, altrimenti il
 * primo — e in quel caso il chip lo dice, invece di far finta che sia una certezza.
 */
let repoAccountCache: { root: string; choice: AccountChoice } | null = null;
let repoAccountRequest = 0;

async function refreshRepoAccount(): Promise<void> {
	const root = state.root;
	const request = ++repoAccountRequest;
	if (!root) {
		repoAccountCache = null;
		renderRepoAccount();
		return;
	}
	try {
		const choice = await api.repoAccount();
		if (request !== repoAccountRequest) return;
		repoAccountCache = { root, choice };
	} catch (error) {
		if (request !== repoAccountRequest) return;
		console.warn("account del repository:", readableError(error));
		repoAccountCache = null;
	}
	renderRepoAccount();
}

function accountReasonText(choice: AccountChoice): string {
	switch (choice.reason) {
		case "saved":
			return "scelto da te per questo repository";
		case "owner":
			return "l'utente corrisponde al proprietario del remoto";
		case "single":
			return "unico account collegato per questo host";
		case "first":
			return "primo di più account per questo host: clic per scegliere";
		default:
			return choice.host
				? `nessun account collegato per ${choice.host}`
				: "il remoto non è un servizio web conosciuto";
	}
}

function renderRepoAccount(): void {
	const chip = ui.repoAccount;
	if (!state.snapshot) {
		chip.classList.add("hidden");
		return;
	}
	chip.classList.remove("hidden");
	const cached =
		repoAccountCache && repoAccountCache.root === state.root
			? repoAccountCache.choice
			: null;
	if (!cached) {
		chip.textContent = "account…";
		chip.classList.remove("is-guess");
		chip.disabled = true;
		chip.title = t("Sto leggendo il remoto…");
		return;
	}
	chip.disabled = false;
	const account = cached.account;
	chip.textContent = account ? accountLabel(account) : t("nessun account");
	chip.classList.toggle("is-guess", cached.reason === "first");
	chip.title = account
		? `${accountLabel(account)} — ${accountReasonText(
				cached
		  )}. Clic per cambiare.`
		: `Nessun account per questo repository: ${accountReasonText(cached)}.`;
}

function openRepoAccountMenu(x: number, y: number): void {
	const cached =
		repoAccountCache && repoAccountCache.root === state.root
			? repoAccountCache.choice
			: null;
	const entries: Array<MenuEntry | "separator"> = [];
	if (!cached) {
		entries.push({
			label: "Sto leggendo il remoto…",
			disabled: true,
			hint: "GitHandler sta interrogando il remoto per capire quale account usare.",
		});
	} else if (cached.candidates.length === 0) {
		entries.push({
			label: cached.host
				? `Nessun account per ${cached.host}`
				: "Il remoto non è un servizio web conosciuto",
			disabled: true,
			hint: cached.host
				? "Non c'è un account salvato per questo host: aggiungine uno con «Gestisci account…»."
				: "Il remoto non punta a GitHub, GitLab, Gitea o Bitbucket: per questo repository non serve un account.",
		});
	} else {
		for (const account of cached.candidates) {
			const active = account.id === cached.account?.id;
			entries.push({
				label: `${accountLabel(account)} · ${account.host}${
					active ? " ✓" : ""
				}`,
				hint: "Usa questo account per i comandi Git di questo repository (fetch, pull, push, fork e Actions).",
				action: () => void chooseRepoAccount(account.id),
			});
		}
		entries.push("separator", {
			label: "Automatico (togli la scelta salvata)",
			disabled: cached.reason !== "saved",
			hint: "Torna a dedurre l'account dal proprietario del remoto.",
			action: () => void chooseRepoAccount(null),
		});
	}
	entries.push("separator", {
		label: "Gestisci account…",
		hint: "Apre l'elenco degli account: aggiungi, rimuovi e cerca i repository.",
		action: () => void openAccounts(),
	});
	openMenu(x, y, entries);
}

async function chooseRepoAccount(id: string | null): Promise<void> {
	const choice = await guard("Account del repository", () =>
		api.setRepoAccount(id)
	);
	if (!choice) return;
	repoAccountCache = { root: state.root, choice };
	renderRepoAccount();
	toast(
		choice.account
			? `Questo repository usa ${accountLabel(choice.account)}.`
			: "Scelta tolta: l'account viene dedotto dal remoto.",
		"ok"
	);
}

/** Schede dei repository aperti: una per sessione, con la chiusura. */
function renderRepoTabs(): void {
	clear(ui.repoTabs);
	for (const session of sessions.values()) {
		const tab = el("button", "repo-tab");
		tab.dataset.root = session.root;
		tab.title = session.root;
		if (session.root === state.root) tab.classList.add("is-active");
		tab.appendChild(
			el("span", "repo-tab-name", session.snapshot?.info.name ?? "…")
		);
		tab.appendChild(
			el(
				"span",
				"repo-tab-branch",
				session.snapshot?.info.branch ?? "detached"
			)
		);
		const close = el("span", "repo-tab-close", "×");
		close.dataset.close = session.root;
		close.title = t("Chiudi la scheda");
		tab.appendChild(close);
		ui.repoTabs.appendChild(tab);
	}
	// il «+» torna in fondo dopo le schede
	ui.repoTabs.appendChild(ui.btnNewTab);
}

/** Ridisegna la sessione attiva senza tornare a Git (cambio scheda). */
function renderSession(): void {
	const snapshot = state.snapshot;
	updateEmptyState();
	renderHeader(snapshot);
	renderRepoTabs();
	renderUndo();
	renderOperation(snapshot);

	if (!snapshot) {
		logView.setData([], []);
		logView.setEmptyMessage("Nessun repository aperto.");
		ui.commitCount.textContent = "—";
		return;
	}

	renderRefs(snapshot);
	renderChanges(snapshot);
	void loadLog();
	if (state.selectedCommit) logView.select(state.selectedCommit);
	updateCommitCount();
	renderCommitHead();
	if (state.tab === "tree") renderTree(snapshot);
	setSide(state.side);
	if (state.side === "commits") {
		if (state.tab === "blame") void loadBlame();
		if (state.tab === "term") renderTerminal();
	}
	void reloadOpenDiff();
	void updateWatchChip();
	publishPanel();
}

function updateCommitCount(): void {
	const total = state.commits.length;
	ui.commitCount.textContent = t(
		state.hasMore
			? `${total}+ commit — scorri per caricarne altri`
			: `${total} commit`
	);
}

/** La sorveglianza parte quando il repository è aperto: il chip va aggiornato dopo, non al boot. */
async function updateWatchChip(): Promise<void> {
	try {
		ui.repoWatch.classList.toggle("hidden", !(await api.watching()));
	} catch (error) {
		console.warn("stato della sorveglianza non disponibile:", error);
	}
}

// ── impostazioni ─────────────────────────────────────────────────────────────

function currentApiMode(): ApiMode {
	const checked = ui.settingsForm.querySelector<HTMLInputElement>(
		"input[name=api-mode]:checked"
	);
	return checked?.value === "read" ||
		checked?.value === "all" ||
		checked?.value === "custom"
		? checked.value
		: "off";
}

/** I tool si scelgono solo in modalità selettiva; negli altri modi la lista non conta. */
function updateApiToolState(): void {
	const custom = currentApiMode() === "custom";
	for (const box of ui.apiTools.querySelectorAll<HTMLInputElement>(
		"input[type=checkbox]"
	)) {
		box.disabled = !custom;
	}
}

/** I limiti si applicano solo con la copia attiva: spenta, non ha senso modificarli. */
function updateTrashState(): void {
	const enabled = ui.settingTrash.checked;
	for (const input of [
		ui.settingTrashBytes,
		ui.settingTrashFiles,
		ui.settingTrashQuota,
	]) {
		input.disabled = !enabled;
	}
}

/** Byte → MB per i campi della UI (interi, come li mostra il dialog). */
function toMebibytes(bytes: number): number {
	return Math.round(bytes / MEBIBYTE);
}

/** MB → byte; un campo vuoto o non numerico torna al default, non a zero. */
function readMebibytes(input: HTMLInputElement, fallback: number): number {
	const value = Number.parseFloat(input.value.replace(",", "."));
	return Number.isFinite(value) ? Math.round(value * MEBIBYTE) : fallback;
}

function readCount(input: HTMLInputElement, fallback: number): number {
	const value = Number.parseInt(input.value, 10);
	return Number.isFinite(value) ? value : fallback;
}

/** Dimensione leggibile con le stesse unità dei campi: 0 B, 512 kB, 12,4 MB, 1,2 GB. */
function formatBytes(bytes: number): string {
	if (bytes < 1024) return `${bytes} B`;
	const units = ["kB", "MB", "GB", "TB"];
	let value = bytes / 1024;
	let unit = 0;
	while (value >= 1024 && unit < units.length - 1) {
		value /= 1024;
		unit++;
	}
	const text = value.toLocaleString(localeTag(), {
		maximumFractionDigits: 1,
	});
	return `${text} ${units[unit]}`;
}

/**
 * Le scelte «account per repository» non si modificano da questa finestra: si riportano com'erano,
 * altrimenti salvare le impostazioni le cancellerebbe.
 */
let savedRepoAccounts: Record<string, string> = {};
/** Appearance shown by the open dialog: cancel restores it, save replaces it. */
let dialogAppearance: AppearanceSettings = { ...APPEARANCE_DEFAULTS };

function readAppearanceFromForm(): AppearanceSettings {
	return {
		theme: ui.settingTheme.value as AppearanceSettings["theme"],
		density: ui.settingDensity.value as AppearanceSettings["density"],
		fontScale: ui.settingFontScale.value as AppearanceSettings["fontScale"],
	};
}

function fillSettings(settings: Settings): void {
	savedRepoAccounts = settings.repoAccounts;
	dialogAppearance = settings.appearance;
	for (const radio of ui.settingsForm.querySelectorAll<HTMLInputElement>(
		"input[name=api-mode]"
	)) {
		radio.checked = radio.value === settings.api.mode;
	}
	for (const box of ui.apiTools.querySelectorAll<HTMLInputElement>(
		"input[type=checkbox]"
	)) {
		box.checked = settings.api.tools.includes(box.value as ApiTool);
	}
	ui.settingBase.value = settings.defaultRoot ?? "";
	ui.settingLanguage.value = settings.locale;
	ui.settingTheme.value = settings.appearance.theme;
	ui.settingDensity.value = settings.appearance.density;
	ui.settingFontScale.value = settings.appearance.fontScale;
	setBaseFolder(settings.defaultRoot);
	ui.settingTrash.checked = settings.trash.enabled;
	ui.settingTrashBytes.value = String(toMebibytes(settings.trash.maxBytes));
	ui.settingTrashFiles.value = String(settings.trash.maxFiles);
	ui.settingTrashQuota.value = String(toMebibytes(settings.trash.quotaBytes));
	updateApiToolState();
	updateTrashState();
}

function collectSettings(): Settings {
	const mode = currentApiMode();
	const tools: ApiTool[] = [];
	if (mode === "custom") {
		for (const box of ui.apiTools.querySelectorAll<HTMLInputElement>(
			"input[type=checkbox]"
		)) {
			if (
				box.checked &&
				(API_TOOLS as readonly string[]).includes(box.value)
			)
				tools.push(box.value as ApiTool);
		}
	}
	return {
		api: { mode, tools },
		locale: ui.settingLanguage.value as Settings["locale"],
		appearance: readAppearanceFromForm(),
		defaultRoot: ui.settingBase.value.trim() || null,
		repoAccounts: savedRepoAccounts,
		trash: {
			enabled: ui.settingTrash.checked,
			maxBytes: readMebibytes(
				ui.settingTrashBytes,
				TRASH_DEFAULTS.maxBytes
			),
			maxFiles: readCount(ui.settingTrashFiles, TRASH_DEFAULTS.maxFiles),
			quotaBytes: readMebibytes(
				ui.settingTrashQuota,
				TRASH_DEFAULTS.quotaBytes
			),
		},
	};
}

/** Riga informativa sotto i campi: quanto spazio occupano le copie ancora annullabili. */
async function refreshTrashUsage(quotaBytes: number): Promise<void> {
	try {
		const usage: TrashUsage = await api.trashUsage();
		ui.trashUsage.textContent =
			usage.entries === 0
				? t("Nessuna copia conservata.")
				: t(
						`${usage.entries} ${
							usage.entries === 1 ? "copia" : "copie"
						} · ${formatBytes(usage.bytes)} su ${formatBytes(
							quotaBytes
						)}`
				  );
	} catch (error) {
		console.warn("spazio delle copie non disponibile:", error);
		ui.trashUsage.textContent = "";
	}
}

async function openSettings(): Promise<void> {
	const settings = await guard("Impostazioni", () => api.settings());
	if (!settings) return;
	fillSettings(settings);
	ui.settingsDialog.showModal();
	await refreshTrashUsage(settings.trash.quotaBytes);
}

let logRequest = 0;

/** Disegna la storia normale oppure i risultati della ricerca attiva. */
async function loadLog(): Promise<void> {
	const snapshot = state.snapshot;
	if (!snapshot) return;

	const token = ++logRequest;
	const query = state.searchQuery;
	if (!query) {
		logView.setEmptyMessage(
			state.commits.length === 0
				? "Repository senza commit: crea il primo dalla scheda Modifiche."
				: ""
		);
		logView.setData(state.commits, layoutGraph(state.commits));
		ui.searchInfo.textContent = "";
		// senza selezione il pannello Commit resterebbe vuoto all'apertura; nella finestra
		// staccata torna prima l'ultimo commit guardato lì, se c'è
		const remembered = panelMode ? rememberedPanelCommit(state.root) : null;
		if (!state.selectedCommit && (remembered || state.commits[0])) {
			const first = remembered ?? state.commits[0]!.sha;
			if (state.tab === "commit") void selectCommit(first);
			else logView.select(first);
		}
		return;
	}

	const commits = await guard("Ricerca", () => api.search(query));
	if (token !== logRequest || !commits) return;
	logView.setEmptyMessage(
		commits.length === 0 ? t(`Nessun commit per «${query}».`) : ""
	);
	logView.setData(commits, layoutGraph(commits as Commit[]));
	ui.searchInfo.textContent =
		commits.length === 1
			? t("1 risultato")
			: t(`${commits.length} risultati`);
}

/** Pagina successiva della storia: il grafo si rilayouta sull'insieme caricato. */
async function loadMore(): Promise<void> {
	if (state.loadingMore || !state.hasMore || state.searchQuery) return;
	const root = state.root;
	state.loadingMore = true;
	try {
		const page = await guard("Storia", () =>
			api.moreCommits(state.commits.length)
		);
		if (!page || !isActive(root)) return;
		const known = new Set(state.commits.map((commit) => commit.sha));
		const added = page.commits.filter((commit) => !known.has(commit.sha));
		state.commits = state.commits.concat(added);
		state.hasMore = page.hasMore && added.length > 0;
		updateCommitCount();
		if (!state.searchQuery)
			logView.setData(state.commits, layoutGraph(state.commits));
	} finally {
		// la sessione da sbloccare è quella che ha chiesto la pagina, anche se non è più attiva
		const session = sessions.get(root);
		if (session) session.loadingMore = false;
	}
}

async function runSearch(raw: string): Promise<void> {
	const query = raw.trim();
	state.searchQuery = query || null;
	ui.searchInput.value = query;
	ui.btnSearchClear.classList.toggle("hidden", !state.searchQuery);
	await loadLog();
}

function renderUndo(): void {
	const undo = state.snapshot?.undo ?? null;
	ui.btnUndo.disabled = !undo;
	ui.btnUndo.title = undo
		? `${describeUndo(undo)} (Ctrl+Z)`
		: "Niente da annullare";
}

function renderRefs(snapshot: Snapshot): void {
	const groups: Array<[HTMLElement, "local" | "remote" | "tag"]> = [
		[ui.listBranches, "local"],
		[ui.listRemotes, "remote"],
		[ui.listTags, "tag"],
	];

	for (const [container, kind] of groups) {
		clear(container);
		const refs = snapshot.refs.filter((ref) => ref.kind === kind);
		if (refs.length === 0) {
			const empty = el(
				"li",
				"muted",
				kind === "tag" ? t("nessun tag") : "—"
			);
			empty.style.cursor = "default";
			container.appendChild(empty);
			continue;
		}
		for (const ref of refs) {
			const item = el("li");
			if (ref.current) item.classList.add("is-current");
			item.dataset.ref = ref.short;
			item.dataset.kind = ref.kind;
			item.dataset.sha = ref.sha;
			item.appendChild(el("span", "ref-name", ref.short));
			if (ref.ahead || ref.behind) {
				item.appendChild(
					el("span", "ref-track", `↑${ref.ahead} ↓${ref.behind}`)
				);
			}
			item.title = t(
				`Vai al commit di ${ref.short} · tasto destro per le operazioni`
			);
			// il clic non fa checkout: sposta il cursore, come nella storia
			item.addEventListener("click", () => void revealRef(ref.sha));
			item.addEventListener("contextmenu", (event) => {
				event.preventDefault();
				openRefMenu(ref, event.clientX, event.clientY);
			});
			container.appendChild(item);
		}
	}
}

/** Un file è nello stage quando l'indice è cambiato; può comparire in entrambe le liste. */
function renderChanges(snapshot: Snapshot): void {
	const entries = snapshot.status.entries;
	const staged = entries.filter((entry) => entry.index !== ".");
	const unstaged = entries.filter(
		(entry) => entry.kind === "untracked" || entry.worktree !== "."
	);

	renderChangesBadge(entries.length, staged.length, unstaged.length);
	fillChangeList(ui.changesListStaged, staged, true);
	fillChangeList(ui.changesListUnstaged, unstaged, false);
	renderTree(snapshot);
}

/**
 * Il contatore dice a colpo d'occhio se c'è lavoro da fare: sparisce a zero, è verde quando tutto
 * è in stage (basta il commit) e ambra quando qualcosa è ancora fuori.
 */
function renderChangesBadge(
	total: number,
	staged: number,
	unstaged: number
): void {
	const badge = ui.changesCount;
	badge.textContent = String(total);
	badge.classList.toggle("is-zero", total === 0);
	badge.dataset.tone = unstaged === 0 ? "ready" : "dirty";
	badge.title =
		total === 0
			? "Nessuna modifica nel working tree"
			: `${total} file con modifiche · ${staged} in stage, ${unstaged} fuori`;
	ui.sideChanges.title =
		total === 0
			? "Changes — nessuna modifica nel working tree"
			: `Changes — ${total} file con modifiche (${staged} in stage, ${unstaged} fuori)`;
}

function fillChangeList(
	container: HTMLElement,
	entries: StatusEntry[],
	staged: boolean
): void {
	clear(container);
	if (entries.length === 0) {
		const empty = el(
			"li",
			"muted",
			staged ? "Nessun file nello stage." : "Nessuna modifica."
		);
		empty.style.cursor = "default";
		container.appendChild(empty);
		return;
	}

	for (const entry of entries) {
		const item = el("li");
		item.dataset.path = entry.path;
		item.dataset.side = staged ? "staged" : "unstaged";
		if (entry.path === state.changePath && state.changeStaged === staged)
			item.classList.add("is-selected");

		const code =
			entry.kind === "untracked"
				? "?"
				: entry.worktree !== "."
				? entry.worktree
				: entry.index;
		const badgeClass =
			entry.kind === "untracked" ? "st-a" : `st-${code.toLowerCase()}`;
		item.appendChild(el("span", `st ${badgeClass}`, code));
		item.appendChild(el("span", "name", entry.path));

		// un file eliminato non esiste più sul disco: non c'è niente da trascinare
		item.draggable = code !== "D";
		if (item.draggable)
			item.title = t("Trascina fuori per copiare il file.");

		const acts = el("span", "acts");
		const toggle = el("button", "icon-btn", staged ? "−" : "+");
		toggle.dataset.act = staged ? "unstage" : "stage";
		toggle.title = t(staged ? "Togli dallo stage" : "Aggiungi allo stage");
		acts.appendChild(toggle);

		const discard = el("button", "icon-btn", "×");
		discard.dataset.act = "discard";
		discard.title = t("Scarta le modifiche");
		acts.appendChild(discard);

		item.appendChild(acts);
		container.appendChild(item);
	}
}

// ── albero dei file ──────────────────────────────────────────────────────────

interface TreeNode {
	name: string;
	path: string;
	dir: boolean;
	status: string | null;
	children: TreeNode[];
}

function buildTree(files: Array<{ path: string; status: string }>): TreeNode {
	const root: TreeNode = {
		name: "",
		path: "",
		dir: true,
		status: null,
		children: [],
	};

	for (const file of files) {
		const parts = file.path.split("/").filter(Boolean);
		let node = root;
		for (let i = 0; i < parts.length; i++) {
			const dir = i < parts.length - 1;
			const path = parts.slice(0, i + 1).join("/");
			let child = node.children.find(
				(candidate) =>
					candidate.name === parts[i] && candidate.dir === dir
			);
			if (!child) {
				child = {
					name: parts[i]!,
					path,
					dir,
					status: dir ? null : file.status,
					children: [],
				};
				node.children.push(child);
			}
			node = child;
		}
	}

	const sort = (node: TreeNode): void => {
		node.children.sort((a, b) =>
			a.dir === b.dir ? a.name.localeCompare(b.name) : a.dir ? -1 : 1
		);
		for (const child of node.children) sort(child);
	};
	sort(root);
	return root;
}

/** I file dell'albero: quelli del commit selezionato, altrimenti il working tree. */
function treeFiles(
	snapshot: Snapshot
): Array<{ path: string; status: string }> {
	if (state.selectedCommit) {
		return state.commitFiles.map((file) => ({
			path: file.path,
			status: file.status,
		}));
	}
	return snapshot.status.entries.map((entry) => ({
		path: entry.path,
		status:
			entry.kind === "untracked"
				? "?"
				: entry.worktree !== "."
				? entry.worktree
				: entry.index,
	}));
}

/** Badge di stato per un percorso, quando il file è modificato o fa parte del commit. */
function treeStatus(path: string): string | null {
	if (state.selectedCommit) {
		return state.commitFiles.find((file) => file.path === path)?.status ?? null;
	}
	const entry = state.snapshot?.status.entries.find(
		(item) => item.path === path
	);
	if (!entry) return null;
	if (entry.kind === "untracked") return "?";
	return entry.worktree !== "." ? entry.worktree : entry.index;
}

/** Chiede al main un livello dell'albero; la radice è il percorso vuoto. */
async function loadTreeDir(path: string): Promise<void> {
	if (state.lazyLoading.has(path)) return;
	const root = state.root;
	const ref = state.selectedCommit;
	state.lazyLoading.add(path);
	try {
		const entries = await api.treeEntries(ref, path);
		if (!isActive(root) || state.selectedCommit !== ref) return;
		state.lazyTree.set(path, entries);
	} catch (error) {
		toast(`Cartella: ${readableError(error)}`);
		if (isActive(root) && state.selectedCommit === ref)
			state.lazyTree.set(path, []);
	} finally {
		state.lazyLoading.delete(path);
		if (isActive(root) && state.snapshot) renderTree(state.snapshot);
	}
}

/**
 * Albero completo letto una cartella alla volta: la radice parte subito, ogni cartella quando la
 * si apre. Un repository grande non costa più di ciò che si guarda.
 */
function renderLazyTree(): void {
	ui.treeTitle.textContent = t(
		state.selectedCommit
			? "File tree · commit (tutti i file)"
			: "File tree · tutti i file"
	);
	clear(ui.treeList);

	const fragment = document.createDocumentFragment();
	const walk = (path: string, depth: number): void => {
		const entries = state.lazyTree.get(path);
		if (!entries) {
			if (!state.lazyLoading.has(path)) void loadTreeDir(path);
			fragment.appendChild(
				el(
					"div",
					"muted tree-loading",
					t("Leggo la cartella…")
				)
			);
			return;
		}
		for (const entry of entries) {
			const dir = entry.type === "tree";
			const expanded = state.lazyExpanded.has(entry.path);
			const row = el("div", "tree-node");
			if (dir) row.classList.add("is-dir");
			row.style.paddingLeft = `${10 + depth * 14}px`;
			row.dataset.path = entry.path;
			row.dataset.dir = String(dir);
			row.appendChild(
				el(
					"span",
					dir ? "twisty" : "twisty is-leaf",
					dir ? (expanded ? "▾" : "▸") : ""
				)
			);
			const status = treeStatus(entry.path);
			if (status) {
				row.appendChild(
					el(
						"span",
						`st st-${status === "?" ? "a" : status.toLowerCase()}`,
						status
					)
				);
			}
			row.appendChild(el("span", "label", entry.name));
			if (!dir && entry.path === state.treePath)
				row.classList.add("is-selected");
			// solo il working tree ha file sul disco: in un commit il path può non esistere
			if (!dir && !state.selectedCommit && status !== "D") {
				row.draggable = true;
				row.title = t("Trascina fuori per copiare il file.");
			}
			fragment.appendChild(row);
			if (dir && expanded) walk(entry.path, depth + 1);
		}
	};
	walk("", 0);
	ui.treeList.appendChild(fragment);
}

function renderTree(snapshot: Snapshot): void {
	ui.btnTreeMode.textContent = t(
		state.treeAll ? "Modifiche" : "Tutti i file"
	);
	ui.btnTreeMode.title = t(
		state.treeAll
			? "Mostra solo i file modificati o del commit"
			: "Mostra tutti i file del repository, una cartella alla volta"
	);
	if (state.treeAll) {
		renderLazyTree();
		return;
	}

	const files = treeFiles(snapshot);
	ui.treeTitle.textContent = t(
		state.selectedCommit ? "File tree · commit" : "File tree · working tree"
	);
	clear(ui.treeList);

	if (files.length === 0) {
		ui.treeList.appendChild(el("li", "muted", "Nessun file."));
		return;
	}

	const fragment = document.createDocumentFragment();
	const walk = (node: TreeNode, depth: number): void => {
		for (const child of node.children) {
			const collapsed = state.treeCollapsed.has(child.path);
			const row = el("div", "tree-node");
			if (child.dir) row.classList.add("is-dir");
			row.style.paddingLeft = `${10 + depth * 14}px`;
			row.dataset.path = child.path;
			row.dataset.dir = String(child.dir);

			const twisty = el(
				"span",
				"twisty",
				child.dir ? (collapsed ? "▸" : "▾") : ""
			);
			if (!child.dir) twisty.classList.add("is-leaf");
			row.appendChild(twisty);

			if (child.status) {
				const badge = el(
					"span",
					`st st-${
						child.status === "?" ? "a" : child.status.toLowerCase()
					}`,
					child.status
				);
				row.appendChild(badge);
			}
			row.appendChild(el("span", "label", child.name));
			if (!child.dir && child.path === state.treePath)
				row.classList.add("is-selected");
			// solo il working tree ha file sul disco: in un commit il path può non esistere
			if (!child.dir && !state.selectedCommit && child.status !== "D") {
				row.draggable = true;
				row.title = t("Trascina fuori per copiare il file.");
			}
			fragment.appendChild(row);

			if (child.dir && !collapsed) walk(child, depth + 1);
		}
	};
	walk(buildTree(files), 0);
	ui.treeList.appendChild(fragment);
}

/**
 * Intestazione del commit: autore, oggetto e file toccati in una riga, poi il diff a tutta
 * larghezza. La gerarchia è l'opposto di quella dell'albero dei file, che resta a due colonne.
 */
function renderCommitHead(): void {
	clear(ui.commitHead);
	const commit = state.commits.find((c) => c.sha === state.selectedCommit);
	// senza commit il solo messaggio del diff basta: un'intestazione vuota occuperebbe spazio
	if (!commit) return;

	const details = state.commitDetails;
	const author = details?.author;
	const name = author?.name ?? commit.author;
	const email = author?.email ?? commit.email;
	const iso = author?.date ?? new Date(commit.timestamp * 1000).toISOString();
	const when = new Date(iso).getTime();

	const line = el("div", "commit-line");
	const avatar = el("span", "avatar", initials(name));
	avatar.style.background = avatarColor(name);
	line.appendChild(avatar);

	const subject = el(
		"div",
		"commit-subject",
		details?.subject ?? commit.subject
	);
	subject.title = details?.body
		? `${details.subject}\n\n${details.body}`
		: details?.subject ?? commit.subject;
	line.appendChild(subject);

	const facts = el("div", "commit-facts");
	const fact = (
		className: string,
		text: string,
		title?: string
	): HTMLElement => {
		const node = el("span", className, text);
		if (title) node.title = title;
		return node;
	};
	const sep = (): HTMLElement => el("span", "sep", "·");

	facts.appendChild(fact("commit-author", name, email));
	facts.appendChild(sep());
	facts.appendChild(
		fact("", Number.isNaN(when) ? iso : shortDate(when), iso)
	);

	const sha = el("button", "commit-sha", commit.sha.slice(0, 7));
	sha.title = t(`Copia lo SHA completo (${commit.sha})`);
	sha.addEventListener("click", () => void copyText(commit.sha));
	facts.appendChild(sep());
	facts.appendChild(sha);

	// rebase, cherry-pick e patch applicate da terzi hanno un committer diverso dall'autore
	const committer = details?.committer;
	if (committer && (committer.name !== name || committer.email !== email)) {
		const stamp = new Date(committer.date).getTime();
		facts.appendChild(sep());
		facts.appendChild(
			fact(
				"commit-committer",
				`committer ${committer.name}`,
				`Committer: ${committer.name} <${committer.email}> · ${
					Number.isNaN(stamp) ? committer.date : shortDate(stamp)
				}`
			)
		);
	}

	facts.appendChild(sep());
	const parents = details?.parents ?? commit.parents;
	facts.appendChild(
		fact(
			"",
			parents.length === 0
				? "iniziale"
				: parents.length === 1
				? "1 genitore"
				: `${parents.length} genitori`,
			parents.length === 0
				? "Commit iniziale, senza genitori"
				: `Parent: ${parents.map((p) => p.slice(0, 8)).join(" ")}`
		)
	);
	line.appendChild(facts);
	ui.commitHead.appendChild(line);

	if (details?.body) {
		const body = el("div", "commit-body", details.body);
		body.title = details.body;
		ui.commitHead.appendChild(body);
	}

	// senza file il diff dice già che il commit non tocca niente: l'intestazione si ferma qui
	if (state.commitFiles.length === 0) return;

	ui.commitHead.appendChild(renderCommitAnalysis());
}

/** Le etichette degli stati, nell'ordine in cui compaiono nel riepilogo. */
const COMMIT_STATES: Array<[code: string, one: string, many: string]> = [
	["A", "nuovo", "nuovi"],
	["D", "eliminato", "eliminati"],
	["M", "modificato", "modificati"],
	["R", "rinominato", "rinominati"],
	["C", "copiato", "copiati"],
	["T", "tipo cambiato", "tipi cambiati"],
];

/**
 * Quello che l'elenco dei file non direbbe: quanto pesa il commit (barra proporzionale fra
 * aggiunte e rimozioni), quante cartelle tocca e come si distribuiscono gli stati. Serve a capire
 * la forma del commit prima di leggerlo; i file uno per uno restano nel File Tree.
 */
function renderCommitAnalysis(): HTMLElement {
	const row = el("div", "commit-analysis");
	const files = state.commitFiles;
	const stat = state.commitStat;

	const additions = stat?.additions ?? 0;
	const deletions = stat?.deletions ?? 0;
	if (stat && additions + deletions > 0) {
		const bar = el("div", "commit-bar");
		bar.title = t(`${additions} righe aggiunte, ${deletions} rimosse`);
		const add = el("span", "seg-add");
		add.style.flexGrow = String(additions);
		const del = el("span", "seg-del");
		del.style.flexGrow = String(deletions);
		bar.append(add, del);
		row.appendChild(bar);
	}

	if (stat) {
		const totals = el("span", "commit-totals");
		if (additions > 0) {
			totals.appendChild(el("span", "plus", `+${additions}`));
		}
		if (deletions > 0) {
			totals.appendChild(el("span", "minus", `−${deletions}`));
		}
		if (additions + deletions === 0) {
			totals.appendChild(el("span", "", "±0 righe"));
		}
		totals.title = t(`${additions} righe aggiunte, ${deletions} rimosse`);
		row.appendChild(totals);
	}

	const sep = (): void => void row.appendChild(el("span", "sep", "·"));
	sep();
	row.appendChild(
		el("span", "", files.length === 1 ? "1 file" : `${files.length} file`)
	);

	const folders = new Set<string>();
	for (const file of files) {
		const slash = file.path.lastIndexOf("/");
		if (slash > 0) folders.add(file.path.slice(0, slash));
	}
	if (folders.size > 0) {
		sep();
		const node = el(
			"span",
			"",
			folders.size === 1 ? "1 cartella" : `${folders.size} cartelle`
		);
		node.title = [...folders].sort().join("\n");
		row.appendChild(node);
	}

	if (stat && stat.binaries > 0) {
		sep();
		row.appendChild(
			el(
				"span",
				"",
				stat.binaries === 1 ? "1 binario" : `${stat.binaries} binari`
			)
		);
	}

	const counts = new Map<string, number>();
	for (const file of files) {
		const code = file.status.toUpperCase();
		counts.set(code, (counts.get(code) ?? 0) + 1);
	}
	const states = el("span", "commit-states");
	for (const [code, one, many] of COMMIT_STATES) {
		const count = counts.get(code);
		if (!count) continue;
		const item = el("span", "state");
		item.title = `${count} ${count === 1 ? one : many}`;
		item.append(
			el("span", `st st-${code.toLowerCase()}`, code),
			el("span", "state-count", String(count))
		);
		states.appendChild(item);
	}
	if (states.childElementCount > 0) {
		row.appendChild(states);
	}

	return row;
}
// ── azioni ───────────────────────────────────────────────────────────────────

/**
 * Riapre i repository dell'ultima sessione, nello stesso ordine di schede, e torna su quello che
 * era attivo. Un percorso sparito o non più repository non ferma gli altri: si salta e la scheda
 * non torna (la lista salvata si riscrive subito dopo, senza quel percorso).
 */
async function restoreSessions(): Promise<void> {
	if (panelMode) return;
	const saved = readSavedSessions();
	for (const root of saved.roots) {
		try {
			const snapshot = await api.open(root, false);
			if (snapshot) adoptSnapshot(snapshot);
		} catch (error) {
			console.warn(`repository non riaperto: ${root}`, error);
		}
	}
	const active = saved.active ? sessions.get(saved.active) : undefined;
	if (!active) return;
	state = active;
	try {
		await api.use(active.root);
	} catch (error) {
		console.warn(
			`repository attivo non riselezionato: ${active.root}`,
			error
		);
	}
}

async function boot(): Promise<void> {
	try {
		applyAppearance((await api.settings()).appearance);
	} catch (error) {
		console.warn("aspetto delle impostazioni non disponibile:", error);
	}
	if (panelMode) {
		if (!panelBootRoot) {
			toast("Nessun repository indicato per il pannello dei dettagli.");
			return;
		}
		await openRepository(panelBootRoot);
		renderSession();
		const pending = pendingPanelState;
		pendingPanelState = null;
		if (pending) void applyPanelState(pending);
		return;
	}
	// niente dialog all'avvio: si riaprono le schede dell'ultima volta e, se c'è, il `--repo`
	await restoreSessions();
	await openRepository(undefined, false);
	sessionsReady = true;
	saveSessions();
	renderSession();
	void loadBaseFolder();
}

async function refresh(): Promise<void> {
	const snapshot = await guard("Aggiornamento", () => api.refresh());
	if (snapshot) applySnapshot(snapshot);
}

async function selectCommit(sha: string): Promise<void> {
	const root = state.root;
	if (state.selectedCommit !== sha) {
		// l'albero letto per un commit non vale per un altro
		state.lazyTree.clear();
		state.lazyExpanded.clear();
		state.lazyLoading.clear();
	}
	state.selectedCommit = sha;
	rememberPanelCommit(root, sha);
	state.commitDetails = null;
	state.commitFiles = [];
	state.commitStat = null;
	state.commitDiffs = [];
	state.treePath = null;
	setTab("commit");
	logView.select(sha);
	logView.reveal(sha);

	// i tre dati arrivano da git separatamente: chiederli insieme evita tre attese in fila
	const [details, files, stat] = await Promise.all([
		guard("Dettaglio commit", () => api.commitDetails(sha)),
		guard("Commit", () => api.commitFiles(sha)),
		guard("Righe del commit", () => api.commitStat(sha)),
	]);
	if (!files || !isActive(root)) return;
	state.commitDetails = details;
	state.commitFiles = files;
	state.commitStat = stat;
	renderCommitHead();
	if (state.snapshot) renderTree(state.snapshot);
	await renderCommitDiff();
	publishPanel();
}

/** Tetto al diff del commit: oltre, la lettura per file resta al File Tree. */
const COMMIT_DIFF_FILES = 12;
const COMMIT_DIFF_LINES = 4000;

/**
 * Il commit si legge tutto di seguito, come `git show`: una richiesta per file, in parallelo, ma
 * solo per i primi e finché le righe restano leggibili. Oltre il tetto il pannello lo dice e
 * rimanda al File Tree, che resta la vista file per file.
 */
async function renderCommitDiff(): Promise<void> {
	const sha = state.selectedCommit;
	const root = state.root;
	state.commitDiffs = [];
	if (!sha || state.commitFiles.length === 0) {
		paintCommitDiff();
		return;
	}

	renderDiffs(ui.commitDiff, [], "Lettura del diff…", {
		layout: state.diffLayout,
	});
	const targets = state.commitFiles.slice(0, COMMIT_DIFF_FILES);
	const patches = await Promise.all(
		targets.map((file) =>
			guard("Diff", () => api.commitPatch(sha, file.path))
		)
	);
	// la selezione può essere cambiata mentre i diff arrivavano
	if (!isActive(root) || state.selectedCommit !== sha) return;

	let lines = 0;
	for (const patch of patches) {
		if (!patch) continue;
		const size = patch.additions + patch.deletions;
		// il primo file si mostra sempre: un file enorme è comunque meglio di una pagina vuota
		if (state.commitDiffs.length > 0 && lines + size > COMMIT_DIFF_LINES) {
			break;
		}
		state.commitDiffs.push(patch);
		lines += size;
	}
	paintCommitDiff();
}

/** Disegna i diff già letti e, se il commit è più lungo del tetto, dice dove vedere il resto. */
function paintCommitDiff(): void {
	if (!state.selectedCommit) {
		renderDiffs(ui.commitDiff, [], "Seleziona un commit.", {
			layout: state.diffLayout,
		});
		return;
	}
	renderDiffs(
		ui.commitDiff,
		state.commitDiffs,
		state.commitFiles.length === 0
			? "Commit senza modifiche ai file."
			: "Diff non disponibile.",
		{ layout: state.diffLayout }
	);
	const hidden = state.commitFiles.length - state.commitDiffs.length;
	if (hidden <= 0) return;
	ui.commitDiff.appendChild(
		el(
			"div",
			"commit-more",
			hidden === 1
				? "1 altro file non mostrato: aprile nel File Tree."
				: `${hidden} altri file non mostrati: aprili nel File Tree.`
		)
	);
}

/** Diff della scheda File Tree: stesso backend, riquadro diverso. */
async function selectTreeFile(path: string): Promise<void> {
	const root = state.root;
	state.treePath = path;
	if (state.snapshot) renderTree(state.snapshot);

	if (state.selectedCommit) {
		const sha = state.selectedCommit;
		const file = await guard("Diff", () => api.commitPatch(sha, path));
		if (file && isActive(root)) {
			renderDiff(ui.treeDiff, file, "Nessuna differenza.", {
				layout: state.diffLayout,
			});
		}
		publishPanel();
		return;
	}

	const entry = state.snapshot?.status.entries.find(
		(item) => item.path === path
	);
	const staged = entry
		? entry.index !== "." && entry.worktree === "."
		: false;
	const file = await guard("Diff", () => api.worktreePatch(path, staged));
	if (file && isActive(root)) {
		renderDiff(ui.treeDiff, file, "Nessuna differenza.", {
			layout: state.diffLayout,
			mode: staged ? "unstage" : "stage",
		});
	}
	publishPanel();
}

async function selectChange(path: string, staged?: boolean): Promise<void> {
	const entry = state.snapshot?.status.entries.find(
		(item) => item.path === path
	);
	if (!entry) return;
	if (state.changePath !== path) clearPicked();
	state.changePath = path;
	// Il lato conta: lo stesso file può stare in "Staged" e in "Unstaged" con diff diversi.
	state.changeStaged =
		staged ?? (entry.index !== "." && entry.worktree === ".");
	if (state.snapshot) renderChanges(state.snapshot);
	await loadChangeDiff();
	publishPanel();
}

/** Il diff del working tree si ridisegna da `state.changeDiff`, senza tornare a Git. */
function renderChangeDiff(): void {
	const mode: PatchMode = state.changeStaged ? "unstage" : "stage";
	renderDiff(ui.changesDiff, state.changeDiff, "Nessuna differenza.", {
		mode,
		picked: state.picked,
		layout: state.diffLayout,
	});
}

async function loadChangeDiff(): Promise<void> {
	const path = state.changePath;
	if (!path) {
		state.changeDiff = null;
		renderDiff(ui.changesDiff, null, "Seleziona un file.");
		return;
	}
	const root = state.root;
	const file = await guard("Diff", () =>
		api.worktreePatch(path, state.changeStaged)
	);
	if (!file || !isActive(root)) return;
	state.changeDiff = file;
	renderChangeDiff();
}

function clearPicked(): void {
	if (state.picked.size > 0) state.picked.clear();
}

function togglePick(hunk: number, line: number): void {
	const key = pickKey(hunk, line);
	if (state.picked.has(key)) state.picked.delete(key);
	else state.picked.add(key);
	renderChangeDiff();
}

function selectionForHunk(hunk: number, lines: number[]): HunkSelection[] {
	return [{ hunk, lines }];
}

/** Applica una patch parziale: stage se il diff mostrato è unstaged, unstage se è staged. */
async function applyPartial(selection: HunkSelection[]): Promise<void> {
	const file = state.changeDiff;
	const path = state.changePath;
	if (!file || !path) return;

	const mode: PatchMode = state.changeStaged ? "unstage" : "stage";
	const patch = buildPatch(file, selection, mode);
	if (!patch) {
		toast("Nessuna modifica da applicare alla selezione.");
		return;
	}

	const snapshot = await guard(
		mode === "stage" ? "Stage parziale" : "Unstage parziale",
		() => api.applyPatch(path, patch, mode)
	);
	if (!snapshot) return;
	clearPicked();
	applySnapshot(snapshot);
}

/**
 * Ricarica il diff aperto dopo un'operazione: il contenuto è cambiato sotto. Il diff di un commit
 * no: è immutabile, quindi si lascia com'è invece di rileggere N patch a ogni refresh.
 */
async function reloadOpenDiff(): Promise<void> {
	if (state.changePath) {
		const entry = state.snapshot?.status.entries.find(
			(item) => item.path === state.changePath
		);
		if (entry) {
			// dopo uno stage il lato da mostrare cambia: va ricalcolato dallo stato nuovo
			state.changeStaged = entry.index !== "." && entry.worktree === ".";
			await loadChangeDiff();
		} else {
			state.changePath = null;
			renderDiff(ui.changesDiff, null, "Seleziona un file.");
		}
	}
}

/** Un solo pannello inferiore attivo alla volta: le modifiche non ne fanno parte. */
function syncPanels(): void {
	const panels: Array<[Tab, HTMLElement, HTMLElement]> = [
		["commit", ui.tabCommit, ui.panelCommit],
		["tree", ui.tabTree, ui.panelTree],
		["blame", ui.tabBlame, ui.panelBlame],
		["term", ui.tabTerm, ui.panelTerm],
	];
	for (const [name, button, panel] of panels) {
		button.classList.toggle("is-active", state.tab === name);
		panel.classList.toggle("is-active", state.tab === name);
	}
}

/**
 * La barra laterale sceglie l'area principale: *Changes* prende tutto lo spazio e la storia
 * sparisce; *All Commits* riporta la storia con il pannello inferiore.
 */
function setSide(side: Side): void {
	state.side = side;
	ui.sideChanges.classList.toggle("is-active", side === "changes");
	ui.sideCommits.classList.toggle("is-active", side === "commits");
	ui.main.classList.toggle("is-changes", side === "changes");
	publishPanel();
}

function setTab(tab: Tab): void {
	// le schede sono nascoste in modalità modifiche: sceglierne una riporta la storia
	if (state.side === "changes") setSide("commits");
	state.tab = tab;
	syncPanels();
	if (tab === "blame") void loadBlame();
	if (tab === "tree" && state.snapshot) renderTree(state.snapshot);
	if (tab === "term") renderTerminal();
	publishPanel();
}

/** Blame del file aperto: quello delle Modifiche, altrimenti quello del File Tree. */
async function loadBlame(): Promise<void> {
	const path = state.changePath ?? state.treePath;
	ui.blamePath.textContent = path ?? "";
	if (!path) {
		blameView.setData(
			null,
			"Seleziona un file da Modifiche o dal File Tree."
		);
		return;
	}
	const root = state.root;
	blameView.setData(null, "Lettura del blame…");
	const file = await guard("Blame", () => api.blame(path));
	if (!file || !isActive(root)) return;
	blameView.setData(file);
}

async function stage(paths: string[]): Promise<void> {
	const snapshot = await guard("Stage", () => api.stage(paths));
	if (snapshot) applySnapshot(snapshot);
}

async function unstage(paths: string[]): Promise<void> {
	const snapshot = await guard("Unstage", () => api.unstage(paths));
	if (snapshot) applySnapshot(snapshot);
}

async function discard(paths: string[]): Promise<void> {
	const label = paths.length === 1 ? paths[0] : `${paths.length} file`;
	// La conferma deve dire la verità: con la copia spenta i file non tracciati spariscono davvero.
	let copies = true;
	try {
		copies = (await api.settings()).trash.enabled;
	} catch (error) {
		console.warn("impostazioni non disponibili:", error);
	}
	const message = copies
		? `Scartare le modifiche di ${label}? Le modifiche tracciate si ripristinano con Annulla; i file non tracciati vengono conservati come oggetti Git.`
		: `Scartare le modifiche di ${label}? Le modifiche tracciate si ripristinano con Annulla, ma i file non tracciati vengono eliminati definitivamente.`;
	if (!askConfirm(message)) return;
	const snapshot = await guard("Scarta", () => api.discard(paths));
	if (snapshot) applySnapshot(snapshot);
}

async function doUndo(): Promise<void> {
	if (!state.snapshot?.undo) return;
	const snapshot = await guard("Annulla", () => api.undo());
	if (!snapshot) return;
	applySnapshot(snapshot);
	toast("Operazione annullata.", "ok");
}

/** Il modello configurato in Git riempie il campo solo quando è vuoto. */
async function fillCommitTemplate(): Promise<void> {
	const root = state.root;
	if (panelMode || !root || ui.commitMessage.value.trim()) return;
	try {
		const template = await api.commitTemplate();
		if (!isActive(root) || !template.text) return;
		if (ui.commitMessage.value.trim()) return;
		ui.commitMessage.value = template.text;
	} catch (error) {
		console.warn("modello di commit non disponibile:", error);
	}
}

/** L'output di Git (hook compresi) resta sotto il messaggio: non è un avviso da perdere. */
function showCommitError(message: string): void {
	ui.commitError.textContent = message;
	ui.commitError.classList.remove("hidden");
}

async function doCommit(): Promise<void> {
	const message = ui.commitMessage.value.trim();
	if (!message) {
		toast("Scrivi un messaggio di commit.");
		return;
	}
	ui.commitError.textContent = "";
	ui.commitError.classList.add("hidden");
	let snapshot: Snapshot | null;
	try {
		snapshot = await api.commit(
			message,
			ui.commitAll.checked,
			ui.commitSign.checked
		);
	} catch (error) {
		showCommitError(readableError(error));
		return;
	}
	ui.commitMessage.value = "";
	applySnapshot(snapshot);
	toast("Commit creato.", "ok");
	void fillCommitTemplate();
}

async function checkout(branch: string): Promise<void> {
	const snapshot = await guard(`Checkout ${branch}`, () =>
		api.checkout(branch)
	);
	if (snapshot) applySnapshot(snapshot);
}

// ── avanzamento delle operazioni di rete ─────────────────────────────────────

/** I passi di Git sono in inglese; la UI usa l'italiano come lingua sorgente. */
const NETWORK_PHASES: Record<string, string> = {
	"Enumerating objects": "Enumerazione oggetti",
	"Counting objects": "Conteggio oggetti",
	"Compressing objects": "Compressione oggetti",
	"Writing objects": "Scrittura oggetti",
	"Receiving objects": "Ricezione oggetti",
	"Resolving deltas": "Risoluzione delta",
	"Updating files": "Aggiornamento file",
	"Checking out files": "Checkout file",
	"Unpacking objects": "Estrazione oggetti",
};

function showNetworkPhase(label: string): void {
	ui.networkPhase.textContent = t(label);
	ui.networkPct.textContent = "";
	ui.networkFill.style.width = "0%";
	ui.networkStatus.title = t(label);
	ui.networkStatus.classList.remove("hidden");
}

function hideNetwork(): void {
	ui.networkStatus.classList.add("hidden");
}

api.onNetwork((event) => {
	// un'operazione di un'altra scheda non deve comparire sopra questa
	if (event.root && event.root !== state.root) return;
	const label = NETWORK_PHASES[event.phase] ?? "Rete";
	ui.networkPhase.textContent = t(label);
	ui.networkPct.textContent = `${event.percent}%`;
	ui.networkFill.style.width = `${event.percent}%`;
	ui.networkStatus.title = event.detail
		? `${t(label)}: ${event.detail}`
		: t(label);
	ui.networkStatus.classList.remove("hidden");
});

async function fetchAll(): Promise<void> {
	toast("Fetch in corso…", "ok");
	showNetworkPhase("Rete");
	const snapshot = await guard("Fetch", () => api.fetch());
	hideNetwork();
	if (snapshot) {
		applySnapshot(snapshot);
		toast("Fetch completato.", "ok");
	}
}

// ── menu contestuale ─────────────────────────────────────────────────────────

interface MenuEntry {
	label: string;
	/** assente per le voci solo informative (disabilitate) */
	action?: () => void;
	danger?: boolean;
	disabled?: boolean;
	/** spiegazione mostrata come tooltip: cosa fa la voce, senza aprire niente */
	hint?: string;
}

function openMenu(
	x: number,
	y: number,
	entries: Array<MenuEntry | "separator">
): void {
	clear(ui.ctxMenu);
	for (const entry of entries) {
		if (entry === "separator") {
			ui.ctxMenu.appendChild(el("div", "ctx-sep"));
			continue;
		}
		const button = el("button", "ctx-item", t(entry.label));
		button.type = "button";
		if (entry.hint) button.title = t(entry.hint);
		if (entry.danger) button.classList.add("is-danger");
		if (entry.disabled) {
			button.disabled = true;
		} else {
			button.addEventListener("click", () => {
				closeMenu();
				entry.action?.();
			});
		}
		ui.ctxMenu.appendChild(button);
	}
	// prima si mostra, poi si misura: da nascosto il rettangolo è vuoto
	ui.ctxMenu.classList.remove("hidden");
	ui.ctxMenu.style.left = "0px";
	ui.ctxMenu.style.top = "0px";
	const box = ui.ctxMenu.getBoundingClientRect();
	ui.ctxMenu.style.left = `${Math.max(
		4,
		Math.min(x, window.innerWidth - box.width - 6)
	)}px`;
	ui.ctxMenu.style.top = `${Math.max(
		4,
		Math.min(y, window.innerHeight - box.height - 6)
	)}px`;
}

function closeMenu(): void {
	if (ui.ctxMenu.classList.contains("hidden")) return;
	ui.ctxMenu.classList.add("hidden");
	clear(ui.ctxMenu);
}

async function copyText(text: string): Promise<void> {
	try {
		await navigator.clipboard.writeText(text);
		toast("Copiato negli appunti.", "ok");
	} catch (error) {
		toast(`Copia non riuscita: ${readableError(error)}`);
	}
}

// ── file e cartella dal repository ──────────────────────────────────────────

/** La cartella del repository nel gestore file; `root` esplicito per le schede non attive. */
function openRepoFolder(root?: string): void {
	const target = root ?? state.root;
	if (!target) return;
	void guard("Cartella", () => api.openRepoFolder(target));
}

function openFileWithSystem(path: string): void {
	const root = state.root;
	if (!root) return;
	// un file eseguibile viene aperto come farebbe il gestore file: la scelta è dell'utente
	void guard("Apri file", () => api.openFile(root, path));
}

function revealFile(path: string): void {
	const root = state.root;
	if (!root) return;
	void guard("Mostra file", () => api.revealFile(root, path));
}

/** Una copia fuori dal repository: dal working tree, o dal commit selezionato com'era allora. */
async function saveFileCopy(path: string, sha: string | null): Promise<void> {
	const root = state.root;
	if (!root) return;
	const destination = await guard("Salva copia", () =>
		api.saveCopy(root, path, sha)
	);
	if (destination) toast(`Copia salvata in ${destination}.`, "ok");
}

/**
 * Voci del menu di un file. In un commit il file può non esistere più nel working tree: lì si
 * legge dai byte del commit e non si promette di aprirlo dal disco.
 */
function fileMenuEntries(path: string): Array<MenuEntry | "separator"> {
	const sha = state.selectedCommit;
	if (sha)
		return [
			{
				label: "Salva una copia del file com'era nel commit…",
				hint: "Estrae dal commit i byte di allora e li salva dove scegli tu.",
				action: () => void saveFileCopy(path, sha),
			},
			{
				label: "Copia percorso",
				hint: "Copia negli appunti il percorso del file dentro il repository.",
				action: () => void copyText(path),
			},
		];
	return [
		{
			label: "Apri con l'applicazione associata",
			hint: "Apre il file dal disco con il programma predefinito del sistema.",
			action: () => openFileWithSystem(path),
		},
		{
			label: "Mostra nella cartella",
			hint: "Apre la cartella che contiene il file e lo seleziona.",
			action: () => revealFile(path),
		},
		"separator",
		{
			label: "Salva una copia…",
			hint: "Copia il file in una cartella scelta da te, fuori dal repository.",
			action: () => void saveFileCopy(path, null),
		},
		{
			label: "Copia percorso",
			hint: "Copia negli appunti il percorso del file dentro il repository.",
			action: () => void copyText(path),
		},
	];
}

// ── ref: navigazione e operazioni ────────────────────────────────────────────

/**
 * Clic su un ramo o un tag: il cursore va al commit corrispondente, come nella storia.
 * Il checkout resta nel menu del tasto destro: qui non si tocca il working tree.
 */
async function revealRef(sha: string): Promise<void> {
	if (state.searchQuery) await runSearch("");
	if (state.side === "changes") setSide("commits");

	let index = state.commits.findIndex((commit) => commit.sha === sha);
	// un ref può puntare oltre la prima pagina: si carica finché il commit non compare
	while (index < 0 && state.hasMore) {
		const before = state.commits.length;
		await loadMore();
		if (state.commits.length === before) break;
		index = state.commits.findIndex((commit) => commit.sha === sha);
	}

	if (index < 0) {
		toast("Commit non presente nella storia caricata.");
		return;
	}

	setTab("commit");
	await selectCommit(sha);
	logView.reveal(sha);
}

function openRefMenu(ref: RefInfo, x: number, y: number): void {
	const entries: Array<MenuEntry | "separator"> = [
		{
			label: "Vai al commit",
			hint: "Porta la vista della storia al commit puntato da questo riferimento.",
			action: () => void revealRef(ref.sha),
		},
		"separator",
	];

	if (ref.kind === "local") {
		entries.push(
			{
				label: ref.current
					? `${ref.short} è il ramo attuale`
					: `Checkout di ${ref.short}`,
				disabled: ref.current,
				hint: "Sposta HEAD e il working tree su questo ramo locale.",
				action: () => void checkout(ref.short),
			},
			{
				label: `Merge di ${ref.short} nel ramo attuale`,
				disabled: ref.current,
				hint: "Unisce questo ramo nel ramo attuale, con un commit di merge.",
				action: () => void mergeBranch(ref.short),
			},
			{
				label: `Rebase del ramo attuale su ${ref.short}`,
				disabled: ref.current,
				hint: "Riapplica i commit del ramo attuale sopra questo ramo.",
				action: () => void rebaseOnto(ref.short),
			},
			"separator",
			{
				label: "Rinomina…",
				hint: "Cambia il nome del ramo locale.",
				action: () => void renameBranch(ref.short),
			},
			{
				label: `Elimina ${ref.short}`,
				danger: true,
				disabled: ref.current,
				hint: "Elimina solo il riferimento: i commit restano nella storia.",
				action: () => void deleteBranch(ref.short),
			}
		);
	} else if (ref.kind === "remote") {
		const local = localBranchName(ref.short);
		entries.push({
			label: `Crea ${local} e passa a quel ramo`,
			hint: "Crea un ramo locale che segue il remoto e ci passa sopra.",
			action: () => void startTracking(ref.short, local),
		});
	}

	entries.push(
		"separator",
		{
			label: "Copia nome",
			hint: "Copia negli appunti il nome del ramo o del tag.",
			action: () => void copyText(ref.short),
		},
		{
			label: "Copia SHA",
			hint: "Copia negli appunti l'identificativo completo del commit.",
			action: () => void copyText(ref.sha),
		}
	);

	openMenu(x, y, entries);
}

/** `origin/feature/x` → `feature/x`: il nome che il checkout con tracking creerebbe. */
function localBranchName(remoteRef: string): string {
	try {
		return localNameForRemote(remoteRef);
	} catch (error) {
		console.warn("ref remoto senza nome locale:", error);
		return remoteRef;
	}
}

async function mergeBranch(branch: string): Promise<void> {
	if (!askConfirm(`Unire ${branch} nel ramo attuale?`)) return;
	const snapshot = await guardRepo(`Merge di ${branch}`, () =>
		api.merge(branch)
	);
	if (!snapshot) return;
	applySnapshot(snapshot);
	toast("Merge completato.", "ok");
}

async function rebaseOnto(branch: string): Promise<void> {
	if (
		!askConfirm(
			`Riscrivere il ramo attuale sopra ${branch}? La storia locale cambia.`
		)
	)
		return;
	const snapshot = await guardRepo(`Rebase su ${branch}`, () =>
		api.rebase(branch)
	);
	if (!snapshot) return;
	applySnapshot(snapshot);
	toast("Rebase completato.", "ok");
}

async function renameBranch(branch: string): Promise<void> {
	const next = await askInput({
		title: "Rinomina il ramo",
		label: `Nuovo nome per ${branch}`,
		value: branch,
	});
	if (!next || next === branch) return;
	const snapshot = await guard("Rinomina", () =>
		api.renameBranch(branch, next)
	);
	if (snapshot) applySnapshot(snapshot);
}

async function deleteBranch(branch: string): Promise<void> {
	if (!askConfirm(`Eliminare il ramo locale ${branch}?`)) return;
	try {
		const snapshot = await api.deleteBranch(branch, false);
		applySnapshot(snapshot);
		return;
	} catch (error) {
		// Git protegge i rami non uniti: cancellarli è una scelta esplicita
		if (
			!askConfirm(
				`${readableError(error)}\n\nEliminare comunque ${branch}?`
			)
		)
			return;
	}
	const snapshot = await guard(`Elimina ${branch}`, () =>
		api.deleteBranch(branch, true)
	);
	if (!snapshot) return;
	applySnapshot(snapshot);
	toast("Ramo eliminato.", "ok");
}

async function startTracking(remoteRef: string, local: string): Promise<void> {
	const snapshot = await guard(`Checkout di ${remoteRef}`, () =>
		api.checkoutTracking(remoteRef, local)
	);
	if (snapshot) applySnapshot(snapshot);
}

async function checkoutCommit(sha: string): Promise<void> {
	const short = sha.slice(0, 8);
	if (
		!askConfirm(
			`Portare HEAD sul commit ${short}? Il ramo non si sposta: si lavora con HEAD staccato (l'operazione è annullabile).`
		)
	)
		return;
	const snapshot = await guard(`Checkout di ${short}`, () =>
		api.checkoutCommit(sha)
	);
	if (!snapshot) return;
	applySnapshot(snapshot);
	toast(`HEAD su ${short}, staccato dal ramo.`, "ok");
}

async function cherryPickCommit(sha: string): Promise<void> {
	if (!askConfirm(`Applicare ${sha.slice(0, 8)} sul ramo attuale?`)) return;
	const snapshot = await guardRepo("Cherry-pick", () => api.cherryPick(sha));
	if (!snapshot) return;
	applySnapshot(snapshot);
	toast("Cherry-pick completato.", "ok");
}

async function createBranchAt(sha: string): Promise<void> {
	const name = await askInput({
		title: "Nuovo ramo",
		label: `Nome del ramo che punta a ${sha.slice(0, 8)}`,
	});
	if (!name) return;
	const snapshot = await guard(`Ramo ${name}`, () =>
		api.createBranchAt(name, sha)
	);
	if (!snapshot) return;
	applySnapshot(snapshot);
	toast(`Ramo ${name} creato.`, "ok");
}

async function mergeCommit(sha: string): Promise<void> {
	const short = sha.slice(0, 8);
	if (!askConfirm(`Unire il commit ${short} nel ramo attuale?`)) return;
	const snapshot = await guardRepo(`Merge di ${short}`, () => api.merge(sha));
	if (!snapshot) return;
	applySnapshot(snapshot);
	toast("Merge completato.", "ok");
}

async function rebaseCommit(sha: string): Promise<void> {
	const short = sha.slice(0, 8);
	if (
		!askConfirm(
			`Riscrivere il ramo attuale sopra il commit ${short}? La storia locale cambia.`
		)
	)
		return;
	const snapshot = await guardRepo(`Rebase su ${short}`, () =>
		api.rebase(sha)
	);
	if (!snapshot) return;
	applySnapshot(snapshot);
	toast("Rebase completato.", "ok");
}

async function resetTo(
	sha: string,
	mode: "soft" | "mixed" | "hard"
): Promise<void> {
	const short = sha.slice(0, 8);
	const branch = state.snapshot?.info.branch ?? "HEAD";
	const detail =
		mode === "hard"
			? "Le modifiche non committate e i commit successivi spariranno dal ramo."
			: mode === "soft"
			? "I commit successivi escono dal ramo, le modifiche restano in stage."
			: "I commit successivi escono dal ramo, le modifiche restano nel working tree.";
	if (!askConfirm(`Reset ${mode} di ${branch} a ${short}?\n\n${detail}`))
		return;
	const snapshot = await guard(`Reset ${mode}`, () => api.reset(sha, mode));
	if (!snapshot) return;
	applySnapshot(snapshot);
	toast(`Reset ${mode} completato.`, "ok");
}

// ── remoto, stash, submodule ─────────────────────────────────────────────────

async function pullChanges(): Promise<void> {
	toast("Pull in corso…", "ok");
	showNetworkPhase("Rete");
	const snapshot = await guard("Pull", () => api.pull());
	hideNetwork();
	if (!snapshot) return;
	applySnapshot(snapshot);
	toast("Pull completato.", "ok");
}

async function pushChanges(): Promise<void> {
	toast("Push in corso…", "ok");
	showNetworkPhase("Rete");
	const snapshot = await guard("Push", () => api.push());
	hideNetwork();
	if (!snapshot) return;
	applySnapshot(snapshot);
	toast("Push completato.", "ok");
}

/** Merge, rebase o cherry-pick sospeso: si torna allo stato di prima. */
async function abortOperation(): Promise<void> {
	const operation = state.snapshot?.info.operation;
	if (!operation) return;
	if (
		!askConfirm(
			`Annullare il ${operation} in corso e tornare allo stato precedente?`
		)
	)
		return;
	const snapshot = await guard("Annulla operazione", () =>
		api.abortOperation()
	);
	if (!snapshot) return;
	applySnapshot(snapshot);
	toast("Operazione annullata.", "ok");
}

// ── conflitti ───────────────────────────────────────────────────────────────

let conflictFiles: ConflictFile[] = [];
let conflictDetail: ConflictDetail | null = null;

/** Il testo del conflitto scelto: uno stag una tantum, la UI legge solo questo. */
async function openConflicts(): Promise<void> {
	if (!state.snapshot?.info.operation) return;
	ui.conflictOperation.textContent = operationLabel(
		state.snapshot.info.operation
	);
	ui.conflictStatus.textContent = "";
	if (!ui.conflictDialog.open) ui.conflictDialog.showModal();
	await loadConflicts();
}

function operationLabel(operation: RepoOperation): string {
	if (operation === "merge") return t("Merge in corso");
	if (operation === "rebase") return t("Rebase in corso");
	return t("Cherry-pick in corso");
}

async function loadConflicts(select?: string): Promise<void> {
	const files = await guard("Conflitti", () => api.conflicts());
	if (!files) return;
	conflictFiles = files;
	conflictDetail = null;
	const target =
		(select && files.some((file) => file.path === select)
			? select
			: null) ??
		files[0]?.path ??
		null;
	await selectConflict(target);
}

function renderConflictFiles(): void {
	clear(ui.conflictFiles);
	if (conflictFiles.length === 0) {
		ui.conflictFiles.appendChild(
			el("li", "muted", t("Nessun conflitto: puoi continuare."))
		);
		return;
	}
	for (const file of conflictFiles) {
		const item = el("li", "", file.path);
		item.dataset.path = file.path;
		if (file.path === conflictDetail?.path)
			item.classList.add("is-selected");
		item.addEventListener("click", () => void selectConflict(file.path));
		ui.conflictFiles.appendChild(item);
	}
}

async function selectConflict(path: string | null): Promise<void> {
	conflictDetail = null;
	ui.conflictHunks.replaceChildren();
	ui.conflictEditor.value = "";
	ui.conflictEditor.disabled = path === null;
	ui.conflictPath.textContent = path ?? "—";
	ui.conflictStages.textContent = "";
	ui.conflictContinue.disabled =
		conflictFiles.length > 0 || !state.snapshot?.info.operation;
	for (const button of [
		ui.conflictUseOurs,
		ui.conflictUseTheirs,
		ui.conflictMark,
		ui.conflictApply,
		ui.conflictSave,
	]) {
		button.disabled = path === null;
	}
	renderConflictFiles();
	if (!path) return;

	const detail = await guard("Dettaglio del conflitto", () =>
		api.conflictDetail(path)
	);
	if (!detail) return;
	conflictDetail = detail;
	ui.conflictEditor.value = detail.working;
	ui.conflictStages.textContent = describeStages(detail);
	ui.conflictEditor.disabled = detail.binary;
	ui.conflictApply.disabled = detail.binary;
	ui.conflictSave.disabled = detail.binary;
	renderConflictHunks(detail);
	renderConflictFiles();
}

/** Quali versioni esistono davvero: una cancellazione da un lato si vede qui. */
function describeStages(detail: ConflictDetail): string {
	const parts: string[] = [];
	if (detail.stages.base) parts.push(t("base"));
	if (detail.stages.ours) parts.push(t("mio"));
	if (detail.stages.theirs) parts.push(t("loro"));
	return detail.binary
		? `${parts.join(" · ")} · ${t("binario")}`
		: parts.join(" · ");
}

function renderConflictHunks(detail: ConflictDetail): void {
	clear(ui.conflictHunks);
	if (detail.binary) return;
	const conflicts = parseConflicts(detail.working).filter(
		(part) => part.kind === "conflict"
	);
	if (conflicts.length === 0) {
		ui.conflictHunks.appendChild(
			el(
				"p",
				"hint",
				t(
					"Il file non ha più marcatori: correggi il testo e segnalo come risolto."
				)
			)
		);
		return;
	}
	conflicts.forEach((part, index) => {
		if (part.kind !== "conflict") return;
		const box = el("div", "conflict-hunk");
		box.appendChild(
			el("div", "conflict-hunk-title", t(`Conflitto ${index + 1}`))
		);
		const choices: Array<[ConflictChoice, string]> = [
			["ours", t("Mio")],
			["theirs", t("Loro")],
			["both", t("Entrambi")],
		];
		if (part.hunk.base !== null) choices.push(["base", t("Base")]);
		for (const [value, label] of choices) {
			const input = el("input");
			input.type = "radio";
			input.name = `conflict-hunk-${index}`;
			input.value = value;
			const wrap = el("label");
			wrap.append(input, document.createTextNode(` ${label}`));
			box.appendChild(wrap);
		}
		// Le due versioni una accanto all'altra, con l'etichetta: senza, «DUE DAL RAMO» non dice
		// da che parte arriva.
		const preview = el("div", "conflict-hunk-preview");
		for (const [label, text] of [
			[t("Mio"), part.hunk.ours],
			[t("Loro"), part.hunk.theirs],
		] as const) {
			const column = el("div");
			column.append(
				el("div", "conflict-preview-label", label),
				pre(text)
			);
			preview.appendChild(column);
		}
		box.appendChild(preview);
		ui.conflictHunks.appendChild(box);
	});
}

function pre(text: string): HTMLElement {
	const node = el("pre");
	node.textContent = text;
	return node;
}

/** Ogni conflitto deve avere una scelta: senza, il file resterebbe con i marcatori. */
function applyConflictChoices(): void {
	if (!conflictDetail) return;
	const total = countConflicts(parseConflicts(ui.conflictEditor.value));
	const choices: ConflictChoice[] = [];
	for (let index = 0; index < total; index++) {
		const checked = ui.conflictHunks.querySelector<HTMLInputElement>(
			`input[name="conflict-hunk-${index}"]:checked`
		);
		if (!checked) {
			toast("Scegli una versione per ogni conflitto.");
			return;
		}
		choices.push(checked.value as ConflictChoice);
	}
	const result = resolveConflicts(ui.conflictEditor.value, choices);
	ui.conflictEditor.value = result.text;
	toast(
		"Scelte applicate. Segna il file come risolto quando hai finito.",
		"ok"
	);
}

async function saveConflictText(): Promise<void> {
	if (!conflictDetail) return;
	try {
		await api.writeResolvedFile(
			conflictDetail.path,
			ui.conflictEditor.value
		);
		toast(
			"Testo salvato. Segna il file come risolto quando hai finito.",
			"ok"
		);
	} catch (error) {
		toast(readableError(error));
	}
}

async function resolveConflictSide(side: "ours" | "theirs"): Promise<void> {
	if (!conflictDetail) return;
	const snapshot = await guard(
		side === "ours" ? t("Usa mio") : t("Usa loro"),
		() => api.resolveConflictFile(conflictDetail!.path, side)
	);
	if (!snapshot) return;
	applySnapshot(snapshot);
	await loadConflicts();
}

async function markConflictResolved(): Promise<void> {
	if (!conflictDetail) return;
	const path = conflictDetail.path;
	const snapshot = await guard(t("Segna risolto"), () =>
		api.markResolved([path])
	);
	if (!snapshot) return;
	applySnapshot(snapshot);
	await loadConflicts(path);
}

async function continueConflicts(): Promise<void> {
	const snapshot = await guard("Continua", () => api.continueOperation());
	if (!snapshot) return;
	applySnapshot(snapshot);
	if (snapshot.info.operation === null) {
		ui.conflictDialog.close();
		toast("Operazione completata.", "ok");
		return;
	}
	// un rebase può fermarsi di nuovo: si riparte dall'elenco aggiornato
	ui.conflictOperation.textContent = operationLabel(snapshot.info.operation);
	await loadConflicts();
}

async function abortConflicts(): Promise<void> {
	await abortOperation();
	if (state.snapshot?.info.operation === null) ui.conflictDialog.close();
	else await loadConflicts();
}

let inputResolve: ((value: string | null) => void) | null = null;

/** Sostituto di `window.prompt`, che in Electron non esiste. */
function askInput(options: {
	title: string;
	label: string;
	value?: string;
}): Promise<string | null> {
	if (ui.inputDialog.open) settleInput(null);
	ui.inputTitle.textContent = t(options.title);
	ui.inputLabel.textContent = t(options.label);
	ui.inputField.value = options.value ?? "";
	ui.inputDialog.showModal();
	ui.inputField.focus();
	ui.inputField.select();
	return new Promise((resolve) => {
		inputResolve = resolve;
	});
}

function settleInput(value: string | null): void {
	if (ui.inputDialog.open) ui.inputDialog.close();
	const resolve = inputResolve;
	inputResolve = null;
	resolve?.(value);
}

/** Elenco dei file che lo stash può prendere: tutti selezionati, l'utente toglie quelli da lasciare. */
function renderStashPaths(): void {
	clear(ui.stashPaths);
	const entries = (state.snapshot?.status.entries ?? []).filter(
		(entry) => entry.kind !== "unmerged"
	);
	if (entries.length === 0) {
		ui.stashPaths.appendChild(
			el("span", "muted", "Nessun file da salvare.")
		);
		return;
	}
	for (const entry of entries) {
		const label = el("label", "check");
		const box = document.createElement("input");
		box.type = "checkbox";
		box.checked = true;
		box.value = entry.path;
		label.appendChild(box);
		const path = document.createElement("code");
		path.textContent = entry.path;
		label.appendChild(path);
		label.appendChild(el("span", "muted", t(entry.label)));
		ui.stashPaths.appendChild(label);
	}
}

function selectedStashPaths(): string[] {
	return [
		...ui.stashPaths.querySelectorAll<HTMLInputElement>(
			"input[type=checkbox]"
		),
	]
		.filter((box) => box.checked)
		.map((box) => box.value);
}

function setStashPaths(checked: boolean): void {
	for (const box of ui.stashPaths.querySelectorAll<HTMLInputElement>(
		"input[type=checkbox]"
	)) {
		box.checked = checked;
	}
}

async function openStash(): Promise<void> {
	ui.stashMessage.value = "";
	renderStashPaths();
	if (!ui.stashDialog.open) ui.stashDialog.showModal();
	await loadStashList();
}

async function loadStashList(): Promise<void> {
	clear(ui.stashList);
	const entries = await guard("Stash", () => api.stashList());
	if (!entries) return;
	if (entries.length === 0) {
		ui.stashList.appendChild(el("li", "muted", "Nessuno stash."));
		return;
	}
	for (const entry of entries) {
		const item = el("li");
		item.dataset.index = String(entry.index);
		const text = el("div", "stash-text");
		text.appendChild(el("span", "stash-message", entry.message));
		text.appendChild(
			el(
				"span",
				"stash-meta",
				`stash@{${entry.index}} · ${shortDate(entry.timestamp * 1000)}${
					entry.branch ? ` · ${entry.branch}` : ""
				}`
			)
		);
		item.appendChild(text);

		const actions = el("div", "stash-actions");
		const button = (
			label: string,
			act: string,
			className = "btn btn-small"
		): HTMLButtonElement => {
			const node = el("button", className, label);
			node.type = "button";
			node.dataset.stash = act;
			return node;
		};
		actions.append(
			button("Applica", "apply"),
			button("Pop", "pop", "btn btn-small btn-primary"),
			button("Elimina", "drop")
		);
		item.appendChild(actions);
		ui.stashList.appendChild(item);
	}
}

async function stashAction(
	action: "apply" | "pop" | "drop",
	index: number
): Promise<void> {
	const labels = {
		apply: "Applica stash",
		pop: "Pop stash",
		drop: "Elimina stash",
	};
	if (action === "drop" && !askConfirm(`Eliminare stash@{${index}}?`)) return;
	const snapshot =
		action === "drop"
			? await guard(labels.drop, () => api.stashDrop(index))
			: await guard(labels[action], () =>
					api.stashApply(index, action === "pop")
			  );
	if (!snapshot) return;
	applySnapshot(snapshot);
	await loadStashList();
}

async function openSubmodules(): Promise<void> {
	if (!ui.submoduleDialog.open) ui.submoduleDialog.showModal();
	await loadSubmodules();
}

async function loadSubmodules(): Promise<void> {
	clear(ui.submoduleList);
	const modules = await guard("Submodule", () => api.submodules());
	if (!modules) return;
	if (modules.length === 0) {
		ui.submoduleList.appendChild(el("li", "muted", "Nessun submodule."));
		return;
	}
	const labels: Record<string, string> = {
		clean: "allineato",
		modified: "da aggiornare",
		uninitialized: "non inizializzato",
		conflict: "in conflitto",
	};
	for (const module of modules) {
		const item = el("li");
		const text = el("div", "stash-text");
		text.appendChild(el("span", "stash-message", module.path));
		text.appendChild(
			el(
				"span",
				"stash-meta",
				`${module.sha.slice(0, 8)} · ${
					labels[module.state] ?? module.state
				}${module.description ? ` · ${module.description}` : ""}`
			)
		);
		item.appendChild(text);
		ui.submoduleList.appendChild(item);
	}
}

// ── terminale integrato ──────────────────────────────────────────────────────

const TERMINAL_LIMIT = 200_000;
let runningTerminal: string | null = null;
let terminalCounter = 0;
let terminalChars = 0;

function appendTerminal(text: string): void {
	ui.termOutput.appendChild(document.createTextNode(text));
	terminalChars += text.length;
	// l'output resta leggibile senza crescere all'infinito: si tiene la coda
	if (terminalChars > TERMINAL_LIMIT) {
		const keep = (ui.termOutput.textContent ?? "").slice(-TERMINAL_LIMIT);
		ui.termOutput.textContent = keep;
		terminalChars = keep.length;
	}
	ui.termOutput.scrollTop = ui.termOutput.scrollHeight;
}

function updateTerminalState(): void {
	const busy = runningTerminal !== null;
	ui.termStop.disabled = !busy;
	ui.termInput.placeholder = t(
		busy
			? "comando in corso… Interrompi per fermarlo"
			: "comando nella cartella del repository"
	);
}
function renderTerminal(): void {
	updateTerminalState();
	ui.termOutput.scrollTop = ui.termOutput.scrollHeight;
	ui.termInput.focus();
}

// ── schede dei repository ────────────────────────────────────────────────────

/** Apre un repository (dialog di sistema se `path` manca) e lo rende attivo. */
/** Prende in carico uno snapshot appena aperto: sessione, stato attivo, benvenuto spento. */
function adoptSnapshot(snapshot: Snapshot): void {
	const root = snapshot.info.root;
	let session = sessions.get(root);
	if (!session) {
		session = emptyState(root);
		sessions.set(root, session);
	}
	state = session;
	applySnapshot(snapshot);
	updateEmptyState();
	saveSessions();
	void fillCommitTemplate();
}

/**
 * `interactive` distingue l'apertura chiesta dall'utente (dialog di sistema se non c'è un
 * repository) dall'avvio dell'app, che senza `--repo` deve mostrare il benvenuto e basta.
 */
async function openRepository(
	path?: string,
	interactive = true
): Promise<void> {
	const snapshot = await guard("Apertura", () => api.open(path, interactive));
	if (!snapshot) return;
	adoptSnapshot(snapshot);
}

/** Passa a un repository già aperto: la sessione ricorda selezione e scheda. */
async function useSession(root: string): Promise<void> {
	const session = sessions.get(root);
	if (!session || session === state) return;
	try {
		await api.use(root);
	} catch (error) {
		toast(`Cambio repository: ${readableError(error)}`);
		return;
	}
	state = session;
	renderSession();
	saveSessions();
	void fillCommitTemplate();
}

async function closeSession(root: string): Promise<void> {
	sessions.delete(root);
	try {
		// il main dimentica il backend e ferma il watcher: niente eventi per una scheda che non c'è
		await api.closeRepo(root);
	} catch (error) {
		console.warn("chiusura del repository:", error);
	}
	if (state.root !== root) {
		renderRepoTabs();
		saveSessions();
		return;
	}
	const next = sessions.values().next().value as State | undefined;
	if (!next) {
		// nessun repository aperto: si torna al benvenuto, non al dialog di sistema
		state = emptyState();
		renderSession();
		saveSessions();
		return;
	}
	state = next;
	try {
		await api.use(next.root);
	} catch (error) {
		toast(`Cambio repository: ${readableError(error)}`);
	}
	renderSession();
	saveSessions();
}

// ── eventi delle nuove zone ──────────────────────────────────────────────────

ui.btnPull.addEventListener("click", () => void pullChanges());
ui.btnPush.addEventListener("click", () => void pushChanges());
ui.btnStash.addEventListener("click", () => void openStash());
ui.btnSubmodule.addEventListener("click", () => void openSubmodules());
ui.repoOperation.addEventListener("click", () => void openConflicts());
ui.conflictClose.addEventListener("click", () => ui.conflictDialog.close());
ui.conflictUseOurs.addEventListener(
	"click",
	() => void resolveConflictSide("ours")
);
ui.conflictUseTheirs.addEventListener(
	"click",
	() => void resolveConflictSide("theirs")
);
ui.conflictMark.addEventListener("click", () => void markConflictResolved());
ui.conflictApply.addEventListener("click", () => applyConflictChoices());
ui.conflictSave.addEventListener("click", () => void saveConflictText());
ui.conflictContinue.addEventListener("click", () => void continueConflicts());
ui.conflictAbort.addEventListener("click", () => void abortConflicts());

ui.stashClose.addEventListener("click", () => ui.stashDialog.close());
ui.stashAll.addEventListener("click", () => setStashPaths(true));
ui.stashNone.addEventListener("click", () => setStashPaths(false));
ui.btnStashSave.addEventListener("click", () => {
	void (async () => {
		const boxes = ui.stashPaths.querySelectorAll<HTMLInputElement>(
			"input[type=checkbox]"
		);
		const paths = selectedStashPaths();
		if (boxes.length > 0 && paths.length === 0) {
			toast("Scegli almeno un file da mettere nello stash.");
			return;
		}
		// tutti i file = comportamento classico, senza pathspec
		const partial =
			boxes.length > 0 && paths.length < boxes.length ? paths : undefined;
		const snapshot = await guard("Stash", () =>
			api.stashSave(ui.stashMessage.value, partial)
		);
		if (!snapshot) return;
		ui.stashMessage.value = "";
		applySnapshot(snapshot);
		renderStashPaths();
		await loadStashList();
		toast(
			partial
				? partial.length === 1
					? "Stash salvato per un file."
					: `Stash salvato per ${partial.length} file.`
				: "Modifiche salvate nello stash.",
			"ok"
		);
	})();
});
ui.stashList.addEventListener("click", (event) => {
	const button = (event.target as HTMLElement).closest<HTMLButtonElement>(
		"[data-stash]"
	);
	const index = Number(
		button?.closest<HTMLElement>("li")?.dataset.index ?? Number.NaN
	);
	const action = button?.dataset.stash;
	if (!button || !Number.isInteger(index) || !action) return;
	if (action !== "apply" && action !== "pop" && action !== "drop") return;
	void stashAction(action, index);
});

ui.submoduleClose.addEventListener("click", () => ui.submoduleDialog.close());
ui.btnSubmoduleUpdate.addEventListener("click", () => {
	void (async () => {
		toast("Aggiornamento dei submodule…", "ok");
		const snapshot = await guard("Submodule", () => api.updateSubmodules());
		if (!snapshot) return;
		applySnapshot(snapshot);
		await loadSubmodules();
		toast("Submodule aggiornati.", "ok");
	})();
});

ui.inputForm.addEventListener("submit", (event) => {
	event.preventDefault();
	settleInput(ui.inputField.value.trim() || null);
});
ui.inputCancel.addEventListener("click", () => settleInput(null));
ui.inputDialog.addEventListener("cancel", () => {
	const resolve = inputResolve;
	inputResolve = null;
	resolve?.(null);
});

ui.termForm.addEventListener("submit", (event) => {
	event.preventDefault();
	const command = ui.termInput.value.trim();
	if (!command) return;
	ui.termInput.value = "";
	terminalCounter += 1;
	const id = `term-${terminalCounter}`;
	appendTerminal(`$ ${command}\n`);
	runningTerminal = id;
	updateTerminalState();
	void api.terminalRun(id, command).catch((error: Error) => {
		appendTerminal(`[errore] ${error.message}\n`);
		if (runningTerminal === id) {
			runningTerminal = null;
			updateTerminalState();
		}
	});
});

ui.termStop.addEventListener("click", () => {
	const id = runningTerminal;
	if (!id) return;
	void api
		.terminalKill(id)
		.catch((error: Error) => toast(`Interruzione: ${error.message}`));
});

api.onTerminal((event) => {
	if (event.kind === "data") {
		appendTerminal(event.text);
		return;
	}
	if (event.kind === "error") appendTerminal(`[errore] ${event.message}\n`);
	else appendTerminal(`[uscita ${event.code ?? "?"}]\n`);
	if (event.id === runningTerminal) {
		runningTerminal = null;
		updateTerminalState();
	}
});

ui.repoTabs.addEventListener("click", (event) => {
	const target = event.target as HTMLElement;
	const closeRoot =
		target.closest<HTMLElement>("[data-close]")?.dataset.close;
	if (closeRoot) {
		void closeSession(closeRoot);
		return;
	}
	const root = target.closest<HTMLElement>(".repo-tab")?.dataset.root;
	if (root) void useSession(root);
});

ui.repoTabs.addEventListener("contextmenu", (event) => {
	const root = (event.target as HTMLElement).closest<HTMLElement>(".repo-tab")
		?.dataset.root;
	if (!root) return;
	event.preventDefault();
	/**
	 * Le operazioni che parlano del repository (fork, zip, file, Actions) passano dal main per il
	 * repository attivo: se il clic è su un'altra scheda, prima la si rende attiva.
	 */
	const onRepo = (task: () => Promise<void>) => () => {
		void (async () => {
			if (root !== state.root) await useSession(root);
			if (state.root !== root) return;
			await task();
		})();
	};
	openMenu(event.clientX, event.clientY, [
		{
			label: "Apri la cartella",
			hint: "Apre la cartella del repository nel gestore file del sistema.",
			action: () => openRepoFolder(root),
		},
		{
			label: "Copia percorso",
			hint: "Copia negli appunti il percorso completo della cartella.",
			action: () => void copyText(root),
		},
		"separator",
		{
			label: "Apri il repository nel browser",
			hint: "Apre la pagina web del repository, se il remoto è un servizio conosciuto.",
			action: () => void guard("Browser", () => api.openInBrowser(root)),
		},
		"separator",
		{
			label: "Apri un file del repository…",
			hint: "Mostra l'elenco dei file tracciati e apre quello scelto dal disco.",
			action: onRepo(openFilePicker),
		},
		{
			label: "Sincronizza con l'originale (merge)…",
			hint: "Porta nella tua copia i commit del repository originale, unendoli con un merge.",
			action: onRepo(() => syncForkWith("merge")),
		},
		{
			label: "Sincronizza con l'originale (rebase)…",
			hint: "Porta i commit dell'originale e riapplica i tuoi sopra, senza commit di merge.",
			action: onRepo(() => syncForkWith("rebase")),
		},
		{
			label: "Esporta HEAD in un archivio zip…",
			hint: "Crea uno zip con i file del commit corrente, senza cartella .git.",
			action: onRepo(exportRepositoryZip),
		},
		{
			label: "GitHub Actions…",
			hint: "Elenca le esecuzioni dei workflow di GitHub per il ramo corrente.",
			action: onRepo(openActions),
		},
		{
			label: "Pull request…",
			hint: "Elenca le pull request aperte e ne crea una da due rami già inviati.",
			action: onRepo(openPulls),
		},
		{
			label: "Reflog…",
			hint: "Mostra gli spostamenti di HEAD e ne apre un commit.",
			action: onRepo(openReflog),
		},
		"separator",
		{
			label: "Chiudi la scheda",
			danger: true,
			hint: "Chiude la scheda; il repository resta sul disco.",
			action: () => void closeSession(root),
		},
	]);
});

ui.log.addEventListener("contextmenu", (event) => {
	const row = (event.target as HTMLElement).closest<HTMLElement>(".row");
	const sha = row?.dataset.sha;
	if (!sha) return;
	event.preventDefault();
	const commit = state.commits.find((item) => item.sha === sha);
	const entries: Array<MenuEntry | "separator"> = [
		{
			label: "Vai al commit",
			hint: "Mostra nel pannello i dettagli e le modifiche di questo commit.",
			action: () => {
				setTab("commit");
				void selectCommit(sha);
			},
		},
		{
			label: "Checkout di questo commit (HEAD staccato)",
			hint: "Porta il working tree su questo commit senza spostare nessun ramo: HEAD resta staccato.",
			action: () => void checkoutCommit(sha),
		},
		"separator",
		{
			label: "Crea ramo da qui…",
			hint: "Crea un nuovo ramo che parte da questo commit.",
			action: () => void createBranchAt(sha),
		},
		{
			label: "Merge di questo commit nel ramo attuale",
			hint: "Unisce questo commit nel ramo attuale, con un commit di merge.",
			action: () => void mergeCommit(sha),
		},
		{
			label: "Rebase del ramo attuale su questo commit",
			hint: "Riapplica i commit del ramo attuale sopra questo commit.",
			action: () => void rebaseCommit(sha),
		},
		{
			label: "Rebase interattivo da qui…",
			hint: "Riordina, unisci, rinomina o togli i commit da questo a HEAD, in locale.",
			action: () => void openRebase(sha),
		},
		"separator",
		{
			label: "Reset soft a questo commit",
			hint: "Sposta il ramo qui lasciando le modifiche in staging.",
			action: () => void resetTo(sha, "soft"),
		},
		{
			label: "Reset mixed a questo commit",
			hint: "Sposta il ramo qui lasciando le modifiche fuori dallo staging.",
			action: () => void resetTo(sha, "mixed"),
		},
		{
			label: "Reset hard a questo commit",
			danger: true,
			hint: "Sposta il ramo qui e scarta le modifiche non committate: irreversibile.",
			action: () => void resetTo(sha, "hard"),
		},
		"separator",
		{
			label: "Cherry-pick sul ramo attuale",
			hint: "Copia questo commit sopra il ramo attuale come nuovo commit.",
			action: () => void cherryPickCommit(sha),
		},
		{
			label: "Copia SHA",
			hint: "Copia negli appunti l'identificativo completo del commit.",
			action: () => void copyText(sha),
		},
		"separator",
		{
			label: "Apri il commit nel browser",
			hint: "Apre la pagina web del commit sul provider del remoto.",
			action: () => {
				const root = state.root;
				if (!root) return;
				void guard("Browser", () => api.openCommitInBrowser(root, sha));
			},
		},
	];
	if (commit) {
		entries.push({
			label: "Copia messaggio",
			hint: "Copia negli appunti il titolo del commit.",
			action: () => void copyText(commit.subject),
		});
	}
	openMenu(event.clientX, event.clientY, entries);
});

// Il menu si chiude appena si clicca altrove, si scorre o si ridimensiona.
document.addEventListener("click", (event) => {
	const target = event.target as HTMLElement;
	if (!target.closest("#ctx-menu")) closeMenu();
});
document.addEventListener("scroll", () => closeMenu(), true);
window.addEventListener("resize", () => closeMenu());
updateTerminalState();

// ── pannello dei dettagli: altezza, riduzione, finestra separata ──────────────

ui.btnBottomCollapse.addEventListener("click", () => {
	bottomCollapsed = !bottomCollapsed;
	applyBottomLayout();
	saveBottomLayout();
});

ui.splitter.addEventListener("pointerdown", (event) => {
	if (bottomCollapsed) return;
	event.preventDefault();
	const rect = ui.main.getBoundingClientRect();
	ui.main.classList.add("is-resizing");
	const move = (pointer: PointerEvent): void => {
		const ratio = (rect.bottom - pointer.clientY) / rect.height;
		bottomLayout.height = Math.min(78, Math.max(18, ratio * 100));
		ui.main.style.setProperty("--bottom-h", `${bottomLayout.height}%`);
	};
	const finish = (): void => {
		ui.main.classList.remove("is-resizing");
		window.removeEventListener("pointermove", move);
		window.removeEventListener("pointerup", finish);
		window.removeEventListener("pointercancel", finish);
		saveBottomLayout();
	};
	window.addEventListener("pointermove", move);
	window.addEventListener("pointerup", finish);
	window.addEventListener("pointercancel", finish);
});

ui.btnBottomDetach.addEventListener("click", () => {
	void api.detachPanel().catch((error: Error) => {
		toast(`Finestra del pannello: ${readableError(error)}`);
	});
});

api.onPanelDetached((detached) => {
	if (panelMode) return;
	panelDetached = detached;
	ui.main.classList.toggle("is-detached", detached);
	ui.panelDetachedChip.classList.toggle("hidden", !detached);
	// la finestra appena aperta deve ricevere subito cosa stiamo guardando
	if (detached) publishPanel();
});
ui.panelDetachedChip.addEventListener("click", () => {
	void api.detachPanel().catch((error: Error) => {
		toast(`Finestra del pannello: ${readableError(error)}`);
	});
});

api.onPanelState((payload) => {
	if (!panelMode) return;
	if (!state.root) {
		// la finestra sta ancora aprendo il repository: si applica appena è pronta
		pendingPanelState = payload;
		return;
	}
	void applyPanelState(payload);
});

// ── benvenuto, creazione, clone, account ────────────────────────────────────

/** Cartella di base dalle impostazioni: "" = home dell'utente (la conosce solo il main). */
let baseFolder = "";

function setBaseFolder(root: string | null): void {
	baseFolder = root ?? "";
	ui.welcomeBase.textContent = baseFolder || "home dell'utente";
}

async function loadBaseFolder(): Promise<void> {
	const settings = await guard("Impostazioni", () => api.settings());
	if (settings) setBaseFolder(settings.defaultRoot);
}

/**
 * Lo stato «nessun repository aperto»: si vede il benvenuto al posto di barra laterale e storia.
 * All'avvio non si apre il dialog di sistema: la scelta è dell'utente.
 */
function updateEmptyState(): void {
	const empty = sessions.size === 0;
	document.body.classList.toggle("is-empty", empty);
	ui.welcome.hidden = !empty;
	ui.welcomeBase.textContent = baseFolder || "home dell'utente";
	// senza repository questi comandi non hanno un bersaglio: meglio spenti che in errore
	for (const button of [
		ui.btnRefresh,
		ui.btnFetch,
		ui.btnPull,
		ui.btnPush,
		ui.btnStash,
		ui.btnSubmodule,
		ui.btnUndo,
		ui.btnFolder,
	]) {
		button.disabled = empty;
	}
}

function joinPath(parent: string, name: string): string {
	return `${parent.replace(/\/+$/, "")}/${name}`;
}

/** Cartella genitore: quella scritta, o quella scelta con il dialog. `null` = annullato. */
async function ensureParent(
	input: HTMLInputElement,
	title: string
): Promise<string | null> {
	const typed = input.value.trim();
	if (typed) return typed;
	const chosen = await guard(title, () =>
		api.chooseFolder(title, baseFolder || undefined)
	);
	if (!chosen) return null;
	input.value = chosen;
	return chosen;
}

function validRepoName(name: string): boolean {
	return (
		name !== "" &&
		name !== "." &&
		name !== ".." &&
		!/[\\/\x00-\x1f]/.test(name)
	);
}

// ── creare un repository ────────────────────────────────────────────────────

async function openCreate(): Promise<void> {
	ui.createParent.value = baseFolder;
	ui.createName.value = "";
	ui.createUserName.value = "";
	ui.createUserEmail.value = "";
	ui.createDialog.showModal();
	ui.createName.focus();
}

async function createRepository(): Promise<void> {
	const name = ui.createName.value.trim();
	if (!validRepoName(name)) {
		toast(
			"Nome del repository non valido: niente barre o caratteri di controllo."
		);
		return;
	}
	const parent = await ensureParent(
		ui.createParent,
		"Dove creare il repository"
	);
	if (!parent) return;

	const userName = ui.createUserName.value.trim();
	const email = ui.createUserEmail.value.trim();
	if ((userName && !email) || (!userName && email)) {
		toast(
			"Nome ed email dell'identità vanno insieme, oppure tutti e due vuoti."
		);
		return;
	}

	ui.createDialog.close();
	const snapshot = await guard("Creazione", () =>
		api.initRepo(
			joinPath(parent, name),
			userName ? { name: userName, email } : null
		)
	);
	if (!snapshot) return;
	adoptSnapshot(snapshot);
	toast("Repository creato.", "ok");
}

// ── clonare un repository ───────────────────────────────────────────────────

function updateCloneTarget(): void {
	const url = ui.cloneUrl.value.trim();
	if (!url) {
		ui.cloneTarget.textContent = "";
		return;
	}
	let name: string;
	try {
		name = repoNameFromUrl(url);
	} catch {
		ui.cloneTarget.textContent = "URL non riconosciuto.";
		return;
	}
	const parent = ui.cloneParent.value.trim() || baseFolder;
	ui.cloneTarget.textContent = parent
		? `Destinazione: ${joinPath(parent, name)}`
		: `Destinazione: <cartella scelta>/${name}`;
}

async function openClone(): Promise<void> {
	ui.cloneUrl.value = "";
	ui.cloneParent.value = baseFolder;
	updateCloneTarget();
	ui.cloneDialog.showModal();
	ui.cloneUrl.focus();
}

async function cloneFromUrl(): Promise<void> {
	const url = ui.cloneUrl.value.trim();
	if (!url) {
		toast("Incolla l'URL del repository.");
		return;
	}
	let name: string;
	try {
		name = repoNameFromUrl(url);
	} catch (error) {
		toast(readableError(error));
		return;
	}
	const parent = await ensureParent(
		ui.cloneParent,
		"Dove clonare il repository"
	);
	if (!parent) return;

	ui.cloneDialog.close();
	toast("Clone in corso…", "ok");
	showNetworkPhase("Rete");
	const snapshot = await guard("Clone", () =>
		api.cloneRepo(url, joinPath(parent, name))
	);
	hideNetwork();
	if (!snapshot) return;
	adoptSnapshot(snapshot);
	toast("Repository clonato.", "ok");
}

// ── account collegati ───────────────────────────────────────────────────────

let accountsCache: AccountsInfo | null = null;
let selectedAccount: string | null = null;
let remoteReposCache: RemoteRepo[] = [];
/** ultima pagina caricata dell'elenco repository; 0 = nessun elenco */
let remoteReposPage = 0;

function fillAccountProviders(): void {
	if (ui.accountProvider.options.length > 0) return;
	for (const provider of PROVIDERS) {
		const option = document.createElement("option");
		option.value = provider.id;
		option.textContent = provider.label;
		ui.accountProvider.appendChild(option);
	}
}

/** Host e API seguono il provider; per GitHub e Bitbucket restano fissi. */
function applyProviderDefaults(): void {
	const value = ui.accountProvider.value;
	if (!isProviderId(value)) return;
	const info = providerInfo(value);
	ui.accountHost.value = info.host;
	ui.accountApiBase.value = info.apiBase;
	ui.accountHost.readOnly = !info.editable;
	ui.accountApiBase.readOnly = !info.editable;
	ui.accountApiField.style.display = info.editable ? "" : "none";
	updateOauthUi();
	if (info.editable && !info.host) ui.accountHost.focus();
}

/**
 * L'accesso dal browser esiste dove il provider ha il device flow (GitHub, GitLab): altrove resta
 * la pagina dei token, e il campo Client ID non ha senso.
 */
function oauthAvailable(): boolean {
	const value = ui.accountProvider.value;
	if (!isProviderId(value)) return false;
	const info = providerInfo(value);
	const host = ui.accountHost.value.trim() || info.host;
	const apiBase = ui.accountApiBase.value.trim() || info.apiBase;
	try {
		return deviceFlow(value, host, apiBase) !== null;
	} catch {
		// host o API ancora incompleti: niente flusso finché non sono validi
		return false;
	}
}

function updateOauthUi(): void {
	const available = oauthAvailable();
	ui.accountOauthClientField.style.display = available ? "" : "none";
	ui.accountOauthStart.disabled = !available;
	ui.accountOauthStart.title = available
		? "Apre la pagina di verifica e attende l'autorizzazione"
		: "Questo provider non ha l'accesso dal browser: usa il token";
}

/** Il Client ID è l'unica cosa che il device flow non può indovinare: si crea sul sito. */
function openOauthClientHelp(): void {
	const value = ui.accountProvider.value;
	if (!isProviderId(value)) return;
	const info = providerInfo(value);
	const host = ui.accountHost.value.trim() || info.host;
	const apiBase = ui.accountApiBase.value.trim() || info.apiBase;
	let flow: ReturnType<typeof deviceFlow>;
	try {
		flow = deviceFlow(value, host, apiBase);
	} catch (error) {
		toast(readableError(error));
		return;
	}
	if (!flow) {
		toast("Questo provider non ha l'accesso dal browser: usa il token.");
		return;
	}
	void guard("Browser", () => api.openExternal(flow.clientPageUrl));
}

/** Pagina del provider dove il token si crea a mano, con gli scope già indicati dove possibile. */
function openTokenPage(): void {
	const value = ui.accountProvider.value;
	if (!isProviderId(value)) return;
	const info = providerInfo(value);
	const host = ui.accountHost.value.trim() || info.host;
	const apiBase = ui.accountApiBase.value.trim() || info.apiBase;
	let url: string;
	try {
		url = tokenPageUrl(value, host, apiBase);
	} catch (error) {
		toast(readableError(error));
		return;
	}
	void (async () => {
		await guard("Browser", () => api.openExternal(url));
		ui.accountToken.focus();
	})();
}

/** I campi del dialogo come `AccountInput`, senza il token: serve sia al salvataggio sia all'OAuth. */
function accountInputFromForm(): AccountInput | null {
	const value = ui.accountProvider.value;
	if (!isProviderId(value)) {
		toast("Scegli un provider.");
		return null;
	}
	const info = providerInfo(value);
	return {
		provider: value,
		host: ui.accountHost.value.trim() || info.host,
		apiBase: ui.accountApiBase.value.trim() || info.apiBase,
		username: ui.accountUsername.value.trim(),
		label: ui.accountLabel.value.trim(),
		oauthClientId: ui.accountOauthClient.value.trim(),
	};
}

/**
 * Device flow: il codice si mostra qui, la pagina si apre nel browser e il main interroga il
 * provider. Il token non passa mai da questa finestra: torna solo l'esito.
 */
async function startBrowserOauth(): Promise<void> {
	const input = accountInputFromForm();
	if (!input) return;
	const clientId = input.oauthClientId ?? "";
	if (!clientId) {
		const message =
			"Per l'accesso dal browser serve un Client ID OAuth registrato: senza, il provider non può rilasciare il token. Usa «Accedi con il token del computer», oppure «Crea un token sul sito e incollalo…».";
		ui.accountOauthStatus.classList.add("is-error");
		ui.accountOauthStatus.textContent = message;
		toast(message);
		ui.accountOauthClient.focus();
		return;
	}
	ui.accountOauthStart.disabled = true;
	ui.accountOauthStatus.classList.remove("is-error");
	ui.accountOauthStatus.textContent = "Attendo l'autorizzazione nel browser…";
	try {
		const start = await api.oauthStart(input, clientId);
		ui.accountOauthStatus.textContent = `Codice: ${start.userCode} — inseriscilo nella pagina che si apre.`;
		await api.openExternal(start.verificationUri);
	} catch (error) {
		ui.accountOauthStart.disabled = false;
		ui.accountOauthStatus.classList.add("is-error");
		ui.accountOauthStatus.textContent = readableError(error);
	}
}

/**
 * «Accedi» senza chiedere niente: il main cerca un token già presente (`gh`, credential helper).
 * Se non c'è, lo dice e restano le due strade esplicite: browser con Client ID, o token incollato.
 */
async function claimAccountFromForm(): Promise<void> {
	const input = accountInputFromForm();
	if (!input) return;
	ui.accountClaim.disabled = true;
	ui.accountOauthStatus.classList.remove("is-error");
	ui.accountOauthStatus.textContent =
		"Cerco un token già presente sulla macchina…";
	try {
		const result = await api.claimAccount(input);
		ui.accountOauthStatus.textContent =
			result.source === "github-cli"
				? "Token trovato in GitHub CLI."
				: "Token trovato nel credential helper di Git.";
		await refreshAccountsAfterOauth(
			result.accountId,
			`Account collegato senza Client ID (${
				result.source === "github-cli"
					? "GitHub CLI"
					: "credential helper"
			}).`
		);
	} catch (error) {
		ui.accountOauthStatus.classList.add("is-error");
		ui.accountOauthStatus.textContent = `${readableError(
			error
		)} Puoi usare «Accedi con il browser» oppure incollare un token.`;
	} finally {
		ui.accountClaim.disabled = false;
	}
}

/** Dopo un accesso l'account esiste già nel main: qui si rilegge l'elenco. */
async function refreshAccountsAfterOauth(
	accountIdValue?: string,
	message = "Account collegato dal browser."
): Promise<void> {
	const info = await guard("Account", () => api.accounts());
	if (!info) return;
	accountsCache = info;
	selectedAccount =
		accountIdValue &&
		info.accounts.some((item) => item.id === accountIdValue)
			? accountIdValue
			: info.accounts[0]?.id ?? null;
	renderAccountList(selectedAccount);
	const account = info.accounts.find((item) => item.id === selectedAccount);
	if (account) fillAccountFields(account);
	remoteReposCache = [];
	remoteReposPage = 0;
	renderRemoteRepos();
	void refreshRepoAccount();
	toast(message, "ok");
}

function accountStatusText(account: Account | null): string {
	const helper = accountsCache?.credentialHelper ?? false;
	if (!account) return "";
	const hasToken = accountsCache?.tokens.includes(account.id) ?? false;
	if (hasToken)
		return helper
			? "Token disponibile; Git lo conserva nel suo archivio."
			: "Token in memoria: Git non ha un credential helper, quindi vale per questa sessione.";
	return helper
		? "Nessun token in memoria: se Git lo ha in archivio viene usato quello."
		: "Nessun token: inseriscilo per elencare e clonare i repository privati.";
}

function renderAccountList(activeId: string | null): void {
	clear(ui.accountList);
	const accounts = accountsCache?.accounts ?? [];
	if (accounts.length === 0) {
		ui.accountList.appendChild(el("li", "muted", "Nessun account."));
		return;
	}
	for (const account of accounts) {
		const item = el("li");
		item.dataset.id = account.id;
		if (account.id === activeId) item.classList.add("is-active");
		item.appendChild(el("span", "account-name", accountLabel(account)));
		const token = accountsCache?.tokens.includes(account.id)
			? " · token"
			: "";
		item.appendChild(
			el(
				"span",
				"account-sub",
				`${providerInfo(account.provider).label} · ${
					account.host
				}${token}`
			)
		);
		item.addEventListener("click", () => selectAccount(account.id));
		ui.accountList.appendChild(item);
	}
}

function fillAccountFields(account: Account): void {
	ui.accountProvider.value = account.provider;
	ui.accountHost.value = account.host;
	ui.accountApiBase.value = account.apiBase;
	ui.accountUsername.value = account.username;
	ui.accountLabel.value = account.label;
	ui.accountToken.value = "";
	ui.accountOauthClient.value = account.oauthClientId;
	const info = providerInfo(account.provider);
	ui.accountHost.readOnly = !info.editable;
	ui.accountApiBase.readOnly = !info.editable;
	ui.accountApiField.style.display = info.editable ? "" : "none";
	ui.accountStatus.textContent = accountStatusText(account);
	ui.accountStatus.classList.remove("is-error");
	ui.accountOauthStatus.textContent = "";
	ui.accountOauthStatus.classList.remove("is-error");
	updateOauthUi();
}

function startNewAccount(): void {
	selectedAccount = null;
	renderAccountList(null);
	ui.accountProvider.value = "github";
	applyProviderDefaults();
	ui.accountUsername.value = "";
	ui.accountLabel.value = "";
	ui.accountToken.value = "";
	ui.accountOauthClient.value = "";
	ui.accountStatus.textContent = "";
	ui.accountOauthStatus.textContent = "";
	ui.accountOauthStatus.classList.remove("is-error");
	updateOauthUi();
	remoteReposCache = [];
	remoteReposPage = 0;
	renderRemoteRepos();
	ui.btnMoreRepos.classList.add("hidden");
}

function selectAccount(id: string): void {
	selectedAccount = id;
	renderAccountList(id);
	const account = accountsCache?.accounts.find((item) => item.id === id);
	if (account) fillAccountFields(account);
	remoteReposCache = [];
	remoteReposPage = 0;
	renderRemoteRepos();
	ui.btnMoreRepos.classList.add("hidden");
}

async function openAccounts(): Promise<void> {
	fillAccountProviders();
	const info = await guard("Account", () => api.accounts());
	if (!info) return;
	accountsCache = info;
	if (!selectedAccount && info.accounts[0])
		selectedAccount = info.accounts[0].id;
	const account = info.accounts.find((item) => item.id === selectedAccount);
	renderAccountList(selectedAccount);
	if (account) fillAccountFields(account);
	else startNewAccount();
	ui.accountDest.value = ui.accountDest.value || baseFolder;
	if (!ui.accountDialog.open) {
		ui.accountDialog.showModal();
		// il primo elemento del dialogo è la lista: il fuoco va sul campo che si può compilare
		if (account) ui.accountUsername.focus();
		else ui.accountProvider.focus();
	}
}

async function saveAccountFromForm(): Promise<void> {
	const input = accountInputFromForm();
	if (!input) return;
	const token = ui.accountToken.value.trim();
	const previous = selectedAccount;
	let latest = await guard("Account", () =>
		api.saveAccount(input, token || undefined)
	);
	if (!latest) return;
	const nextId = accountId(input.provider, input.host, input.username);
	// cambiare utente o host produce un id nuovo: la voce di prima non deve restare orfana
	if (previous && previous !== nextId) {
		latest =
			(await guard("Account", () => api.removeAccount(previous))) ??
			latest;
	}
	accountsCache = latest;
	selectedAccount = nextId;
	const account = latest.accounts.find((item) => item.id === nextId);
	if (account) selectedAccount = account.id;
	renderAccountList(selectedAccount);
	if (account) fillAccountFields(account);
	toast(
		account && latest.tokens.includes(account.id)
			? "Account salvato."
			: "Account salvato: manca il token, quindi l'elenco dei repository non è disponibile.",
		"ok"
	);
	// un account in più cambia anche i candidati del repository attivo
	void refreshRepoAccount();
}

async function removeSelectedAccount(): Promise<void> {
	if (!selectedAccount) {
		toast("Scegli un account da rimuovere.");
		return;
	}
	const account = accountsCache?.accounts.find(
		(item) => item.id === selectedAccount
	);
	if (!account) return;
	if (
		!askConfirm(
			`Rimuovere l'account ${accountLabel(
				account
			)}? Il token resta nel credential helper di Git, se ne hai uno.`
		)
	)
		return;
	const info = await guard("Account", () => api.removeAccount(account.id));
	if (!info) return;
	accountsCache = info;
	selectedAccount = null;
	startNewAccount();
	if (info.accounts[0]) selectAccount(info.accounts[0].id);
	toast("Account rimosso.", "ok");
	void refreshRepoAccount();
}

/**
 * Elenco dei repository dell'account. Si carica una pagina per volta: `more` aggiunge la
 * successiva, altrimenti si riparte dalla prima. Che ci sia altro lo dice la taglia della pagina,
 * perché i provider non restituiscono sempre un totale affidabile.
 */
async function loadRemoteRepos(more = false): Promise<void> {
	if (!selectedAccount) {
		toast("Scegli un account: serve il suo token per leggere l'elenco.");
		return;
	}
	const id = selectedAccount;
	const account = accountsCache?.accounts.find((item) => item.id === id);
	const page = more ? remoteReposPage + 1 : 1;
	ui.btnLoadRepos.disabled = true;
	ui.btnMoreRepos.disabled = true;
	try {
		const repos = await guard("Repository", () =>
			api.accountRepos(id, page)
		);
		if (!repos) {
			ui.accountStatus.textContent =
				"Elenco non disponibile: leggi il messaggio.";
			ui.accountStatus.classList.add("is-error");
			return;
		}
		if (page === 1) {
			remoteReposCache = repos;
		} else {
			const known = new Set(
				remoteReposCache.map((repo) => repo.fullName)
			);
			remoteReposCache = [
				...remoteReposCache,
				...repos.filter((repo) => !known.has(repo.fullName)),
			];
		}
		remoteReposPage = page;
		renderRemoteRepos();
		const full =
			repos.length >= (account ? reposPageSize(account.provider) : 100);
		ui.btnMoreRepos.classList.toggle("hidden", !full);
		ui.accountStatus.textContent = `${remoteReposCache.length} repository.`;
		ui.accountStatus.classList.remove("is-error");
	} finally {
		ui.btnLoadRepos.disabled = false;
		ui.btnMoreRepos.disabled = false;
	}
}

function renderRemoteRepos(): void {
	clear(ui.remoteRepos);
	const query = ui.accountFilter.value.trim().toLowerCase();
	const repos = query
		? remoteReposCache.filter((repo) =>
				repo.fullName.toLowerCase().includes(query)
		  )
		: remoteReposCache;
	if (repos.length === 0) {
		ui.remoteRepos.appendChild(
			el(
				"li",
				"muted",
				remoteReposCache.length === 0
					? "Nessun elenco caricato."
					: "Nessun repository corrisponde al filtro."
			)
		);
		return;
	}
	for (const repo of repos) {
		const item = el("li");
		item.dataset.name = repo.fullName;
		item.appendChild(el("span", "repo-name", repo.fullName));
		if (repo.private) item.appendChild(el("span", "repo-badge", "privato"));
		const button = el(
			"button",
			"btn btn-small",
			"Clona"
		) as HTMLButtonElement;
		button.type = "button";
		button.addEventListener("click", () => void cloneRemoteRepo(repo));
		item.appendChild(button);
		ui.remoteRepos.appendChild(item);
	}
}

async function cloneRemoteRepo(repo: RemoteRepo): Promise<void> {
	let parent = ui.accountDest.value.trim() || baseFolder;
	if (!parent) {
		const chosen = await guard("Destinazione", () =>
			api.chooseFolder(
				"Dove clonare il repository",
				baseFolder || undefined
			)
		);
		if (!chosen) return;
		ui.accountDest.value = chosen;
		parent = chosen;
	}
	const dest = joinPath(parent, repo.name);
	if (!askConfirm(`Clonare ${repo.fullName} in ${dest}?`)) return;
	ui.accountDialog.close();
	toast("Clone in corso…", "ok");
	showNetworkPhase("Rete");
	const snapshot = await guard("Clone", () =>
		api.cloneRepo(repo.cloneUrl, dest)
	);
	hideNetwork();
	if (!snapshot) return;
	adoptSnapshot(snapshot);
	toast("Repository clonato.", "ok");
}

// ── fork, archivio, file del repository e Actions ───────────────────────────

/**
 * Sync con l'originale di un fork. Il `fetch` e il `merge`/`rebase` li fa il main; qui si chiede
 * conferma e si rilegge lo stato, perché un conflitto lascia l'operazione a metà e il chip
 * «annulla» deve comparire subito.
 */
async function syncForkWith(mode: "merge" | "rebase"): Promise<void> {
	const info = await guard("Fork", () => api.forkInfo());
	if (!info) return;
	if (!info.parent) {
		toast(
			"Questo repository non risulta un fork: non c'è un originale con cui sincronizzarsi."
		);
		return;
	}
	const parent = info.parent;

	// l'elenco aiuta a scegliere; se la rete non risponde si può ancora scrivere il nome
	let branches: string[] = [];
	try {
		branches = await api.forkBranches();
	} catch (error) {
		console.warn("rami dell'originale non leggibili:", error);
	}
	const candidates =
		branches.length > 0
			? ` (${branches.slice(0, 12).join(", ")}${
					branches.length > 12 ? ", …" : ""
			  })`
			: "";
	const branch = await askInput({
		title: "Sincronizza con l'originale",
		label: `${t("Ramo dell'originale")}${candidates}`,
		value: parent.defaultBranch,
	});
	if (branch === null) return;
	if (!branch.trim()) {
		toast("Scrivi il ramo dell'originale da portare nel ramo attuale.");
		return;
	}

	const preview = await guardRepo("Fork", () =>
		api.forkPreview(branch.trim())
	);
	if (!preview) return;
	const verb = t(mode === "merge" ? "Unire" : "Rebasare il ramo attuale su");
	if (
		!askConfirm(
			`${verb} ${parent.fullName}/${preview.branch}? Riceverai ${preview.behind} commit da ${preview.upstreamRef} e ne hai ${preview.ahead} non presenti lì. Le modifiche non committate possono fermare l'operazione; niente viene forzato.`
		)
	)
		return;
	const result = await guardRepo("Sincronizza fork", () =>
		api.syncFork(mode, branch.trim())
	);
	if (!result) return;
	const snapshot = await guard("Rilettura", () => api.refresh());
	if (snapshot) applySnapshot(snapshot);
	toast(
		result.created
			? `Remoto «upstream» aggiunto (${result.upstreamUrl}). ${result.branch} è ${result.ahead} commit avanti a ${result.upstreamRef}.`
			: `${result.branch} è ${result.ahead} commit avanti a ${result.upstreamRef}.`,
		"ok"
	);
}

async function exportRepositoryZip(): Promise<void> {
	const destination = await guard("Esporta zip", () => api.exportZip());
	if (destination) toast(`Archivio salvato in ${destination}.`, "ok");
}

// ── selettore dei file del repository ───────────────────────────────────────

/** Righe disegnate al massimo: oltre, il filtro è più utile di un elenco infinito. */
const FILE_ROWS = 400;

let fileListCache: string[] = [];
let fileSelectedPath: string | null = null;
let fileListTruncated = false;

async function openFilePicker(): Promise<void> {
	fileSelectedPath = null;
	fileListCache = [];
	fileListTruncated = false;
	ui.fileFilter.value = "";
	clear(ui.fileList);
	ui.fileStatus.textContent = "Leggo l'elenco dei file…";
	ui.fileStatus.classList.remove("is-error");
	ui.fileOpen.disabled = true;
	ui.fileBrowser.disabled = true;
	if (!ui.fileDialog.open) ui.fileDialog.showModal();
	const list = await guard("File del repository", () => api.listRepoFiles());
	if (!list) {
		ui.fileStatus.textContent =
			"Elenco non disponibile: leggi il messaggio.";
		ui.fileStatus.classList.add("is-error");
		return;
	}
	fileListCache = list.files;
	fileListTruncated = list.truncated;
	renderFileList();
	ui.fileFilter.focus();
}

function renderFileList(): void {
	clear(ui.fileList);
	const queryText = ui.fileFilter.value.trim().toLowerCase();
	const matches = queryText
		? fileListCache.filter((path) => path.toLowerCase().includes(queryText))
		: fileListCache;
	if (matches.length === 0) {
		ui.fileList.appendChild(
			el(
				"li",
				"muted",
				fileListCache.length === 0
					? "Nessun file tracciato."
					: "Nessun file corrisponde al filtro."
			)
		);
		ui.fileStatus.textContent = fileListTruncated
			? t("L'elenco è troncato dal repository.")
			: "";
		return;
	}
	const shown = matches.slice(0, FILE_ROWS);
	for (const path of shown) {
		const item = el("li");
		item.dataset.path = path;
		item.title =
			"Doppio clic per aprirlo dal disco; tasto destro per le altre azioni.";
		if (path === fileSelectedPath) item.classList.add("is-selected");
		item.appendChild(el("span", "repo-name", path));
		item.addEventListener("click", () => selectFile(path));
		item.addEventListener("dblclick", () => {
			selectFile(path);
			openSelectedFile();
		});
		ui.fileList.appendChild(item);
	}
	const more = matches.length - shown.length;
	ui.fileStatus.textContent = t(
		[
			`${matches.length} file`,
			more > 0 ? `mostrati i primi ${shown.length}` : "",
			fileListTruncated ? "elenco troncato dal repository" : "",
		]
			.filter(Boolean)
			.join(" · ")
	);
}

function selectFile(path: string): void {
	fileSelectedPath = path;
	ui.fileOpen.disabled = false;
	ui.fileBrowser.disabled = false;
	for (const node of ui.fileList.querySelectorAll<HTMLElement>(
		"li[data-path]"
	)) {
		node.classList.toggle("is-selected", node.dataset.path === path);
	}
}

function openSelectedFile(): void {
	if (!fileSelectedPath) return;
	const path = fileSelectedPath;
	ui.fileDialog.close();
	openFileWithSystem(path);
}

function openSelectedFileInBrowser(): void {
	if (!fileSelectedPath) return;
	const path = fileSelectedPath;
	ui.fileDialog.close();
	void guard("Browser", () => api.openFileInBrowser(path));
}

// ── GitHub Actions ──────────────────────────────────────────────────────────

let workflowRunsCache: WorkflowRun[] = [];

async function openActions(): Promise<void> {
	if (!ui.actionsDialog.open) ui.actionsDialog.showModal();
	await loadWorkflowRuns();
}

/** Apre l'avvio di un workflow: il ramo proposto è quello attivo, gli input restano vuoti. */
async function openDispatch(): Promise<void> {
	if (!ui.dispatchDialog.open) ui.dispatchDialog.showModal();
	ui.dispatchRef.value = state.snapshot?.info.branch ?? "";
	ui.dispatchInputs.value = "";
	ui.dispatchStatus.textContent = "";
	ui.dispatchStatus.classList.remove("is-error");
	await loadWorkflows();
}

async function loadWorkflows(): Promise<void> {
	clear(ui.dispatchWorkflow);
	ui.dispatchStart.disabled = true;
	ui.dispatchStatus.textContent = t("Leggo i workflow…");
	ui.dispatchStatus.classList.remove("is-error");
	try {
		const workflows = await api.workflows();
		if (workflows.length === 0) {
			ui.dispatchStatus.textContent = t("Nessun workflow attivo.");
			return;
		}
		for (const workflow of workflows) {
			const option = el(
				"option",
				"",
				workflow.path ? `${workflow.name} — ${workflow.path}` : workflow.name
			) as HTMLOptionElement;
			option.value = workflow.id;
			ui.dispatchWorkflow.appendChild(option);
		}
		ui.dispatchStart.disabled = false;
		ui.dispatchStatus.textContent = "";
	} catch (error) {
		ui.dispatchStatus.classList.add("is-error");
		ui.dispatchStatus.textContent = readableError(error);
	}
}

async function startDispatch(): Promise<void> {
	const id = ui.dispatchWorkflow.value;
	const ref = ui.dispatchRef.value.trim();
	if (!id) {
		ui.dispatchStatus.classList.add("is-error");
		ui.dispatchStatus.textContent = t("Scegli un workflow.");
		return;
	}
	if (!ref) {
		ui.dispatchStatus.classList.add("is-error");
		ui.dispatchStatus.textContent = t(
			"Scrivi il ramo o il tag su cui avviare il workflow."
		);
		return;
	}
	ui.dispatchStart.disabled = true;
	ui.dispatchStatus.classList.remove("is-error");
	ui.dispatchStatus.textContent = t("Avvio il workflow…");
	try {
		await api.dispatchWorkflow(id, ref, ui.dispatchInputs.value);
		ui.dispatchDialog.close();
		toast(t("Workflow avviato."), "ok");
		await loadWorkflowRuns();
	} catch (error) {
		ui.dispatchStatus.classList.add("is-error");
		ui.dispatchStatus.textContent = readableError(error);
	} finally {
		ui.dispatchStart.disabled = false;
	}
}

function runStatusClass(run: WorkflowRun): string {
	if (run.conclusion === "success") return "is-ok";
	if (
		run.conclusion &&
		run.conclusion !== "success" &&
		run.conclusion !== "skipped"
	)
		return "is-bad";
	return "";
}

async function loadWorkflowRuns(): Promise<void> {
	ui.actionsRefresh.disabled = true;
	ui.actionsStatus.textContent = "Leggo le esecuzioni…";
	ui.actionsStatus.classList.remove("is-error");
	clear(ui.actionsList);
	try {
		workflowRunsCache = await api.workflowRuns();
		renderWorkflowRuns();
	} catch (error) {
		ui.actionsStatus.classList.add("is-error");
		ui.actionsStatus.textContent = readableError(error);
	} finally {
		ui.actionsRefresh.disabled = false;
	}
}

function renderWorkflowRuns(): void {
	clear(ui.actionsList);
	if (workflowRunsCache.length === 0) {
		ui.actionsList.appendChild(el("li", "muted", "Nessuna esecuzione."));
		ui.actionsStatus.textContent = "";
		return;
	}
	for (const run of workflowRunsCache) {
		const item = el("li");
		item.dataset.id = run.id;
		const text = el("div", "actions-text");
		text.appendChild(el("span", "actions-name", run.name));
		const when = Date.parse(run.createdAt);
		const meta = [
			describeRun(run),
			run.branch || "?",
			run.event,
			run.attempt > 1 ? t(`tentativo ${run.attempt}`) : "",
			Number.isFinite(when) ? shortDate(when) : "",
		]
			.filter(Boolean)
			.join(" · ");
		text.appendChild(
			el("span", `actions-meta ${runStatusClass(run)}`.trim(), meta)
		);
		item.appendChild(text);

		const actions = el("div", "actions-actions");
		if (run.status !== "completed") {
			const cancel = el(
				"button",
				"btn btn-small",
				"Annulla"
			) as HTMLButtonElement;
			cancel.type = "button";
			cancel.title = "Annulla l'esecuzione in corso su GitHub.";
			cancel.addEventListener(
				"click",
				() => void workflowAction(run.id, "cancel")
			);
			actions.appendChild(cancel);
		} else {
			// dopo un fallimento la mossa utile è riprovare solo i job falliti
			if (canRerunFailed(run)) {
				const failed = el(
					"button",
					"btn btn-small",
					"Riprova i falliti"
				) as HTMLButtonElement;
				failed.type = "button";
				failed.title =
					"Riprova solo i job falliti, senza ripetere quelli già passati.";
				failed.addEventListener(
					"click",
					() => void workflowAction(run.id, "rerun-failed")
				);
				actions.appendChild(failed);
			}
			const rerun = el(
				"button",
				"btn btn-small",
				"Ri-esegui"
			) as HTMLButtonElement;
			rerun.type = "button";
			rerun.title =
				"Avvia di nuovo questo workflow con gli stessi parametri.";
			rerun.addEventListener(
				"click",
				() => void workflowAction(run.id, "rerun")
			);
			actions.appendChild(rerun);
		}
		if (run.url) {
			const open = el(
				"button",
				"btn btn-small",
				"Apri"
			) as HTMLButtonElement;
			open.type = "button";
			open.title = "Apre l'esecuzione su GitHub nel browser.";
			open.addEventListener(
				"click",
				() => void guard("Browser", () => api.openExternal(run.url))
			);
			actions.appendChild(open);
		}
		item.appendChild(actions);
		ui.actionsList.appendChild(item);
	}
	ui.actionsStatus.textContent = `${workflowRunsCache.length} esecuzioni.`;
}

async function workflowAction(
	id: string,
	action: WorkflowAction
): Promise<void> {
	if (action === "cancel" && !askConfirm("Annullare questa esecuzione?"))
		return;
	const done = await guard("Actions", () =>
		api.workflowRunAction(id, action)
	);
	if (done === null) return;
	toast(
		action === "cancel"
			? "Esecuzione annullata."
			: action === "rerun-failed"
			? "Job falliti ri-avviati."
			: "Esecuzione ri-avviata.",
		"ok"
	);
	await loadWorkflowRuns();
}

// ── pull request / merge request ────────────────────────────────────────────

let pullsCache: PullList | null = null;

/**
 * Ramo di arrivo proposto: il primo nome abituale che esiste fra i rami locali, altrimenti quello
 * corrente. Non è una regola del servizio, è solo il valore già scritto nel campo.
 */
function defaultTargetBranch(): string {
	const locals = new Set(
		(state.snapshot?.refs ?? [])
			.filter((ref) => ref.kind === "local")
			.map((ref) => ref.short)
	);
	for (const name of ["main", "master", "trunk", "develop"]) {
		if (locals.has(name)) return name;
	}
	return state.snapshot?.info.branch ?? "";
}

async function openPulls(): Promise<void> {
	if (!state.snapshot) return;
	const branch = state.snapshot.info.branch ?? "";
	const target = defaultTargetBranch();
	/*
	 * Sul ramo principale il senso è «dal ramo di lavoro verso main»: il campo di partenza resta
	 * vuoto invece di proporre un ramo uguale a quello di arrivo, che il servizio rifiuterebbe.
	 */
	ui.pullsNewSource.value = branch === target ? "" : branch;
	ui.pullsNewTarget.value = target;
	if (!ui.pullsDialog.open) ui.pullsDialog.showModal();
	await loadPulls();
}

async function loadPulls(): Promise<void> {
	ui.pullsRefresh.disabled = true;
	ui.pullsStatus.textContent = t("Leggo le pull request…");
	ui.pullsStatus.classList.remove("is-error");
	clear(ui.pullsList);
	try {
		pullsCache = await api.pullRequests();
		renderPulls();
	} catch (error) {
		pullsCache = null;
		ui.pullsStatus.classList.add("is-error");
		ui.pullsStatus.textContent = readableError(error);
		ui.pullsOpenPage.disabled = true;
	} finally {
		ui.pullsRefresh.disabled = false;
	}
}

function renderPulls(): void {
	clear(ui.pullsList);
	const list = pullsCache?.pulls ?? [];
	// GitLab le chiama merge request: il titolo lo dice invece di lasciare la parola sbagliata
	ui.pullsTitle.textContent = t(
		pullsCache?.label === "merge request" ? "Merge request" : "Pull request"
	);
	ui.pullsOpenPage.disabled = !pullsCache?.webUrl;
	if (list.length === 0) {
		ui.pullsList.appendChild(
			el("li", "muted", t("Nessuna pull request aperta."))
		);
		ui.pullsStatus.textContent = "";
		return;
	}
	for (const pull of list) renderPullItem(pull);
	ui.pullsStatus.textContent = t(`${list.length} aperte.`);
}

function checkStateClass(state: CheckRun["state"]): string {
	if (state === "ok") return "is-ok";
	if (state === "failed") return "is-bad";
	if (state === "pending") return "is-pending";
	return "";
}

function renderPullItem(pull: PullRequest): void {
	const item = el("li");
	const description = el("div", "actions-text");
	const title = `${pull.draft ? `[${t("bozza")}] ` : ""}#${pull.number} · ${
		pull.title
	}`;
	description.appendChild(el("span", "actions-name", title));
	const when = Date.parse(pull.updatedAt);
	const meta = [
		pull.author,
		`${pull.source || "?"} → ${pull.target || "?"}`,
		Number.isFinite(when) ? shortDate(when) : "",
	]
		.filter(Boolean)
		.join(" · ");
	description.appendChild(el("span", "actions-meta", meta));
	item.appendChild(description);

	const checks = el("div", "pull-checks");
	checks.hidden = true;
	item.appendChild(checks);

	const actions = el("div", "actions-actions");
	const run = el(
		"button",
		"btn btn-small",
		t("Controlli")
	) as HTMLButtonElement;
	run.type = "button";
	if (pull.headSha) {
		run.title = t(
			"Legge gli esiti dei controlli sul commit in testa alla richiesta."
		);
		run.addEventListener(
			"click",
			() => void loadPullChecks(pull, run, checks)
		);
	} else {
		// senza lo SHA del ramo non c'è un indirizzo da chiedere: meglio spento che in errore
		run.disabled = true;
		run.title = t(
			"Il servizio non ha indicato il commit in testa a questa richiesta."
		);
	}
	actions.appendChild(run);

	const discuss = el(
		"button",
		"btn btn-small",
		t("Discussione")
	) as HTMLButtonElement;
	discuss.type = "button";
	discuss.title = t(
		"Legge i commenti della conversazione e ne aggiunge uno."
	);
	discuss.addEventListener("click", () => void openComments(pull));
	actions.appendChild(discuss);

	const open = el("button", "btn btn-small", t("Apri")) as HTMLButtonElement;
	open.type = "button";
	open.title = t("Apre la pull request nel browser.");
	open.addEventListener(
		"click",
		() => void guard("Browser", () => api.openExternal(pull.url))
	);
	actions.appendChild(open);
	item.appendChild(actions);
	ui.pullsList.appendChild(item);
}

async function loadPullChecks(
	pull: PullRequest,
	button: HTMLButtonElement,
	container: HTMLElement
): Promise<void> {
	button.disabled = true;
	container.hidden = false;
	clear(container);
	container.appendChild(el("div", "checks-summary", t("Leggo i controlli…")));
	try {
		const summary = await api.pullChecks(pull.headSha);
		renderCheckSummary(summary, container);
	} catch (error) {
		clear(container);
		container.appendChild(
			el("div", "checks-summary is-bad", readableError(error))
		);
	} finally {
		button.disabled = false;
	}
}

function renderCheckSummary(
	summary: CheckSummary,
	container: HTMLElement
): void {
	clear(container);
	const parts: string[] = [];
	if (summary.ok) parts.push(t(`${summary.ok} ok`));
	if (summary.failed) parts.push(t(`${summary.failed} falliti`));
	if (summary.pending) parts.push(t(`${summary.pending} in corso`));
	const headline = el(
		"div",
		`checks-summary ${checkStateClass(
			summary.state === "none" ? "neutral" : summary.state
		)}`,
		parts.join(" · ") || t("Nessun controllo.")
	);
	container.appendChild(headline);

	for (const run of summary.runs) {
		const line = el("div", "check-line");
		line.appendChild(el("span", `check-dot ${checkStateClass(run.state)}`));
		if (run.url) {
			const link = el(
				"button",
				"check-name",
				run.name
			) as HTMLButtonElement;
			link.type = "button";
			link.title = t("Apre il controllo nel browser.");
			link.addEventListener(
				"click",
				() => void guard("Browser", () => api.openExternal(run.url))
			);
			line.appendChild(link);
		} else {
			line.appendChild(el("span", "check-name", run.name));
		}
		if (run.detail)
			line.appendChild(el("span", "check-detail", run.detail));
		container.appendChild(line);
	}
}

let commentsPull: PullRequest | null = null;

/** Apre la conversazione della pull request scelta: i commenti arrivano dal servizio. */
async function openComments(pull: PullRequest): Promise<void> {
	commentsPull = pull;
	ui.commentsTitle.textContent = t("Discussione");
	ui.commentsPull.textContent = `#${pull.number} · ${pull.title}`;
	ui.commentsPull.title = pull.title;
	ui.commentsBody.value = "";
	ui.commentsStatus.textContent = "";
	ui.commentsStatus.classList.remove("is-error");
	if (!ui.commentsDialog.open) ui.commentsDialog.showModal();
	await loadComments();
}

async function loadComments(): Promise<void> {
	const pull = commentsPull;
	if (!pull) return;
	ui.commentsRefresh.disabled = true;
	ui.commentsSend.disabled = true;
	ui.commentsStatus.textContent = t("Leggo la discussione…");
	ui.commentsStatus.classList.remove("is-error");
	clear(ui.commentsList);
	try {
		const comments = await api.pullComments(pull.number);
		renderComments(comments);
		ui.commentsStatus.textContent = comments.length
			? t(`${comments.length} commenti.`)
			: "";
		// la conversazione è già scorsa in fondo: il commento nuovo sta lì
		ui.commentsList.scrollTop = ui.commentsList.scrollHeight;
	} catch (error) {
		ui.commentsStatus.classList.add("is-error");
		ui.commentsStatus.textContent = readableError(error);
	} finally {
		ui.commentsRefresh.disabled = false;
		ui.commentsSend.disabled = false;
	}
}

/**
 * Il testo si mostra come testo, mai come HTML: un commento arriva da fuori e non deve poter
 * aggiungere elementi alla finestra.
 */
function renderComments(comments: PullComment[]): void {
	clear(ui.commentsList);
	if (comments.length === 0) {
		ui.commentsList.appendChild(
			el("li", "muted", t("Nessun commento: puoi scrivere il primo."))
		);
		return;
	}
	for (const comment of comments) {
		const item = el("li");
		const head = el("div", "comment-head");
		head.appendChild(
			el("span", "comment-author", comment.author || t("Sconosciuto"))
		);
		const when = Date.parse(comment.createdAt);
		if (Number.isFinite(when))
			head.appendChild(el("span", "comment-when", shortDate(when)));
		if (comment.url) {
			const link = el(
				"button",
				"comment-link",
				t("Apri")
			) as HTMLButtonElement;
			link.type = "button";
			link.title = t("Apre il commento nel browser.");
			link.addEventListener(
				"click",
				() => void guard("Browser", () => api.openExternal(comment.url))
			);
			head.appendChild(link);
		}
		item.appendChild(head);
		item.appendChild(el("div", "comment-body", comment.body));
		ui.commentsList.appendChild(item);
	}
}

async function sendComment(): Promise<void> {
	const pull = commentsPull;
	if (!pull) return;
	const body = ui.commentsBody.value.trim();
	if (!body) {
		ui.commentsStatus.classList.add("is-error");
		ui.commentsStatus.textContent = t("Scrivi il commento prima di inviarlo.");
		return;
	}
	ui.commentsSend.disabled = true;
	ui.commentsRefresh.disabled = true;
	ui.commentsStatus.classList.remove("is-error");
	ui.commentsStatus.textContent = t("Invio il commento…");
	try {
		await api.addPullComment(pull.number, body);
		ui.commentsBody.value = "";
		await loadComments();
		// loadComments riporta il conteggio: dopo un invio conta di più il fatto che sia andata
		ui.commentsStatus.textContent = t("Commento inviato.");
	} catch (error) {
		ui.commentsStatus.classList.add("is-error");
		ui.commentsStatus.textContent = readableError(error);
	} finally {
		ui.commentsSend.disabled = false;
		ui.commentsRefresh.disabled = false;
	}
}

async function createPullFromForm(): Promise<void> {
	const title = ui.pullsNewTitle.value.trim();
	const source = ui.pullsNewSource.value.trim();
	const target = ui.pullsNewTarget.value.trim();
	if (!title || !source || !target) {
		ui.pullsStatus.classList.add("is-error");
		ui.pullsStatus.textContent = t(
			"Servono titolo e due rami: quello di partenza e quello di arrivo."
		);
		return;
	}
	ui.pullsCreate.disabled = true;
	try {
		const pull = await guard("Pull request", () =>
			api.createPullRequest({
				title,
				body: ui.pullsNewBody.value,
				source,
				target,
			})
		);
		if (!pull) return;
		ui.pullsNewTitle.value = "";
		ui.pullsNewBody.value = "";
		toast(`Pull request #${pull.number} creata.`, "ok");
		await loadPulls();
	} finally {
		ui.pullsCreate.disabled = false;
	}
}

// ── reflog e «vai al commit» ────────────────────────────────────────────────

let reflogCache: ReflogEntry[] = [];

async function openReflog(): Promise<void> {
	if (!ui.reflogDialog.open) ui.reflogDialog.showModal();
	await loadReflog();
}

async function loadReflog(): Promise<void> {
	ui.reflogRefresh.disabled = true;
	ui.reflogStatus.textContent = t("Leggo il reflog…");
	ui.reflogStatus.classList.remove("is-error");
	clear(ui.reflogList);
	try {
		reflogCache = await api.reflog(200);
		renderReflog();
	} catch (error) {
		reflogCache = [];
		ui.reflogStatus.classList.add("is-error");
		ui.reflogStatus.textContent = readableError(error);
	} finally {
		ui.reflogRefresh.disabled = false;
	}
}

function renderReflog(): void {
	clear(ui.reflogList);
	if (reflogCache.length === 0) {
		ui.reflogList.appendChild(el("li", "muted", t("Reflog vuoto.")));
		ui.reflogStatus.textContent = "";
		return;
	}
	for (const entry of reflogCache) renderReflogItem(entry);
	ui.reflogStatus.textContent = t(`${reflogCache.length} voci.`);
}

function renderReflogItem(entry: ReflogEntry): void {
	const item = el("li");
	const description = el("div", "actions-text");
	description.appendChild(
		el("span", "actions-name", `${entry.short} · ${entry.action}`)
	);
	const when = Date.parse(entry.date);
	description.appendChild(
		el(
			"span",
			"actions-meta",
			`${entry.selector}${
				Number.isFinite(when) ? ` · ${shortDate(when)}` : ""
			}`
		)
	);
	item.appendChild(description);

	const actions = el("div", "actions-actions");
	const open = el(
		"button",
		"btn btn-small",
		t("Vai al commit")
	) as HTMLButtonElement;
	open.type = "button";
	open.title = t("Apre questo commit nel pannello dei dettagli.");
	open.addEventListener("click", () => {
		ui.reflogDialog.close();
		void selectCommit(entry.sha);
	});
	actions.appendChild(open);
	item.appendChild(actions);
	ui.reflogList.appendChild(item);
}

// ── ricerca nel contenuto ────────────────────────────────────────────────────

let contentRequest = 0;

function openContentSearch(): void {
	ui.contentQuery.focus();
	ui.contentQuery.select();
	if (!ui.contentDialog.open) ui.contentDialog.showModal();
}

async function runContentSearch(): Promise<void> {
	const query: ContentQuery = {
		text: ui.contentQuery.value,
		regex: ui.contentRegex.checked,
		caseSensitive: ui.contentCase.checked,
	};
	if (!query.text.trim()) {
		ui.contentStatus.textContent = t("Scrivi un testo da cercare.");
		ui.contentStatus.classList.add("is-error");
		return;
	}
	const token = ++contentRequest;
	ui.contentStatus.classList.remove("is-error", "is-ok");
	ui.contentStatus.textContent = t("Cerco nei file…");
	clear(ui.contentList);
	try {
		const result = await api.searchContent(query);
		if (token !== contentRequest) return;
		renderContentResults(result);
	} catch (error) {
		if (token !== contentRequest) return;
		ui.contentStatus.classList.add("is-error");
		ui.contentStatus.textContent = readableError(error);
	}
}

function renderContentResults(result: ContentSearchResult): void {
	clear(ui.contentList);
	if (result.matches.length === 0) {
		ui.contentList.appendChild(el("li", "muted", t("Nessun risultato.")));
		ui.contentStatus.textContent = "";
		return;
	}
	for (const match of result.matches) renderContentMatch(match);
	ui.contentStatus.textContent = result.truncated
		? t(`Primi ${result.matches.length} risultati: restringi la ricerca.`)
		: t(
				`${result.matches.length} ${
					result.matches.length === 1 ? "risultato" : "risultati"
				}.`
		  );
}

function renderContentMatch(match: ContentMatch): void {
	const item = el("li");
	const text = el("div", "actions-text");
	text.appendChild(el("span", "actions-name", `${match.path}:${match.line}`));
	text.appendChild(el("span", "actions-meta", match.text));
	item.appendChild(text);

	const actions = el("div", "actions-actions");
	const open = el("button", "btn btn-small", t("Apri")) as HTMLButtonElement;
	open.type = "button";
	open.title = t("Apre il file con l'app del sistema.");
	open.addEventListener("click", () => {
		void guard("Apri file", () => api.openFile(state.root, match.path));
	});
	actions.appendChild(open);
	item.appendChild(actions);
	ui.contentList.appendChild(item);
}

// ── worktree ────────────────────────────────────────────────────────────────

async function openWorktrees(): Promise<void> {
	if (!ui.worktreeDialog.open) ui.worktreeDialog.showModal();
	await loadWorktrees();
}

async function loadWorktrees(): Promise<void> {
	ui.worktreeRefresh.disabled = true;
	ui.worktreeStatus.textContent = t("Leggo i worktree…");
	ui.worktreeStatus.classList.remove("is-error");
	clear(ui.worktreeList);
	try {
		renderWorktrees(await api.worktrees());
	} catch (error) {
		ui.worktreeStatus.classList.add("is-error");
		ui.worktreeStatus.textContent = readableError(error);
	} finally {
		ui.worktreeRefresh.disabled = false;
	}
}

function renderWorktrees(entries: WorktreeInfo[]): void {
	clear(ui.worktreeList);
	if (entries.length === 0) {
		ui.worktreeList.appendChild(el("li", "muted", t("Nessun worktree.")));
		ui.worktreeStatus.textContent = "";
		return;
	}
	for (const entry of entries) {
		const item = el("li");
		const text = el("div", "actions-text");
		text.appendChild(
			el(
				"span",
				"actions-name",
				entry.branch ?? t("HEAD staccato")
			)
		);
		const notes = [
			entry.path,
			entry.head ? entry.head.slice(0, 7) : "",
			entry.main ? t("principale") : "",
			entry.locked ? t("bloccato") : "",
			entry.prunable ? t("cartella sparita") : "",
		]
			.filter(Boolean)
			.join(" · ");
		text.appendChild(el("span", "actions-meta", notes));
		item.appendChild(text);

		const actions = el("div", "actions-actions");
		const open = el(
			"button",
			"btn btn-small",
			t("Apri")
		) as HTMLButtonElement;
		open.type = "button";
		open.title = t("Apre questo worktree in una scheda.");
		open.addEventListener("click", () => {
			ui.worktreeDialog.close();
			void openRepository(entry.path);
		});
		actions.appendChild(open);

		// il principale è la cartella del repository e una cartella sparita non si rimuove
		if (!entry.main && !entry.prunable) {
			const remove = el(
				"button",
				"btn btn-small",
				t("Rimuovi")
			) as HTMLButtonElement;
			remove.type = "button";
			remove.title = t(
				"Rimuove il worktree; Git rifiuta se contiene modifiche non committate."
			);
			remove.addEventListener("click", () => void removeWorktree(entry));
			actions.appendChild(remove);
		}
		item.appendChild(actions);
		ui.worktreeList.appendChild(item);
	}
	ui.worktreeStatus.textContent =
		entries.length === 1 ? t("1 worktree.") : t(`${entries.length} worktree.`);
}

async function createWorktree(): Promise<void> {
	const path = ui.worktreePath.value.trim();
	const branch = ui.worktreeBranch.value.trim();
	if (!path) {
		toast(t("Scegli la cartella del nuovo worktree."));
		return;
	}
	if (!branch) {
		toast(t("Scrivi il ramo del nuovo worktree."));
		return;
	}
	ui.worktreeCreate.disabled = true;
	try {
		renderWorktrees(await api.createWorktree(path, branch));
		ui.worktreePath.value = "";
		ui.worktreeBranch.value = "";
		toast(t("Worktree creato."), "ok");
	} catch (error) {
		ui.worktreeStatus.classList.add("is-error");
		ui.worktreeStatus.textContent = readableError(error);
	} finally {
		ui.worktreeCreate.disabled = false;
	}
}

async function removeWorktree(entry: WorktreeInfo): Promise<void> {
	if (
		!askConfirm(
			`Rimuovere il worktree «${entry.path}»? La cartella viene eliminata; Git rifiuta se contiene modifiche non committate.`
		)
	)
		return;
	try {
		renderWorktrees(await api.removeWorktree(entry.path));
		if (sessions.has(entry.path)) await closeSession(entry.path);
		toast(t("Worktree rimosso."), "ok");
	} catch (error) {
		ui.worktreeStatus.classList.add("is-error");
		ui.worktreeStatus.textContent = readableError(error);
	}
}

// ── rebase interattivo ──────────────────────────────────────────────────────

interface RebaseDraft {
	sha: string;
	message: string;
	action: RebaseAction;
}

let rebasePlan: {
	base: string;
	head: string;
	steps: RebaseDraft[];
} | null = null;

const REBASE_ACTIONS: RebaseAction[] = [
	"pick",
	"reword",
	"squash",
	"fixup",
	"drop",
];

/** Apre il piano di rebase dal commit indicato: Git decide quali commit sono toccati. */
async function openRebase(sha: string): Promise<void> {
	const plan = await guard("Rebase interattivo", () =>
		api.rebaseCandidates(sha)
	);
	if (!plan) return;
	rebasePlan = {
		base: plan.base,
		head: plan.head,
		steps: plan.candidates.map((candidate) => ({
			sha: candidate.sha,
			message: candidate.message,
			action: "pick",
		})),
	};
	ui.rebaseError.textContent = "";
	if (!ui.rebaseDialog.open) ui.rebaseDialog.showModal();
	renderRebase();
}

function renderRebase(): void {
	clear(ui.rebaseList);
	const plan = rebasePlan;
	if (!plan) return;
	ui.rebaseRange.textContent = t(
		`${plan.steps.length} commit da ${plan.base.slice(0, 8)} a HEAD`
	);

	let kept = false;
	plan.steps.forEach((step, index) => {
		const canCombine = kept;
		if (step.action !== "drop") kept = true;

		const row = el("li", "rebase-row");
		if (step.action === "drop") row.classList.add("is-drop");
		row.appendChild(el("span", "rebase-order", String(index + 1)));

		const text = el("div", "rebase-text");
		text.appendChild(
			el("span", "rebase-subject", subjectOf(step.message))
		);
		text.appendChild(
			el("span", "rebase-meta", step.sha.slice(0, 8))
		);
		if (step.action === "reword") {
			const area = el(
				"textarea",
				"rebase-message"
			) as HTMLTextAreaElement;
			area.value = step.message;
			area.dataset.rebaseMessage = String(index);
			area.title = t("Messaggio completo del commit rinominato");
			text.appendChild(area);
		}
		row.appendChild(text);

		const select = el("select") as HTMLSelectElement;
		select.dataset.rebaseAction = String(index);
		select.title = t("Cosa fare di questo commit");
		for (const action of REBASE_ACTIONS) {
			const option = el("option", "", action) as HTMLOptionElement;
			option.value = action;
			option.selected = step.action === action;
			// unire richiede un commit prima che resti
			if ((action === "squash" || action === "fixup") && !canCombine)
				option.disabled = true;
			select.appendChild(option);
		}
		row.appendChild(select);

		const controls = el("div", "rebase-controls");
		const up = el("button", "icon-btn", "↑") as HTMLButtonElement;
		up.type = "button";
		up.dataset.rebaseMove = "-1";
		up.disabled = index === 0;
		up.title = t("Sposta prima");
		const down = el("button", "icon-btn", "↓") as HTMLButtonElement;
		down.type = "button";
		down.dataset.rebaseMove = "1";
		down.disabled = index === plan.steps.length - 1;
		down.title = t("Sposta dopo");
		controls.append(up, down);
		row.appendChild(controls);
		ui.rebaseList.appendChild(row);
	});
}

async function applyRebase(): Promise<void> {
	if (!rebasePlan) return;
	const steps: RebaseStep[] = rebasePlan.steps.map((step) =>
		step.action === "reword"
			? { sha: step.sha, action: step.action, message: step.message }
			: { sha: step.sha, action: step.action }
	);
	try {
		validateRebaseSteps(steps);
	} catch (error) {
		ui.rebaseError.textContent = readableError(error);
		return;
	}
	ui.rebaseError.textContent = "";
	if (
		!askConfirm(
			`Riscrivere ${steps.length} commit da ${rebasePlan.base.slice(
				0,
				8
			)} a HEAD? La storia locale cambia: niente viene inviato al remoto e l'operazione resta annullabile con Annulla.`
		)
	)
		return;
	ui.rebaseApply.disabled = true;
	try {
		const snapshot = await guardRepo("Rebase interattivo", () =>
			api.rebaseInteractive(rebasePlan!.base, steps, rebasePlan!.head)
		);
		if (!snapshot) {
			// un conflitto apre la finestra di risoluzione: questa non deve coprirla
			if (state.snapshot?.info.operation) ui.rebaseDialog.close();
			return;
		}
		applySnapshot(snapshot);
		ui.rebaseDialog.close();
		toast("Rebase interattivo completato.", "ok");
	} finally {
		ui.rebaseApply.disabled = false;
	}
}

// ── recupero ────────────────────────────────────────────────────────────────

async function openRecovery(): Promise<void> {
	if (!ui.recoveryDialog.open) ui.recoveryDialog.showModal();
	await loadRecovery();
}

async function loadRecovery(): Promise<void> {
	ui.recoveryRefresh.disabled = true;
	ui.recoveryStatus.textContent = t("Cerco cosa si può recuperare…");
	ui.recoveryStatus.classList.remove("is-error");
	clear(ui.recoveryList);
	try {
		const [stashes, trash] = await Promise.all([
			api.stashList(),
			api.trashUsage(),
		]);
		renderRecovery(
			summarizeRecovery({
				undo: state.snapshot?.undo ?? null,
				stashes: stashes.length,
				trash,
			})
		);
	} catch (error) {
		ui.recoveryStatus.classList.add("is-error");
		ui.recoveryStatus.textContent = readableError(error);
	} finally {
		ui.recoveryRefresh.disabled = false;
	}
}

function recoveryAction(
	label: string,
	run: () => void,
	disabled = false
): HTMLButtonElement {
	const button = el("button", "btn btn-small", t(label)) as HTMLButtonElement;
	button.type = "button";
	button.disabled = disabled;
	button.addEventListener("click", run);
	return button;
}

function recoveryRow(
	label: string,
	detail: string,
	actions: HTMLButtonElement[]
): HTMLLIElement {
	const item = el("li");
	const text = el("div", "actions-text");
	text.appendChild(el("span", "actions-name", t(label)));
	text.appendChild(el("span", "actions-meta", detail));
	item.appendChild(text);
	const box = el("div", "actions-actions");
	box.append(...actions);
	item.appendChild(box);
	return item;
}

function renderRecovery(summary: RecoverySummary): void {
	clear(ui.recoveryList);

	ui.recoveryList.appendChild(
		recoveryRow(
			"Ultima operazione",
			summary.undoDescription ?? t("Niente da annullare."),
			[
				recoveryAction(
					"Annulla",
					() => {
						ui.recoveryDialog.close();
						void doUndo();
					},
					!summary.undoable
				),
			]
		)
	);

	ui.recoveryList.appendChild(
		recoveryRow(
			"Stash",
			summary.stashes === 0
				? t("Nessuno stash.")
				: t(`${summary.stashes} stash conservati.`),
			[
				recoveryAction("Apri gli stash", () => {
					ui.recoveryDialog.close();
					void openStash();
				}),
			]
		)
	);

	ui.recoveryList.appendChild(
		recoveryRow(
			"Copie dei file scartati",
			summary.trashEntries === 0
				? t("Nessuna copia conservata.")
				: t(
						`${summary.trashEntries} ${
							summary.trashEntries === 1 ? "copia" : "copie"
						} · ${summary.trashFiles} file · ${formatBytes(
							summary.trashBytes
						)}`
				  ),
			[]
		)
	);

	ui.recoveryList.appendChild(
		recoveryRow("Reflog", t("Gli spostamenti di HEAD, dal più recente."), [
			recoveryAction("Apri il reflog", () => {
				ui.recoveryDialog.close();
				void openReflog();
			}),
		])
	);

	ui.recoveryStatus.textContent = summary.anything
		? ""
		: t("Niente da recuperare.");
}

// ── salute del repository ───────────────────────────────────────────────────

const SUBMODULE_STATE_LABELS: Record<string, string> = {
	modified: "Modificato",
	uninitialized: "Non inizializzato",
	conflict: "Conflitto",
};

async function openHealth(): Promise<void> {
	if (!ui.healthDialog.open) ui.healthDialog.showModal();
	await loadHealth();
}

async function loadHealth(): Promise<void> {
	ui.healthRefresh.disabled = true;
	ui.healthStatus.textContent = t("Controllo il repository…");
	ui.healthStatus.classList.remove("is-error");
	clear(ui.healthList);
	clear(ui.healthRemotesList);
	try {
		renderHealth(await api.health());
	} catch (error) {
		ui.healthStatus.classList.add("is-error");
		ui.healthStatus.textContent = readableError(error);
	} finally {
		ui.healthRefresh.disabled = false;
	}
}

function healthRow(label: string, detail: string): HTMLLIElement {
	const item = el("li");
	const text = el("div", "actions-text");
	text.appendChild(el("span", "actions-name", t(label)));
	text.appendChild(el("span", "actions-meta", detail));
	item.appendChild(text);
	return item;
}

function renderHealth(report: HealthReport): void {
	clear(ui.healthList);
	if (report.clean) {
		ui.healthList.appendChild(
			el("li", "muted", t("Nessun problema trovato."))
		);
		ui.healthStatus.textContent = "";
		return;
	}

	if (report.detached) {
		ui.healthList.appendChild(
			healthRow(
				"HEAD staccato",
				t("I nuovi commit non appartengono a nessun ramo.")
			)
		);
	}
	if (report.diverged.length > 0) {
		ui.healthList.appendChild(
			healthRow(
				"Rami divergenti",
				report.diverged
					.map((ref) => `${ref.name} ↑${ref.ahead} ↓${ref.behind}`)
					.join(" · ")
			)
		);
	}
	if (report.orphanBranches.length > 0) {
		ui.healthList.appendChild(
			healthRow("Rami senza upstream", report.orphanBranches.join(" · "))
		);
	}
	for (const stash of report.staleStashes) {
		const days = Math.max(
			1,
			Math.floor((Date.now() - stash.timestamp * 1000) / 86_400_000)
		);
		ui.healthList.appendChild(
			healthRow(
				"Stash dimenticato",
				`${stash.message} · ${t(`${days} giorni fa`)}`
			)
		);
	}
	for (const module of report.dirtySubmodules) {
		ui.healthList.appendChild(
			healthRow(
				"Submodule non aggiornato",
				`${module.path} · ${t(
					SUBMODULE_STATE_LABELS[module.state] ?? module.state
				)}`
			)
		);
	}
	const total =
		(report.detached ? 1 : 0) +
		report.diverged.length +
		report.orphanBranches.length +
		report.staleStashes.length +
		report.dirtySubmodules.length;
	ui.healthStatus.textContent = t(
		total === 1 ? "1 segnalazione." : `${total} segnalazioni.`
	);
}

/** I remoti si controllano solo quando lo si chiede: la rete può essere lenta o assente. */
async function checkRemotes(): Promise<void> {
	ui.healthRemotes.disabled = true;
	const label = ui.healthRemotes.textContent;
	ui.healthRemotes.textContent = t("Controllo i remoti…");
	clear(ui.healthRemotesList);
	try {
		renderRemoteChecks(await api.remoteChecks());
	} catch (error) {
		ui.healthRemotesList.appendChild(
			el("li", "muted", readableError(error))
		);
	} finally {
		ui.healthRemotes.disabled = false;
		ui.healthRemotes.textContent = label;
	}
}

function renderRemoteChecks(checks: RemoteCheck[]): void {
	clear(ui.healthRemotesList);
	if (checks.length === 0) {
		ui.healthRemotesList.appendChild(
			el("li", "muted", t("Nessun remoto configurato."))
		);
		return;
	}
	for (const check of checks) {
		const item = el("li");
		const text = el("div", "actions-text");
		text.appendChild(el("span", "actions-name", check.name));
		text.appendChild(
			el(
				"span",
				"actions-meta",
				check.url || t("indirizzo non disponibile")
			)
		);
		item.appendChild(text);
		item.appendChild(
			el(
				"span",
				"actions-meta",
				check.reachable
					? t(`Raggiungibile · ${check.heads} rami`)
					: t(`Non raggiungibile · ${check.error ?? "errore"}`)
			)
		);
		ui.healthRemotesList.appendChild(item);
	}
}

/** Salto a un commit qualsiasi: la storia caricata non conta, `selectCommit` chiede il dettaglio a
 * Git. Lo SHA accorciato va bene, ma deve sembrare uno SHA e non un'opzione.
 */
async function goToCommitBySha(): Promise<void> {
	const value = await askInput({
		title: t("Vai al commit"),
		label: t("SHA del commit"),
	});
	if (value === null) return;
	const sha = value.trim();
	if (!/^[0-9a-f]{4,64}$/i.test(sha)) {
		toast(t("Uno SHA è fatto di cifre esadecimali: per esempio 1a2b3c4."));
		return;
	}
	// se lo SHA accorciato è già nella pagina caricata si usa quello completo, così la riga si accende
	const known = state.commits.find((commit) =>
		commit.sha.toLowerCase().startsWith(sha.toLowerCase())
	);
	await selectCommit(known?.sha ?? sha);
}

// ── eventi ───────────────────────────────────────────────────────────────────

ui.btnOpen.addEventListener("click", () => void openRepository());
ui.btnFolder.addEventListener("click", () => openRepoFolder());
ui.btnClone.addEventListener("click", () => void openClone());

ui.btnWelcomeOpen.addEventListener("click", () => void openRepository());
ui.btnWelcomeCreate.addEventListener("click", () => void openCreate());
ui.btnWelcomeClone.addEventListener("click", () => void openClone());
ui.btnWelcomeAccount.addEventListener("click", () => void openAccounts());

// Crea / Clona: il dialog resta aperto se un campo non va, si chiude quando parte l'operazione.
ui.createForm.addEventListener("submit", (event) => {
	event.preventDefault();
	void createRepository();
});
ui.createCancel.addEventListener("click", () => ui.createDialog.close());
ui.createBrowse.addEventListener("click", () => {
	void (async () => {
		const chosen = await guard("Cartella", () =>
			api.chooseFolder(
				"Dove creare il repository",
				baseFolder || undefined
			)
		);
		if (chosen) ui.createParent.value = chosen;
	})();
});
ui.createName.addEventListener("input", () => {
	ui.createName.classList.remove("invalid");
});

ui.cloneForm.addEventListener("submit", (event) => {
	event.preventDefault();
	void cloneFromUrl();
});
ui.cloneCancel.addEventListener("click", () => ui.cloneDialog.close());
ui.cloneUrl.addEventListener("input", updateCloneTarget);
ui.cloneParent.addEventListener("input", updateCloneTarget);
ui.cloneBrowse.addEventListener("click", () => {
	void (async () => {
		const chosen = await guard("Cartella", () =>
			api.chooseFolder(
				"Dove clonare il repository",
				baseFolder || undefined
			)
		);
		if (chosen) {
			ui.cloneParent.value = chosen;
			updateCloneTarget();
		}
	})();
});

ui.accountProvider.addEventListener("change", applyProviderDefaults);
// host e API si possono scrivere a mano: il flusso dipende da quei valori
ui.accountHost.addEventListener("input", updateOauthUi);
ui.accountApiBase.addEventListener("input", updateOauthUi);
ui.accountOauthStart.addEventListener("click", () => void startBrowserOauth());
ui.repoAccount.addEventListener("click", (event) => {
	// il menu si chiude al primo clic fuori: questo clic è quello che lo apre
	event.stopPropagation();
	const box = (event.currentTarget as HTMLElement).getBoundingClientRect();
	openRepoAccountMenu(box.left, box.bottom + 4);
});

// File del repository: il form non deve chiudere il dialogo con Invio.
ui.fileForm.addEventListener("submit", (event) => event.preventDefault());
ui.fileFilter.addEventListener("input", () => renderFileList());
ui.fileOpen.addEventListener("click", openSelectedFile);
ui.fileBrowser.addEventListener("click", openSelectedFileInBrowser);
ui.fileClose.addEventListener("click", () => ui.fileDialog.close());
ui.fileDialog.addEventListener("close", () => {
	fileSelectedPath = null;
	fileListCache = [];
});

ui.actionsForm.addEventListener("submit", (event) => event.preventDefault());
ui.actionsRefresh.addEventListener("click", () => void loadWorkflowRuns());
ui.actionsClose.addEventListener("click", () => ui.actionsDialog.close());
ui.actionsDispatch.addEventListener("click", () => void openDispatch());
ui.dispatchForm.addEventListener("submit", (event) => {
	event.preventDefault();
	void startDispatch();
});
ui.dispatchClose.addEventListener("click", () => ui.dispatchDialog.close());

ui.pullsForm.addEventListener("submit", (event) => {
	event.preventDefault();
	void createPullFromForm();
});
ui.pullsRefresh.addEventListener("click", () => void loadPulls());
ui.pullsClose.addEventListener("click", () => ui.pullsDialog.close());
ui.pullsOpenPage.addEventListener("click", () => {
	if (pullsCache?.webUrl)
		void guard("Browser", () => api.openExternal(pullsCache!.webUrl));
});

ui.commentsForm.addEventListener("submit", (event) => {
	event.preventDefault();
	void sendComment();
});
ui.commentsBody.addEventListener("keydown", (event) => {
	// Ctrl+Invio invia, Invio va a capo: un commento può essere lungo
	if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) {
		event.preventDefault();
		void sendComment();
	}
});
ui.commentsRefresh.addEventListener("click", () => void loadComments());
ui.commentsClose.addEventListener("click", () => ui.commentsDialog.close());
ui.commentsOpen.addEventListener("click", () => {
	if (commentsPull)
		void guard("Browser", () => api.openExternal(commentsPull!.url));
});

ui.reflogForm.addEventListener("submit", (event) => event.preventDefault());
ui.reflogRefresh.addEventListener("click", () => void loadReflog());
ui.reflogClose.addEventListener("click", () => ui.reflogDialog.close());
ui.contentForm.addEventListener("submit", (event) => {
	event.preventDefault();
	void runContentSearch();
});
ui.contentClose.addEventListener("click", () => ui.contentDialog.close());
ui.rebaseForm.addEventListener("submit", (event) => event.preventDefault());
ui.rebaseCancel.addEventListener("click", () => ui.rebaseDialog.close());
ui.rebaseApply.addEventListener("click", () => void applyRebase());
ui.rebaseList.addEventListener("change", (event) => {
	const select = (event.target as HTMLElement).closest<HTMLSelectElement>(
		"select[data-rebase-action]"
	);
	if (!select || !rebasePlan) return;
	const index = Number(select.dataset.rebaseAction);
	const step = rebasePlan.steps[index];
	if (!step) return;
	const action = select.value as RebaseAction;
	if (!REBASE_ACTIONS.includes(action)) return;
	step.action = action;
	renderRebase();
});
ui.rebaseList.addEventListener("input", (event) => {
	const area = (event.target as HTMLElement).closest<HTMLTextAreaElement>(
		"textarea[data-rebase-message]"
	);
	if (!area || !rebasePlan) return;
	const index = Number(area.dataset.rebaseMessage);
	const step = rebasePlan.steps[index];
	if (step) step.message = area.value;
});
ui.rebaseList.addEventListener("click", (event) => {
	const button = (event.target as HTMLElement).closest<HTMLButtonElement>(
		"button[data-rebase-move]"
	);
	if (!button || !rebasePlan) return;
	// il dataset dice solo la direzione: l'indice arriva dalla riga
	const row = button.closest(".rebase-row");
	if (!row) return;
	const rows = [...ui.rebaseList.children];
	const from = rows.indexOf(row);
	const to = from + Number(button.dataset.rebaseMove ?? 0);
	if (from < 0 || to < 0 || to >= rebasePlan.steps.length) return;
	const [step] = rebasePlan.steps.splice(from, 1);
	if (!step) return;
	rebasePlan.steps.splice(to, 0, step);
	renderRebase();
});

ui.worktreeForm.addEventListener("submit", (event) => event.preventDefault());
ui.worktreeRefresh.addEventListener("click", () => void loadWorktrees());
ui.worktreeCreate.addEventListener("click", () => void createWorktree());
ui.worktreeClose.addEventListener("click", () => ui.worktreeDialog.close());
ui.worktreeChoose.addEventListener("click", async () => {
	const chosen = await api.chooseFolder(
		t("Cartella del nuovo worktree"),
		state.root || undefined
	);
	if (chosen) ui.worktreePath.value = chosen;
});
ui.recoveryForm.addEventListener("submit", (event) => event.preventDefault());
ui.recoveryRefresh.addEventListener("click", () => void loadRecovery());
ui.recoveryClose.addEventListener("click", () => ui.recoveryDialog.close());
ui.healthForm.addEventListener("submit", (event) => event.preventDefault());
ui.healthRefresh.addEventListener("click", () => void loadHealth());
ui.healthRemotes.addEventListener("click", () => void checkRemotes());
ui.healthClose.addEventListener("click", () => ui.healthDialog.close());
ui.accountOauthClientHelp.addEventListener("click", openOauthClientHelp);
ui.accountTokenPage.addEventListener("click", openTokenPage);
// chiudere il dialogo ferma l'attesa: nessun ciclo che continua senza finestra
ui.accountDialog.addEventListener("close", () => {
	ui.accountOauthStatus.textContent = "";
	ui.accountOauthStatus.classList.remove("is-error");
	ui.accountOauthStart.disabled = !oauthAvailable();
	void api.oauthCancel();
});
api.onOauth((event) => {
	ui.accountOauthStart.disabled = !oauthAvailable();
	if (event.state === "error") {
		ui.accountOauthStatus.classList.add("is-error");
		ui.accountOauthStatus.textContent =
			event.message ?? "Accesso non riuscito.";
		return;
	}
	ui.accountOauthStatus.classList.remove("is-error");
	ui.accountOauthStatus.textContent = "Accesso fatto.";
	void refreshAccountsAfterOauth(event.accountId);
});
ui.accountSave.addEventListener("click", () => void saveAccountFromForm());
ui.accountClaim.addEventListener("click", () => void claimAccountFromForm());
ui.btnMoreRepos.addEventListener("click", () => void loadRemoteRepos(true));
ui.accountNew.addEventListener("click", () => startNewAccount());
ui.accountRemove.addEventListener("click", () => void removeSelectedAccount());
ui.accountClose.addEventListener("click", () => ui.accountDialog.close());
ui.btnLoadRepos.addEventListener("click", () => void loadRemoteRepos());
ui.accountFilter.addEventListener("input", () => renderRemoteRepos());
ui.accountDestBrowse.addEventListener("click", () => {
	void (async () => {
		const chosen = await guard("Cartella", () =>
			api.chooseFolder(
				"Dove clonare il repository",
				baseFolder || undefined
			)
		);
		if (chosen) ui.accountDest.value = chosen;
	})();
});
// dentro un form che non deve inviare nulla al server
ui.accountForm.addEventListener("submit", (event) => event.preventDefault());

ui.btnChooseBase.addEventListener("click", () => {
	void (async () => {
		const chosen = await guard("Cartella", () =>
			api.chooseFolder(
				"Cartella di base",
				ui.settingBase.value.trim() || undefined
			)
		);
		if (chosen) ui.settingBase.value = chosen;
	})();
});

ui.btnUndo.addEventListener("click", () => void doUndo());
ui.btnRefresh.addEventListener("click", () => void refresh());

function updateDiffButtons(): void {
	for (const button of document.querySelectorAll<HTMLElement>(
		"[data-diff]"
	)) {
		button.classList.toggle(
			"is-active",
			button.dataset.diff === state.diffLayout
		);
	}
}

function setDiffLayout(layout: DiffLayout): void {
	if (layout === state.diffLayout) return;
	state.diffLayout = layout;
	updateDiffButtons();
	if (state.changePath && state.changeDiff) renderChangeDiff();
	// il commit è già in memoria: cambiare formato non richiede di rileggere il disco
	if (state.tab === "commit") paintCommitDiff();
	if (state.tab === "tree" && state.treePath) {
		void selectTreeFile(state.treePath);
	}
	publishPanel();
}

for (const button of document.querySelectorAll<HTMLButtonElement>(
	"[data-diff]"
)) {
	button.addEventListener("click", () => {
		setDiffLayout(button.dataset.diff === "split" ? "split" : "unified");
	});
}
// il formato attivo va mostrato subito, prima che si apra un repository
updateDiffButtons();
ui.btnFetch.addEventListener("click", () => void fetchAll());
ui.btnSettings.addEventListener("click", () => void openSettings());

ui.settingsCancel.addEventListener("click", () => ui.settingsDialog.close());
// Theme and density preview live; font scale is a window property and lands on save.
for (const select of [ui.settingTheme, ui.settingDensity]) {
	select.addEventListener("change", () =>
		applyAppearance(readAppearanceFromForm())
	);
}
ui.settingsDialog.addEventListener("close", () =>
	applyAppearance(dialogAppearance)
);
for (const radio of ui.settingsForm.querySelectorAll<HTMLInputElement>(
	"input[name=api-mode]"
)) {
	radio.addEventListener("change", updateApiToolState);
}
ui.settingTrash.addEventListener("change", updateTrashState);
ui.settingsForm.addEventListener("submit", (event) => {
	event.preventDefault();
	void (async () => {
		const saved = await guard("Impostazioni", () =>
			api.saveSettings(collectSettings())
		);
		if (!saved) return;
		fillSettings(saved);
		setBaseFolder(saved.defaultRoot);
		await refreshTrashUsage(saved.trash.quotaBytes);
		localStorage.setItem(LOCALE_STORAGE_KEY, saved.locale);
		localStorage.setItem(
			APPEARANCE_STORAGE_KEY,
			JSON.stringify(saved.appearance)
		);
		applyAppearance(saved.appearance);
		// Changing the language rebuilds the window: every view is rendered from the catalogue.
		if (resolveLocale(saved.locale) !== currentLocale()) {
			location.reload();
			return;
		}
		ui.settingsDialog.close();
		toast("Impostazioni salvate.", "ok");
	})();
});

// Il tab del pannello mostra le modifiche dentro la finestra; la voce della barra laterale le porta
// a tutta area: sono due modi diversi, e devono restare diversi.
ui.tabCommit.addEventListener("click", () => setTab("commit"));
ui.tabTree.addEventListener("click", () => setTab("tree"));
ui.tabBlame.addEventListener("click", () => setTab("blame"));
ui.tabTerm.addEventListener("click", () => setTab("term"));

ui.sideChanges.addEventListener("click", () => setSide("changes"));
ui.sideCommits.addEventListener("click", () => setSide("commits"));
ui.btnSearchFocus.addEventListener("click", () => ui.searchInput.focus());
ui.btnNewTab.addEventListener("click", (event) => {
	event.stopPropagation();
	const rect = ui.btnNewTab.getBoundingClientRect();
	openMenu(rect.left, rect.bottom + 4, [
		{
			label: "Apri un repository…",
			hint: "Sceglie una cartella già presente sul disco e la apre in una scheda.",
			action: () => void openRepository(),
		},
		{
			label: "Crea un repository…",
			hint: "Inizializza un repository nuovo in una cartella scelta da te.",
			action: () => void openCreate(),
		},
		{
			label: "Clona da URL…",
			hint: "Clona un repository indicando l'URL Git e la cartella di destinazione.",
			action: () => void openClone(),
		},
		{
			label: "Clona da un account…",
			hint: "Sceglie un repository dagli account collegati e lo clona.",
			action: () => void openAccounts(),
		},
	]);
});

for (const section of document.querySelectorAll<HTMLElement>(".side-section")) {
	section.querySelector("h2")?.addEventListener("click", () => {
		section.classList.toggle("is-collapsed");
	});
}

ui.searchInput.addEventListener("keydown", (event) => {
	if (event.key === "Enter") {
		event.preventDefault();
		void runSearch(ui.searchInput.value);
	} else if (event.key === "Escape") {
		event.preventDefault();
		void runSearch("");
	}
});

ui.searchInput.addEventListener("input", () => {
	// svuotare il campo toglie il filtro: non serve premere Invio
	if (!ui.searchInput.value.trim() && state.searchQuery) void runSearch("");
});

// La sintassi non si indovina: il suggerimento compare quando il campo è vuoto e ha il fuoco.
ui.searchInput.addEventListener("focus", () => {
	if (!ui.searchInput.value.trim())
		ui.searchInfo.textContent = t(
			"author: · file: · regex: · change: · diff: · lines:1,40:file"
		);
});
ui.searchInput.addEventListener("blur", () => {
	if (!state.searchQuery) ui.searchInfo.textContent = "";
});

ui.btnSearchClear.addEventListener("click", () => {
	ui.searchInput.focus();
	void runSearch("");
});

function changeListClick(event: Event): void {
	const target = event.target as HTMLElement;
	const item = target.closest<HTMLElement>("li");
	const path = item?.dataset.path;
	if (!path) return;
	const action = target.closest<HTMLElement>(".icon-btn")?.dataset.act;
	const staged = item?.dataset.side === "staged";

	if (action === "stage") void stage([path]);
	else if (action === "unstage") void unstage([path]);
	else if (action === "discard") void discard([path]);
	else void selectChange(path, staged);
}

ui.changesListStaged.addEventListener("click", changeListClick);
ui.changesListUnstaged.addEventListener("click", changeListClick);

/** Il trascinamento è della finestra, non del DOM: il file esce come se venisse da un gestore file. */
function startFileDrag(event: DragEvent): void {
	const target = (event.target as HTMLElement).closest<HTMLElement>(
		"[data-path]"
	);
	const path = target?.dataset.path;
	if (!path || !state.root) {
		event.preventDefault();
		return;
	}
	event.dataTransfer?.setData("text/plain", path);
	api.startDrag(state.root, path);
}

for (const list of [ui.changesListStaged, ui.changesListUnstaged]) {
	list.addEventListener("dragstart", startFileDrag);
}
ui.treeList.addEventListener("dragstart", startFileDrag);

ui.treeList.addEventListener("click", (event) => {
	const target = (event.target as HTMLElement).closest<HTMLElement>(
		".tree-node"
	);
	const path = target?.dataset.path;
	if (!path || !target) return;
	if (target.dataset.dir === "true") {
		if (state.treeAll) {
			if (state.lazyExpanded.has(path)) state.lazyExpanded.delete(path);
			else {
				state.lazyExpanded.add(path);
				if (!state.lazyTree.has(path)) void loadTreeDir(path);
			}
		} else if (state.treeCollapsed.has(path)) state.treeCollapsed.delete(path);
		else state.treeCollapsed.add(path);
		if (state.snapshot) renderTree(state.snapshot);
		return;
	}
	void selectTreeFile(path);
});

ui.treeList.addEventListener("dblclick", (event) => {
	const target = (event.target as HTMLElement).closest<HTMLElement>(
		".tree-node"
	);
	const path = target?.dataset.path;
	if (!path || target?.dataset.dir === "true") return;
	// in un commit il file può non essere più sul disco: lo mostra già il clic
	if (state.selectedCommit) return;
	openFileWithSystem(path);
});

ui.treeList.addEventListener("contextmenu", (event) => {
	const target = (event.target as HTMLElement).closest<HTMLElement>(
		".tree-node"
	);
	const path = target?.dataset.path;
	if (!path || target?.dataset.dir === "true") return;
	event.preventDefault();
	openMenu(event.clientX, event.clientY, fileMenuEntries(path));
});

ui.btnTreeMode.addEventListener("click", () => {
	state.treeAll = !state.treeAll;
	// l'altra vista non ha dati validi: si riparte dalla radice
	state.lazyTree.clear();
	state.lazyExpanded.clear();
	state.lazyLoading.clear();
	if (state.snapshot) renderTree(state.snapshot);
});

ui.btnTreeToggle.addEventListener("click", () => {
	const collapse = ui.btnTreeToggle.textContent?.trim() === "Comprimi";
	state.treeCollapsed.clear();
	if (collapse && state.snapshot) {
		const collect = (node: TreeNode): void => {
			for (const child of node.children) {
				if (!child.dir) continue;
				state.treeCollapsed.add(child.path);
				collect(child);
			}
		};
		collect(buildTree(treeFiles(state.snapshot)));
	}
	ui.btnTreeToggle.textContent = collapse ? "Espandi" : "Comprimi";
	if (state.snapshot) renderTree(state.snapshot);
});

ui.changesDiff.addEventListener("click", (event) => {
	const target = event.target as HTMLElement;

	const button = target.closest<HTMLElement>("[data-act]");
	if (button) {
		const hunk = Number(button.dataset.hunk);
		if (!Number.isInteger(hunk)) return;
		if (button.dataset.act?.endsWith("-hunk")) {
			void applyPartial([{ hunk }]);
		} else if (button.dataset.act?.endsWith("-lines")) {
			const lines: number[] = [];
			for (const key of state.picked) {
				const [h, l] = key.split(":").map(Number) as [number, number];
				if (h === hunk) lines.push(l);
			}
			if (lines.length > 0)
				void applyPartial(selectionForHunk(hunk, lines));
		}
		return;
	}

	const line = target.closest<HTMLElement>("[data-line]");
	if (!line) return;
	// solo i numeri di riga fanno da casella: il testo del diff resta selezionabile
	if (!target.closest(".no") && !target.closest(".mk")) return;
	const hunk = line.dataset.hunk;
	if (hunk === undefined || line.dataset.line === undefined) return;
	togglePick(Number(hunk), Number(line.dataset.line));
});

ui.btnStageAll.addEventListener("click", () => {
	const entries = state.snapshot?.status.entries ?? [];
	const paths = entries
		.filter((entry) => entry.kind === "untracked" || entry.worktree !== ".")
		.map((entry) => entry.path);
	if (paths.length > 0) void stage(paths);
});

ui.btnUnstageAll.addEventListener("click", () => {
	const entries = state.snapshot?.status.entries ?? [];
	const paths = entries
		.filter((entry) => entry.index !== ".")
		.map((entry) => entry.path);
	if (paths.length > 0) void unstage(paths);
});

ui.btnCommit.addEventListener("click", () => void doCommit());
ui.commitMessage.addEventListener("keydown", (event) => {
	if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) {
		event.preventDefault();
		void doCommit();
	}
});

ui.btnNewBranch.addEventListener("click", () => {
	ui.newBranchForm.classList.toggle("hidden");
	if (!ui.newBranchForm.classList.contains("hidden"))
		ui.newBranchName.focus();
});

ui.newBranchForm.addEventListener("submit", (event) => {
	event.preventDefault();
	const name = ui.newBranchName.value.trim();
	if (!name) return;
	void (async () => {
		const snapshot = await guard("Nuovo ramo", () =>
			api.createBranch(name)
		);
		if (snapshot) {
			ui.newBranchName.value = "";
			ui.newBranchForm.classList.add("hidden");
			applySnapshot(snapshot);
		}
	})();
});

// ── palette dei comandi ─────────────────────────────────────────────────────

/**
 * Un solo registro per la palette e per le scorciatoie: la stessa funzione che esegue un comando
 * quando si preme un tasto lo esegue anche quando lo si sceglie dall'elenco. Aggiungere una voce
 * qui la rende subito cercabile e documentabile.
 */
interface PaletteCommand {
	id: string;
	group: string;
	/** testo italiano di partenza: la palette lo traduce al momento di mostrarlo */
	label: string;
	/** tasto mostrato a destra; deve corrispondere a una scorciatoia vera */
	key?: string;
	/** altre parole che devono trovare il comando, anche nell'altra lingua */
	keywords?: string;
	/** i comandi che parlano del repository spariscono quando non ce n'è uno aperto */
	enabled?: () => boolean;
	run: () => void;
}

const repoReady = (): boolean => state.snapshot !== null && !panelMode;

const COMMANDS: PaletteCommand[] = [
	{
		id: "open",
		group: "Progetto",
		label: "Apri un repository…",
		key: "Ctrl+O",
		keywords: "open cartella folder",
		run: () => void openRepository(),
	},
	{
		id: "create",
		group: "Progetto",
		label: "Crea un repository…",
		keywords: "init nuovo new",
		run: () => void openCreate(),
	},
	{
		id: "clone",
		group: "Progetto",
		label: "Clona da URL…",
		keywords: "clone url remoto",
		run: () => void openClone(),
	},
	{
		id: "accounts",
		group: "Progetto",
		label: "Account collegati…",
		keywords: "account token accesso",
		run: () => void openAccounts(),
	},
	{
		id: "settings",
		group: "Progetto",
		label: "Impostazioni…",
		keywords: "settings preferenze lingua api permessi",
		run: () => void openSettings(),
	},
	{
		id: "refresh",
		group: "Progetto",
		label: "Aggiorna",
		key: "Ctrl+R",
		keywords: "refresh reload rileggi",
		enabled: repoReady,
		run: () => void refresh(),
	},
	{
		id: "folder",
		group: "Progetto",
		label: "Apri la cartella del repository",
		keywords: "folder cartella",
		enabled: repoReady,
		run: () => openRepoFolder(),
	},
	{
		id: "close",
		group: "Progetto",
		label: "Chiudi la scheda",
		keywords: "close tab scheda",
		enabled: repoReady,
		run: () => void closeSession(state.root),
	},
	{
		id: "side-changes",
		group: "Storia",
		label: "Mostra le modifiche",
		keywords: "changes modifiche working tree",
		enabled: repoReady,
		run: () => setSide("changes"),
	},
	{
		id: "side-commits",
		group: "Storia",
		label: "Mostra tutti i commit",
		keywords: "commits storia history",
		enabled: repoReady,
		run: () => setSide("commits"),
	},
	{
		id: "search",
		group: "Storia",
		label: "Cerca nella storia",
		key: "Ctrl+F",
		keywords: "search cerca filtro",
		enabled: repoReady,
		run: () => ui.searchInput.focus(),
	},
	{
		id: "clear-search",
		group: "Storia",
		label: "Togli il filtro dalla storia",
		keywords: "clear pulisci filtro",
		enabled: () => repoReady() && state.searchQuery !== null,
		run: () => void runSearch(""),
	},
	{
		id: "undo",
		group: "Storia",
		label: "Annulla l'ultima operazione",
		key: "Ctrl+Z",
		keywords: "undo annulla",
		enabled: () => repoReady() && state.snapshot?.undo != null,
		run: () => void doUndo(),
	},
	{
		id: "conflicts",
		group: "Storia",
		label: "Risolvi i conflitti",
		keywords: "conflict conflitti merge rebase",
		enabled: () => repoReady() && state.snapshot?.info.operation != null,
		run: () => void openConflicts(),
	},
	{
		id: "branch",
		group: "Rami e sincronizzazione",
		label: "Nuovo ramo",
		keywords: "branch ramo new",
		enabled: repoReady,
		run: () => {
			ui.newBranchForm.classList.remove("hidden");
			ui.newBranchName.focus();
		},
	},
	{
		id: "fetch",
		group: "Rami e sincronizzazione",
		label: "Fetch",
		keywords: "fetch remoto",
		enabled: repoReady,
		run: () => void fetchAll(),
	},
	{
		id: "pull",
		group: "Rami e sincronizzazione",
		label: "Pull",
		keywords: "pull aggiorna",
		enabled: repoReady,
		run: () => void pullChanges(),
	},
	{
		id: "push",
		group: "Rami e sincronizzazione",
		label: "Push",
		keywords: "push invia",
		enabled: repoReady,
		run: () => void pushChanges(),
	},
	{
		id: "stash",
		group: "Rami e sincronizzazione",
		label: "Stash…",
		keywords: "stash salva",
		enabled: repoReady,
		run: () => void openStash(),
	},
	{
		id: "submodules",
		group: "Rami e sincronizzazione",
		label: "Submodule…",
		keywords: "submodule sottomoduli",
		enabled: repoReady,
		run: () => void openSubmodules(),
	},
	{
		id: "actions",
		group: "Rami e sincronizzazione",
		label: "GitHub Actions…",
		keywords: "workflow esecuzioni ci actions",
		enabled: repoReady,
		run: () => void openActions(),
	},
	{
		id: "pulls",
		group: "Rami e sincronizzazione",
		label: "Pull request…",
		keywords: "pull request merge request pr mr richieste",
		enabled: repoReady,
		run: () => void openPulls(),
	},
	{
		id: "reflog",
		group: "Storia",
		label: "Reflog…",
		keywords: "reflog head cronologia movimenti",
		enabled: repoReady,
		run: () => void openReflog(),
	},
	{
		id: "worktrees",
		group: "Progetto",
		label: "Worktree…",
		keywords: "worktree cartelle rami checkout",
		enabled: repoReady,
		run: () => void openWorktrees(),
	},
	{
		id: "recovery",
		group: "Progetto",
		label: "Recupero…",
		keywords: "recupero annulla undo stash scartati reflog",
		enabled: repoReady,
		run: () => void openRecovery(),
	},
	{
		id: "health",
		group: "Progetto",
		label: "Salute del repository…",
		keywords: "health salute divergenti stash vecchi submodule staccato",
		enabled: repoReady,
		run: () => void openHealth(),
	},
	{
		id: "content-search",
		group: "Storia",
		label: "Cerca nel contenuto…",
		keywords: "grep contenuto file testo cerca",
		enabled: repoReady,
		run: () => openContentSearch(),
	},
	{
		id: "rebase-interactive",
		group: "Storia",
		label: "Rebase interattivo dal commit selezionato…",
		keywords: "rebase interattivo squash fixup reword riordina drop",
		enabled: () => repoReady() && Boolean(state.selectedCommit),
		run: () => {
			const sha = state.selectedCommit;
			if (sha) void openRebase(sha);
		},
	},
	{
		id: "goto-commit",
		group: "Storia",
		label: "Vai al commit per SHA…",
		keywords: "sha commit vai raggiungi",
		enabled: repoReady,
		run: () => void goToCommitBySha(),
	},
	{
		id: "tab-commit",
		group: "Vista",
		label: "Pannello: dettaglio del commit",
		key: "Ctrl+1",
		keywords: "commit panel",
		enabled: repoReady,
		run: () => setTab("commit"),
	},
	{
		id: "tab-tree",
		group: "Vista",
		label: "Pannello: file del commit",
		key: "Ctrl+2",
		keywords: "tree albero file",
		enabled: repoReady,
		run: () => setTab("tree"),
	},
	{
		id: "tab-blame",
		group: "Vista",
		label: "Pannello: blame",
		key: "Ctrl+3",
		keywords: "blame righe",
		enabled: repoReady,
		run: () => setTab("blame"),
	},
	{
		id: "tab-term",
		group: "Vista",
		label: "Pannello: terminale",
		key: "Ctrl+4",
		keywords: "term terminale shell",
		enabled: repoReady,
		run: () => setTab("term"),
	},
	{
		id: "layout",
		group: "Vista",
		label:
			state.diffLayout === "unified"
				? "Diff affiancato"
				: "Diff a una colonna",
		keywords: "layout diff affiancato unified split",
		enabled: repoReady,
		run: () =>
			setDiffLayout(state.diffLayout === "unified" ? "split" : "unified"),
	},
	{
		id: "collapse",
		group: "Vista",
		label: "Riduci o espandi il pannello",
		keywords: "panel pannello collapse",
		enabled: repoReady,
		run: () => {
			bottomCollapsed = !bottomCollapsed;
			applyBottomLayout();
			saveBottomLayout();
		},
	},
	{
		id: "detach",
		group: "Vista",
		label: "Apri il pannello in una finestra",
		keywords: "detach finestra panel",
		enabled: repoReady,
		run: () =>
			void api.detachPanel().catch((error: Error) => {
				toast(`Finestra del pannello: ${readableError(error)}`);
			}),
	},
	{
		id: "shortcuts",
		group: "Vista",
		label: "Scorciatoie da tastiera",
		key: "?",
		keywords: "keys scorciatoie tasti",
		run: () => ui.keysDialog.showModal(),
	},
];

let paletteMatches: PaletteCommand[] = [];
let paletteActive = 0;

function openPalette(): void {
	ui.paletteInput.value = "";
	renderPalette("");
	if (!ui.paletteDialog.open) ui.paletteDialog.showModal();
	ui.paletteInput.focus();
}

function renderPalette(query: string): void {
	const pool = COMMANDS.filter(
		(command) => !command.enabled || command.enabled()
	);
	paletteMatches = rankPalette(
		pool.map((command) => ({
			command,
			// si cerca anche nell'italiano di partenza: chi lavora in inglese può
			// scrivere una parola del comando e trovarlo lo stesso
			text: `${t(command.label)} ${command.label} ${
				command.keywords ?? ""
			}`,
		})),
		query
	).map((item) => item.command);
	paletteActive = 0;

	clear(ui.paletteList);
	if (paletteMatches.length === 0) {
		ui.paletteList.appendChild(
			el("li", "palette-empty", t("Nessun comando corrisponde."))
		);
		return;
	}
	// Un'intestazione solo quando il gruppo cambia: ripetuto su ogni riga, il gruppo
	// diventa più rumoroso del comando.
	let lastGroup: string | null = null;
	paletteMatches.forEach((command, index) => {
		if (command.group !== lastGroup) {
			lastGroup = command.group;
			ui.paletteList.appendChild(
				el("li", "palette-section", t(command.group))
			);
		}
		const item = el("li");
		item.dataset.command = command.id;
		item.appendChild(el("span", "palette-label", t(command.label)));
		if (command.key) item.appendChild(el("kbd", undefined, command.key));
		if (index === 0) item.classList.add("is-active");
		item.addEventListener("click", () => void runPaletteCommand(command));
		ui.paletteList.appendChild(item);
	});
}

function movePaletteSelection(step: number): void {
	if (paletteMatches.length === 0) return;
	paletteActive =
		(paletteActive + step + paletteMatches.length) % paletteMatches.length;
	const items = [
		...ui.paletteList.querySelectorAll<HTMLElement>("li[data-command]"),
	];
	items.forEach((item, index) =>
		item.classList.toggle("is-active", index === paletteActive)
	);
	items[paletteActive]?.scrollIntoView({ block: "nearest" });
}

/** Il dialogo si chiude prima di eseguire: un comando può aprirne un altro. */
async function runPaletteCommand(command: PaletteCommand): Promise<void> {
	if (ui.paletteDialog.open) ui.paletteDialog.close();
	command.run();
}

ui.paletteInput.addEventListener("input", () =>
	renderPalette(ui.paletteInput.value)
);
ui.paletteInput.addEventListener("keydown", (event) => {
	if (event.key === "ArrowDown") {
		event.preventDefault();
		movePaletteSelection(1);
	} else if (event.key === "ArrowUp") {
		event.preventDefault();
		movePaletteSelection(-1);
	} else if (event.key === "Enter") {
		event.preventDefault();
		const command = paletteMatches[paletteActive];
		if (command) void runPaletteCommand(command);
	}
});

document.addEventListener("keydown", (event) => {
	const typing =
		event.target instanceof HTMLInputElement ||
		event.target instanceof HTMLTextAreaElement;

	const ctrl = event.ctrlKey || event.metaKey;
	if (ctrl && event.key.toLowerCase() === "k") {
		event.preventDefault();
		// la finestra dei dettagli non ha comandi propri: la palette vive solo nella principale
		if (panelMode) return;
		if (ui.paletteDialog.open) ui.paletteDialog.close();
		else openPalette();
		return;
	}
	if (ctrl && event.key.toLowerCase() === "o") {
		event.preventDefault();
		void openRepository();
		return;
	}
	if (ctrl && event.key.toLowerCase() === "f") {
		event.preventDefault();
		ui.searchInput.focus();
		ui.searchInput.select();
		return;
	}
	if (ctrl && ["1", "2", "3", "4"].includes(event.key)) {
		event.preventDefault();
		setTab(
			(
				{
					"1": "commit",
					"2": "tree",
					"3": "blame",
					"4": "term",
				} as const
			)[event.key as "1" | "2" | "3" | "4"]
		);
		return;
	}
	if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "r") {
		event.preventDefault();
		void refresh();
		return;
	}
	if (event.key === "F5") {
		event.preventDefault();
		void refresh();
		return;
	}
	if (event.key === "Escape") closeMenu();
	if (typing) return;
	if (event.key === "?" && !panelMode) {
		event.preventDefault();
		ui.keysDialog.showModal();
		return;
	}
	if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "z") {
		event.preventDefault();
		void doUndo();
		return;
	}
	if (event.key === "ArrowDown") {
		event.preventDefault();
		logView.step(1);
	} else if (event.key === "ArrowUp") {
		event.preventDefault();
		logView.step(-1);
	}
});

/** Aggiornamento spontaneo: il main ha riletto il repository dopo un cambiamento sul disco. */
api.onChanged((event) => {
	if (event.kind === "error") {
		if (!panelMode) toast(`Aggiornamento automatico: ${event.message}`);
		return;
	}
	const session = sessions.get(event.snapshot.info.root);
	if (!session) {
		// il pannello segue la finestra principale quando cambia repository
		if (panelMode) void followPanelRepo(event.snapshot.info.root, null);
		return;
	}
	if (session !== state) {
		// aggiornamento di una scheda non attiva: si conserva per il cambio scheda
		session.snapshot = event.snapshot;
		session.commits = event.snapshot.commits;
		session.hasMore = event.snapshot.hasMore;
		session.loadingMore = false;
		renderRepoTabs();
		return;
	}
	const previous = state.snapshot?.commits[0]?.sha ?? null;
	applySnapshot(event.snapshot);
	const next = event.snapshot.commits[0]?.sha ?? null;
	if (previous && next !== previous)
		toast("Repository aggiornato da fuori.", "ok");
});

void boot();
