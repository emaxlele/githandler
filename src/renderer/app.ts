import type { HunkSelection, PatchMode } from "../core/patch.ts";
import { buildPatch } from "../core/patch.ts";
import { layoutGraph } from "../core/graph.ts";
import { localNameForRemote } from "../core/ops.ts";
import {
	API_TOOLS,
	MEBIBYTE,
	TRASH_DEFAULTS,
	type ApiMode,
	type ApiTool,
	type Settings,
	type TrashUsage,
} from "../core/settings.ts";
import type {
	Commit,
	CommitDetails,
	CommitFile,
	DiffFile,
	RefInfo,
	Snapshot,
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
import { describeRun, type WorkflowRun } from "../core/actions.ts";
import { deviceFlow, tokenPageUrl } from "../core/oauth.ts";
import type {
	AccountInput,
	AccountsInfo,
	GitApi,
	PanelState,
	PanelStateInput,
} from "../shared/api.ts";
import { BlameView } from "./blame-view.ts";
import { pickKey, renderDiff, type DiffLayout } from "./diff-view.ts";
import { avatarColor, byId, clear, el, initials, shortDate } from "./dom.ts";
import { LogView } from "./log-view.ts";

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

type Tab = "changes" | "commit" | "tree" | "blame" | "term";

/** La barra laterale decide cosa occupa l'area principale. */
type Side = "changes" | "commits";

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
	commitPath: string | null;
	/** file selezionato nella scheda File Tree */
	treePath: string | null;
	/** cartelle chiuse nell'albero; vuoto = tutto aperto */
	treeCollapsed: Set<string>;
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
		commitPath: null,
		treePath: null,
		treeCollapsed: new Set(),
		changePath: null,
		changeStaged: false,
		changeDiff: null,
		picked: new Set(),
		diffLayout: savedLayout(),
		tab: "commit",
		searchQuery: null,
		side: "commits",
	};
}

/** Le sessioni aperte, per root; `state` è quella attiva (le funzioni la leggono al momento). */
const sessions = new Map<string, State>();
let state: State = emptyState();

