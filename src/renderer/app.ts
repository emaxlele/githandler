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
import type { GitApi } from "../shared/api.ts";
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
	repoSync: byId("repo-sync"),
	btnOpen: byId<HTMLButtonElement>("btn-open"),
	btnNewTab: byId<HTMLButtonElement>("btn-new-tab"),
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
	toast: byId("toast"),
};

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
	if (state.tab === "blame") void loadBlame();
}

/** Nome, ramo, sincronizzazione e operazione sospesa del repository attivo. */
function renderHeader(snapshot: Snapshot | null): void {
	ui.repoName.textContent = snapshot?.info.name ?? "nessun repository";
	ui.sideRepo.textContent = snapshot?.info.name ?? "—";
	ui.repoBranch.textContent = snapshot?.info.branch ?? "—";
	if (!snapshot) {
		ui.repoSync.classList.add("hidden");
		ui.btnPull.disabled = true;
		ui.btnPush.disabled = true;
		renderOperation(null);
		return;
	}
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

function fillSettings(settings: Settings): void {
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
	await openRepository();
	renderSession();
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
	action: () => void;
	danger?: boolean;
	disabled?: boolean;
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
		if (entry.danger) button.classList.add("is-danger");
		if (entry.disabled) {
			button.disabled = true;
		} else {
			button.addEventListener("click", () => {
				closeMenu();
				entry.action();
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
		{ label: "Vai al commit", action: () => void revealRef(ref.sha) },
		"separator",
	];

	if (ref.kind === "local") {
		entries.push(
			{
				label: ref.current
					? `${ref.short} è il ramo attuale`
					: `Checkout di ${ref.short}`,
				disabled: ref.current,
				action: () => void checkout(ref.short),
			},
			{
				label: `Merge di ${ref.short} nel ramo attuale`,
				disabled: ref.current,
				action: () => void mergeBranch(ref.short),
			},
			{
				label: `Rebase del ramo attuale su ${ref.short}`,
				disabled: ref.current,
				action: () => void rebaseOnto(ref.short),
			},
			"separator",
			{ label: "Rinomina…", action: () => void renameBranch(ref.short) },
			{
				label: `Elimina ${ref.short}`,
				danger: true,
				disabled: ref.current,
				action: () => void deleteBranch(ref.short),
			}
		);
	} else if (ref.kind === "remote") {
		const local = localBranchName(ref.short);
		entries.push({
			label: `Crea ${local} e passa a quel ramo`,
			action: () => void startTracking(ref.short, local),
		});
	}

	entries.push(
		"separator",
		{ label: "Copia nome", action: () => void copyText(ref.short) },
		{ label: "Copia SHA", action: () => void copyText(ref.sha) }
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
	const snapshot = await guard(`Rebase su ${branch}`, () =>
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

async function cherryPickCommit(sha: string): Promise<void> {
	if (!window.confirm(`Applicare ${sha.slice(0, 8)} sul ramo attuale?`))
		return;
	const snapshot = await guardRepo("Cherry-pick", () => api.cherryPick(sha));
	if (!snapshot) return;
	applySnapshot(snapshot);
	toast("Cherry-pick completato.", "ok");
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
async function openRepository(path?: string): Promise<void> {
	const snapshot = await guard("Apertura", () => api.open(path));
	if (!snapshot) return;
	const root = snapshot.info.root;
	let session = sessions.get(root);
	if (!session) {
		session = emptyState(root);
		sessions.set(root, session);
	}
	state = session;
	applySnapshot(snapshot);
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
	if (sessions.size <= 1) {
		toast("L'ultimo repository aperto non si chiude.");
		return;
	}
	sessions.delete(root);
	if (state.root !== root) {
		renderRepoTabs();
		return;
	}
	const next = sessions.values().next().value as State;
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

ui.log.addEventListener("contextmenu", (event) => {
	const row = (event.target as HTMLElement).closest<HTMLElement>(".row");
	const sha = row?.dataset.sha;
	if (!sha) return;
	event.preventDefault();
	const commit = state.commits.find((item) => item.sha === sha);
	const entries: Array<MenuEntry | "separator"> = [
		{
			label: "Vai al commit",
			action: () => {
				setTab("commit");
				void selectCommit(sha);
			},
		},
		"separator",
		{
			label: "Cherry-pick sul ramo attuale",
			action: () => void cherryPickCommit(sha),
		},
		{ label: "Copia SHA", action: () => void copyText(sha) },
	];
	if (commit) {
		entries.push({
			label: "Copia messaggio",
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

// ── eventi ───────────────────────────────────────────────────────────────────

ui.btnOpen.addEventListener("click", () => void openRepository());

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

for (const button of document.querySelectorAll<HTMLButtonElement>(
	"[data-diff]"
)) {
	button.addEventListener("click", () => {
		const layout: DiffLayout =
			button.dataset.diff === "split" ? "split" : "unified";
		if (layout === state.diffLayout) return;
		state.diffLayout = layout;
		try {
			localStorage.setItem("githandler.diffLayout", layout);
		} catch {
			// storage negato: la preferenza vale solo per questa sessione
		}
		updateDiffButtons();
		if (state.changePath && state.changeDiff) renderChangeDiff();
		if (state.tab === "commit" && state.commitPath) {
			void selectCommitFile(state.commitPath);
		}
		if (state.tab === "tree" && state.treePath) {
			void selectTreeFile(state.treePath);
		}
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
		await refreshTrashUsage(saved.trash.quotaBytes);
		ui.settingsDialog.close();
		toast("Impostazioni salvate.", "ok");
	})();
});

ui.tabChanges.addEventListener("click", () => setSide("changes"));
ui.tabCommit.addEventListener("click", () => setTab("commit"));
ui.tabTree.addEventListener("click", () => setTab("tree"));
ui.tabBlame.addEventListener("click", () => setTab("blame"));
ui.tabTerm.addEventListener("click", () => setTab("term"));

ui.sideChanges.addEventListener("click", () => setSide("changes"));
ui.sideCommits.addEventListener("click", () => setSide("commits"));
ui.btnSearchFocus.addEventListener("click", () => ui.searchInput.focus());
ui.btnNewTab.addEventListener("click", () => void openRepository());

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
		toast(`Aggiornamento automatico: ${event.message}`);
		return;
	}
	const session = sessions.get(event.snapshot.info.root);
	if (!session) return;
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