/** Il formato del diff è una preferenza dell'utente: si ricorda fra un avvio e l'altro. */
function savedLayout(): DiffLayout {
	try {
		return localStorage.getItem("githandler.diffLayout") === "split"
			? "split"
			: "unified";
	} catch {
		return "unified";
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
	accountOauthClientHelp: byId<HTMLButtonElement>("account-oauth-client-help"),
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
	tabChanges: byId<HTMLButtonElement>("tab-changes"),
	tabCommit: byId<HTMLButtonElement>("tab-commit"),
	tabTree: byId<HTMLButtonElement>("tab-tree"),
	tabBlame: byId<HTMLButtonElement>("tab-blame"),
	tabTerm: byId<HTMLButtonElement>("tab-term"),
	main: byId("main"),
	changesMain: byId("changes-main"),
	panes: byId("panes"),
	panelChanges: byId("panel-changes"),
	panelTerm: byId("panel-term"),
	panelCommit: byId("panel-commit"),
	panelTree: byId("panel-tree"),
	panelBlame: byId("panel-blame"),
	treeList: byId("tree-list"),
	treeDiff: byId("tree-diff"),
	treeTitle: byId("tree-title"),
	btnTreeToggle: byId<HTMLButtonElement>("btn-tree-toggle"),
	blamePath: byId("blame-path"),
	changesCount: byId("changes-count"),
	changesListStaged: byId("changes-list-staged"),
	changesListUnstaged: byId("changes-list-unstaged"),
	changesDiff: byId("changes-diff"),
	commitFilesList: byId("commit-files"),
	commitDiff: byId("commit-diff"),
	commitMeta: byId("commit-meta"),
	commitMessage: byId<HTMLTextAreaElement>("commit-message"),
	commitAll: byId<HTMLInputElement>("commit-all"),
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
	stashDialog: byId<HTMLDialogElement>("stash-dialog"),
	stashMessage: byId<HTMLInputElement>("stash-message"),
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
	ui.toast.textContent = message;
	ui.toast.classList.remove("hidden", "is-ok");
	if (kind === "ok") ui.toast.classList.add("is-ok");
	window.clearTimeout(toastTimer);
	toastTimer = window.setTimeout(
		() => ui.toast.classList.add("hidden"),
		5000
	);
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
		toast(`${label}: ${readableError(error)}`);
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
		toast(`${label}: ${readableError(error)}`);
		try {
			applySnapshot(await api.refresh());
		} catch (refreshError) {
			console.warn("stato non rileggibile dopo l'errore:", refreshError);
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
		side: state.side,
		selectedCommit: state.selectedCommit,
		commitPath: state.commitPath,
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
		await followPanelRepo(payload.root);
		if (payload.root !== state.root) return;
	}

	const token = ++panelApplyToken;
	if (payload.selectedCommit && payload.selectedCommit !== state.selectedCommit) {
		await selectCommit(payload.selectedCommit);
		if (token !== panelApplyToken) return;
	}
	if (payload.commitPath && payload.commitPath !== state.commitPath) {
		await selectCommitFile(payload.commitPath);
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

/** Il pannello segue il repository attivo della finestra principale, senza chiedere niente. */
async function followPanelRepo(root: string): Promise<void> {
	try {
		await api.use(root);
		const snapshot = await api.refresh();
		const session = emptyState(root);
		session.snapshot = snapshot;
		session.commits = snapshot.commits;
		session.hasMore = snapshot.hasMore;
		sessions.clear();
		sessions.set(root, session);
		state = session;
		renderSession();
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

	state.snapshot = snapshot;
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
	ui.repoName.textContent = snapshot?.info.name ?? "nessun repository";
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
	ui.repoOperation.textContent = `${label} · annulla`;
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
		chip.title = "Sto leggendo il remoto…";
		return;
	}
	chip.disabled = false;
	const account = cached.account;
	chip.textContent = account ? accountLabel(account) : "nessun account";
	chip.classList.toggle("is-guess", cached.reason === "first");
	chip.title = account
		? `${accountLabel(account)} — ${accountReasonText(cached)}. Clic per cambiare.`
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
		close.title = "Chiudi la scheda";
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
	renderCommitFiles();
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
	ui.commitCount.textContent = state.hasMore
		? `${total}+ commit — scorri per caricarne altri`
		: `${total} commit`;
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
	const text = value.toLocaleString("it-IT", { maximumFractionDigits: 1 });
	return `${text} ${units[unit]}`;
}

/**
 * Le scelte «account per repository» non si modificano da questa finestra: si riportano com'erano,
 * altrimenti salvare le impostazioni le cancellerebbe.
 */
let savedRepoAccounts: Record<string, string> = {};

function fillSettings(settings: Settings): void {
	savedRepoAccounts = settings.repoAccounts;
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
				? "Nessuna copia conservata."
				: `${usage.entries} ${
						usage.entries === 1 ? "copia" : "copie"
				  } · ${formatBytes(usage.bytes)} su ${formatBytes(
						quotaBytes
				  )}`;
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
		// senza selezione il pannello Commit resterebbe vuoto all'apertura
		if (!state.selectedCommit && state.commits[0]) {
			const first = state.commits[0].sha;
			if (state.tab === "commit") void selectCommit(first);
			else logView.select(first);
		}
		return;
	}

	const commits = await guard("Ricerca", () => api.search(query));
	if (token !== logRequest || !commits) return;
	logView.setEmptyMessage(
		commits.length === 0 ? `Nessun commit per «${query}».` : ""
	);
	logView.setData(commits, layoutGraph(commits as Commit[]));
	ui.searchInfo.textContent =
		commits.length === 1 ? "1 risultato" : `${commits.length} risultati`;
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
				kind === "tag" ? "nessun tag" : "—"
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
			item.title = `Vai al commit di ${ref.short} · tasto destro per le operazioni`;
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
	ui.changesCount.textContent = String(entries.length);

	const staged = entries.filter((entry) => entry.index !== ".");
	const unstaged = entries.filter(
		(entry) => entry.kind === "untracked" || entry.worktree !== "."
	);

	fillChangeList(ui.changesListStaged, staged, true);
	fillChangeList(ui.changesListUnstaged, unstaged, false);
	renderTree(snapshot);
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

		const acts = el("span", "acts");
		const toggle = el("button", "icon-btn", staged ? "−" : "+");
		toggle.dataset.act = staged ? "unstage" : "stage";
		toggle.title = staged ? "Togli dallo stage" : "Aggiungi allo stage";
		acts.appendChild(toggle);

		const discard = el("button", "icon-btn", "×");
		discard.dataset.act = "discard";
		discard.title = "Scarta le modifiche";
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

function renderTree(snapshot: Snapshot): void {
	const files = treeFiles(snapshot);
	ui.treeTitle.textContent = state.selectedCommit
		? "File tree · commit"
		: "File tree · working tree";
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
			fragment.appendChild(row);

			if (child.dir && !collapsed) walk(child, depth + 1);
		}
	};
	walk(buildTree(files), 0);
	ui.treeList.appendChild(fragment);
}

function renderCommitMeta(): void {
	clear(ui.commitMeta);
	const commit = state.commits.find((c) => c.sha === state.selectedCommit);
	if (!commit) {
		ui.commitMeta.appendChild(
			el("div", "meta-empty", "Seleziona un commit dalla storia.")
		);
		return;
	}

	const details = state.commitDetails;
	const author = details?.author;
	const committer = details?.committer;

	const person = (
		label: string,
		name: string,
		email: string,
		date: string | null
	): HTMLElement => {
		const wrap = el("div");
		wrap.appendChild(el("div", "meta-label", label));
		const line = el("div", "meta-person");
		const avatar = el("span", "avatar", initials(name));
		avatar.style.background = avatarColor(name);
		const who = el("div", "who");
		who.appendChild(el("strong", undefined, name));
		if (date) {
			const when = new Date(date);
			who.appendChild(
				el(
					"span",
					undefined,
					Number.isNaN(when.getTime())
						? date
						: shortDate(when.getTime())
				)
			);
		}
		who.appendChild(el("span", undefined, email));
		line.append(avatar, who);
		wrap.appendChild(line);
		return wrap;
	};

	const grid = el("div", "meta-grid");
	grid.appendChild(
		person(
			"Author",
			author?.name ?? commit.author,
			author?.email ?? commit.email,
			author?.date ?? new Date(commit.timestamp * 1000).toISOString()
		)
	);
	if (committer) {
		grid.appendChild(
			person("Committer", committer.name, committer.email, committer.date)
		);
	}
	ui.commitMeta.appendChild(grid);

	const ids = el("div", "meta-ids");
	const idLine = (key: string, value: string): HTMLElement => {
		const line = el("div", "line");
		line.appendChild(el("span", "key", key));
		const text = el("span", "value", value);
		text.title = value;
		line.appendChild(text);
		return line;
	};
	ids.appendChild(idLine("SHA", commit.sha));
	ids.appendChild(
		idLine(
			"Parents",
			(details?.parents ?? commit.parents)
				.map((p) => p.slice(0, 8))
				.join(" ") || "—"
		)
	);
	ui.commitMeta.appendChild(ids);

	const message = el("div", "meta-message");
	message.appendChild(
		el("div", "subject", details?.subject ?? commit.subject)
	);
	if (details?.body) message.appendChild(el("div", "body", details.body));
	ui.commitMeta.appendChild(message);
}

function renderCommitFiles(): void {
	clear(ui.commitFilesList);
	renderCommitMeta();

	if (state.commitFiles.length === 0) {
		ui.commitFilesList.appendChild(el("li", "muted", "Nessun file."));
		return;
	}

	for (const file of state.commitFiles) {
		const item = el("li");
		item.dataset.path = file.path;
		if (file.path === state.commitPath) item.classList.add("is-selected");
		const code = file.status === "?" ? "?" : file.status;
		item.appendChild(
			el(
				"span",
				`st ${code === "?" ? "st-a" : `st-${code.toLowerCase()}`}`,
				code
			)
		);
		item.appendChild(el("span", "name", file.path));
		ui.commitFilesList.appendChild(item);
	}
}

// ── azioni ───────────────────────────────────────────────────────────────────

async function boot(): Promise<void> {
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
	// all'avvio non si apre nessun dialog: senza `--repo` si parte dal benvenuto
	await openRepository(undefined, false);
	renderSession();
	void loadBaseFolder();
}

async function refresh(): Promise<void> {
	const snapshot = await guard("Aggiornamento", () => api.refresh());
	if (snapshot) applySnapshot(snapshot);
}

async function selectCommit(sha: string): Promise<void> {
	const root = state.root;
	state.selectedCommit = sha;
	state.commitPath = null;
	state.commitDetails = null;
	state.treePath = null;
	setTab("commit");
	logView.select(sha);

	const [details, files] = await Promise.all([
		guard("Dettaglio commit", () => api.commitDetails(sha)),
		guard("Commit", () => api.commitFiles(sha)),
	]);
	if (!files || !isActive(root)) return;
	state.commitDetails = details;
	state.commitFiles = files;
	renderCommitFiles();
	if (state.snapshot) renderTree(state.snapshot);

	const first = files[0];
	if (first) await selectCommitFile(first.path);
	else renderDiff(ui.commitDiff, null, "Commit senza modifiche ai file.");
	publishPanel();
}

async function selectCommitFile(path: string): Promise<void> {
	const sha = state.selectedCommit;
	const root = state.root;
	if (!sha) return;
	state.commitPath = path;
	state.treePath = path;
	renderCommitFiles();
	if (state.snapshot) renderTree(state.snapshot);
	const file = await guard("Diff", () => api.commitPatch(sha, path));
	if (file && isActive(root)) {
		renderDiff(ui.commitDiff, file, "Nessuna differenza.", {
			layout: state.diffLayout,
		});
	}
	publishPanel();
}

/** Diff della scheda File Tree: stesso backend, riquadro diverso. */
async function selectTreeFile(path: string): Promise<void> {
	const root = state.root;
	state.treePath = path;
	if (state.snapshot) renderTree(state.snapshot);

	if (state.selectedCommit) {
		const sha = state.selectedCommit;
		state.commitPath = path;
		renderCommitFiles();
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

/** Ricarica il diff aperto dopo un'operazione: il contenuto è cambiato sotto. */
async function reloadOpenDiff(): Promise<void> {
	if (state.tab === "commit" && state.selectedCommit && state.commitPath) {
		await selectCommitFile(state.commitPath);
	} else if (state.changePath) {
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

/** Un solo pannello inferiore attivo alla volta. */
function syncPanels(): void {
	const panels: Array<[Tab, HTMLElement, HTMLElement]> = [
		["changes", ui.tabChanges, ui.panelChanges],
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

	if (side === "changes") {
		if (ui.panelChanges.parentElement !== ui.changesMain) {
			ui.changesMain.appendChild(ui.panelChanges);
		}
		// il pannello inferiore è nascosto: resta attivo quello scelto per quando si torna
		ui.panelChanges.classList.add("in-main", "is-active");
	} else {
		if (ui.panelChanges.parentElement !== ui.panes) {
			ui.panes.appendChild(ui.panelChanges);
		}
		ui.panelChanges.classList.remove("in-main");
		syncPanels();
	}
	publishPanel();
}

function setTab(tab: Tab): void {
	if (state.side === "changes" && tab !== "changes") {
		// dalla modalità modifiche si torna alla storia, con il pannello scelto
		state.tab = tab;
		setSide("commits");
	} else {
		state.tab = tab;
		syncPanels();
	}
	if (tab === "blame") void loadBlame();
	if (tab === "tree" && state.snapshot) renderTree(state.snapshot);
	if (tab === "term") renderTerminal();
	publishPanel();
}

/** Blame del file aperto: quello delle Modifiche, altrimenti quello del commit selezionato. */
async function loadBlame(): Promise<void> {
	const path = state.changePath ?? state.commitPath;
	ui.blamePath.textContent = path ?? "";
	if (!path) {
		blameView.setData(
			null,
			"Seleziona un file da Modifiche o da un commit."
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
	if (!window.confirm(message)) return;
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

async function doCommit(): Promise<void> {
	const message = ui.commitMessage.value.trim();
	if (!message) {
		toast("Scrivi un messaggio di commit.");
		return;
	}
	const snapshot = await guard("Commit", () =>
		api.commit(message, ui.commitAll.checked)
	);
	if (!snapshot) return;
	ui.commitMessage.value = "";
	applySnapshot(snapshot);
	toast("Commit creato.", "ok");
}

async function checkout(branch: string): Promise<void> {
	const snapshot = await guard(`Checkout ${branch}`, () =>
		api.checkout(branch)
	);
	if (snapshot) applySnapshot(snapshot);
}

async function fetchAll(): Promise<void> {
	toast("Fetch in corso…", "ok");
	const snapshot = await guard("Fetch", () => api.fetch());
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
		const button = el("button", "ctx-item", entry.label);
		button.type = "button";
		if (entry.hint) button.title = entry.hint;
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
	if (!window.confirm(`Unire ${branch} nel ramo attuale?`)) return;
	const snapshot = await guardRepo(`Merge di ${branch}`, () =>
		api.merge(branch)
	);
	if (!snapshot) return;
	applySnapshot(snapshot);
	toast("Merge completato.", "ok");
}

async function rebaseOnto(branch: string): Promise<void> {
	if (
		!window.confirm(
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
	if (!window.confirm(`Eliminare il ramo locale ${branch}?`)) return;
	try {
		const snapshot = await api.deleteBranch(branch, false);
		applySnapshot(snapshot);
		return;
	} catch (error) {
		// Git protegge i rami non uniti: cancellarli è una scelta esplicita
		if (
			!window.confirm(
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
		!window.confirm(
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
	if (!window.confirm(`Applicare ${sha.slice(0, 8)} sul ramo attuale?`))
		return;
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
	if (!window.confirm(`Unire il commit ${short} nel ramo attuale?`)) return;
	const snapshot = await guardRepo(`Merge di ${short}`, () => api.merge(sha));
	if (!snapshot) return;
	applySnapshot(snapshot);
	toast("Merge completato.", "ok");
}

async function rebaseCommit(sha: string): Promise<void> {
	const short = sha.slice(0, 8);
	if (
		!window.confirm(
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
	if (
		!window.confirm(
			`Reset ${mode} di ${branch} a ${short}?\n\n${detail}`
		)
	)
		return;
	const snapshot = await guard(`Reset ${mode}`, () => api.reset(sha, mode));
	if (!snapshot) return;
	applySnapshot(snapshot);
	toast(`Reset ${mode} completato.`, "ok");
}

// ── remoto, stash, submodule ─────────────────────────────────────────────────

async function pullChanges(): Promise<void> {
	toast("Pull in corso…", "ok");
	const snapshot = await guard("Pull", () => api.pull());
	if (!snapshot) return;
	applySnapshot(snapshot);
	toast("Pull completato.", "ok");
}

async function pushChanges(): Promise<void> {
	toast("Push in corso…", "ok");
	const snapshot = await guard("Push", () => api.push());
	if (!snapshot) return;
	applySnapshot(snapshot);
	toast("Push completato.", "ok");
}

/** Merge, rebase o cherry-pick sospeso: si torna allo stato di prima. */
async function abortOperation(): Promise<void> {
	const operation = state.snapshot?.info.operation;
	if (!operation) return;
	if (
		!window.confirm(
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

let inputResolve: ((value: string | null) => void) | null = null;

/** Sostituto di `window.prompt`, che in Electron non esiste. */
function askInput(options: {
	title: string;
	label: string;
	value?: string;
}): Promise<string | null> {
	if (ui.inputDialog.open) settleInput(null);
	ui.inputTitle.textContent = options.title;
	ui.inputLabel.textContent = options.label;
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

async function openStash(): Promise<void> {
	ui.stashMessage.value = "";
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
	if (action === "drop" && !window.confirm(`Eliminare stash@{${index}}?`))
		return;
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
	ui.termInput.placeholder = busy
		? "comando in corso… Interrompi per fermarlo"
		: "comando nella cartella del repository";
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
		return;
	}
	const next = sessions.values().next().value as State | undefined;
	if (!next) {
		// nessun repository aperto: si torna al benvenuto, non al dialog di sistema
		state = emptyState();
		renderSession();
		return;
	}
	state = next;
	try {
		await api.use(next.root);
	} catch (error) {
		toast(`Cambio repository: ${readableError(error)}`);
	}
	renderSession();
}

// ── eventi delle nuove zone ──────────────────────────────────────────────────

ui.btnPull.addEventListener("click", () => void pullChanges());
ui.btnPush.addEventListener("click", () => void pushChanges());
ui.btnStash.addEventListener("click", () => void openStash());
ui.btnSubmodule.addEventListener("click", () => void openSubmodules());
ui.repoOperation.addEventListener("click", () => void abortOperation());

ui.stashClose.addEventListener("click", () => ui.stashDialog.close());
ui.btnStashSave.addEventListener("click", () => {
	void (async () => {
		const snapshot = await guard("Stash", () =>
			api.stashSave(ui.stashMessage.value)
		);
		if (!snapshot) return;
		ui.stashMessage.value = "";
		applySnapshot(snapshot);
		await loadStashList();
		toast("Modifiche salvate nello stash.", "ok");
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
	// la finestra appena aperta deve ricevere subito cosa stiamo guardando
	if (detached) publishPanel();
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
		toast("Nome del repository non valido: niente barre o caratteri di controllo.");
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
		toast("Nome ed email dell'identità vanno insieme, oppure tutti e due vuoti.");
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
	const parent = await ensureParent(ui.cloneParent, "Dove clonare il repository");
	if (!parent) return;

	ui.cloneDialog.close();
	toast("Clone in corso…", "ok");
	const snapshot = await guard("Clone", () =>
		api.cloneRepo(url, joinPath(parent, name))
	);
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
	ui.accountOauthStatus.textContent = "Cerco un token già presente sulla macchina…";
	try {
		const result = await api.claimAccount(input);
		ui.accountOauthStatus.textContent =
			result.source === "github-cli"
				? "Token trovato in GitHub CLI."
				: "Token trovato nel credential helper di Git.";
		await refreshAccountsAfterOauth(
			result.accountId,
			`Account collegato senza Client ID (${result.source === "github-cli" ? "GitHub CLI" : "credential helper"}).`
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
		accountIdValue && info.accounts.some((item) => item.id === accountIdValue)
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
		const token =
			accountsCache?.tokens.includes(account.id) ? " · token" : "";
		item.appendChild(
			el(
				"span",
				"account-sub",
				`${providerInfo(account.provider).label} · ${account.host}${token}`
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
	if (!selectedAccount && info.accounts[0]) selectedAccount = info.accounts[0].id;
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
		latest = (await guard("Account", () => api.removeAccount(previous))) ?? latest;
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
		!window.confirm(
			`Rimuovere l'account ${accountLabel(account)}? Il token resta nel credential helper di Git, se ne hai uno.`
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
		const repos = await guard("Repository", () => api.accountRepos(id, page));
		if (!repos) {
			ui.accountStatus.textContent = "Elenco non disponibile: leggi il messaggio.";
			ui.accountStatus.classList.add("is-error");
			return;
		}
		if (page === 1) {
			remoteReposCache = repos;
		} else {
			const known = new Set(remoteReposCache.map((repo) => repo.fullName));
			remoteReposCache = [
				...remoteReposCache,
				...repos.filter((repo) => !known.has(repo.fullName)),
			];
		}
		remoteReposPage = page;
		renderRemoteRepos();
		const full = repos.length >= (account ? reposPageSize(account.provider) : 100);
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
		const button = el("button", "btn btn-small", "Clona") as HTMLButtonElement;
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
			api.chooseFolder("Dove clonare il repository", baseFolder || undefined)
		);
		if (!chosen) return;
		ui.accountDest.value = chosen;
		parent = chosen;
	}
	const dest = joinPath(parent, repo.name);
	if (!window.confirm(`Clonare ${repo.fullName} in ${dest}?`)) return;
	ui.accountDialog.close();
	toast("Clone in corso…", "ok");
	const snapshot = await guard("Clone", () => api.cloneRepo(repo.cloneUrl, dest));
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
	const verb = mode === "merge" ? "Unire" : "Rebasare il ramo attuale su";
	if (
		!window.confirm(
			`${verb} ${parent.fullName}/${parent.defaultBranch}? Le modifiche non committate possono fermare l'operazione; niente viene forzato.`
		)
	)
		return;
	const result = await guardRepo("Sincronizza fork", () =>
		api.syncFork(mode)
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
		ui.fileStatus.textContent = "Elenco non disponibile: leggi il messaggio.";
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
			? "L'elenco è troncato dal repository."
			: "";
		return;
	}
	const shown = matches.slice(0, FILE_ROWS);
	for (const path of shown) {
		const item = el("li");
		item.dataset.path = path;
		item.title = "Doppio clic per aprirlo dal disco; tasto destro per le altre azioni.";
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
	ui.fileStatus.textContent = [
		`${matches.length} file`,
		more > 0 ? `mostrati i primi ${shown.length}` : "",
		fileListTruncated ? "elenco troncato dal repository" : "",
	]
		.filter(Boolean)
		.join(" · ");
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
			cancel.addEventListener("click", () =>
				void workflowAction(run.id, "cancel")
			);
			actions.appendChild(cancel);
		} else {
			const rerun = el(
				"button",
				"btn btn-small",
				"Ri-esegui"
			) as HTMLButtonElement;
			rerun.type = "button";
			rerun.title = "Avvia di nuovo questo workflow con gli stessi parametri.";
			rerun.addEventListener("click", () =>
				void workflowAction(run.id, "rerun")
			);
			actions.appendChild(rerun);
		}
		if (run.url) {
			const open = el("button", "btn btn-small", "Apri") as HTMLButtonElement;
			open.type = "button";
			open.title = "Apre l'esecuzione su GitHub nel browser.";
			open.addEventListener("click", () =>
				void guard("Browser", () => api.openExternal(run.url))
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
	action: "rerun" | "cancel"
): Promise<void> {
	if (action === "cancel" && !window.confirm("Annullare questa esecuzione?"))
		return;
	const done = await guard("Actions", () =>
		api.workflowRunAction(id, action)
	);
	if (done === null) return;
	toast(
		action === "cancel" ? "Esecuzione annullata." : "Esecuzione ri-avviata.",
		"ok"
	);
	await loadWorkflowRuns();
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
			api.chooseFolder("Dove creare il repository", baseFolder || undefined)
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
			api.chooseFolder("Dove clonare il repository", baseFolder || undefined)
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
			api.chooseFolder("Dove clonare il repository", baseFolder || undefined)
		);
		if (chosen) ui.accountDest.value = chosen;
	})();
});
// dentro un form che non deve inviare nulla al server
ui.accountForm.addEventListener("submit", (event) => event.preventDefault());

ui.btnChooseBase.addEventListener("click", () => {
	void (async () => {
		const chosen = await guard("Cartella", () =>
			api.chooseFolder("Cartella di base", ui.settingBase.value.trim() || undefined)
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
	try {
		localStorage.setItem("githandler.diffLayout", layout);
	} catch (error) {
		console.warn("formato del diff non salvato:", error);
	}
	updateDiffButtons();
	if (state.changePath && state.changeDiff) renderChangeDiff();
	if (state.tab === "commit" && state.commitPath) {
		void selectCommitFile(state.commitPath);
	}
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
// la preferenza salvata deve essere visibile già al primo avvio
updateDiffButtons();
ui.btnFetch.addEventListener("click", () => void fetchAll());
ui.btnSettings.addEventListener("click", () => void openSettings());

ui.settingsCancel.addEventListener("click", () => ui.settingsDialog.close());
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
		ui.settingsDialog.close();
		toast("Impostazioni salvate.", "ok");
	})();
});

// Il tab del pannello mostra le modifiche dentro la finestra; la voce della barra laterale le porta
// a tutta area: sono due modi diversi, e devono restare diversi.
ui.tabChanges.addEventListener("click", () => setTab("changes"));
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

ui.treeList.addEventListener("click", (event) => {
	const target = (event.target as HTMLElement).closest<HTMLElement>(
		".tree-node"
	);
	const path = target?.dataset.path;
	if (!path || !target) return;
	if (target.dataset.dir === "true") {
		if (state.treeCollapsed.has(path)) state.treeCollapsed.delete(path);
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

ui.commitFilesList.addEventListener("contextmenu", (event) => {
	const path = (event.target as HTMLElement).closest<HTMLElement>("li")
		?.dataset.path;
	if (!path) return;
	event.preventDefault();
	openMenu(event.clientX, event.clientY, fileMenuEntries(path));
});

ui.commitFilesList.addEventListener("click", (event) => {
	const path = (event.target as HTMLElement).closest<HTMLElement>("li")
		?.dataset.path;
	if (path) void selectCommitFile(path);
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

document.addEventListener("keydown", (event) => {
	const typing =
		event.target instanceof HTMLInputElement ||
		event.target instanceof HTMLTextAreaElement;

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
		if (panelMode) void followPanelRepo(event.snapshot.info.root);
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
