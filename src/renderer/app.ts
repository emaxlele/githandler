import type { HunkSelection, PatchMode } from "../core/patch.ts";
import { buildPatch } from "../core/patch.ts";
import { layoutGraph } from "../core/graph.ts";
import {
	API_TOOLS,
	MEBIBYTE,
	TRASH_DEFAULTS,
	type ApiMode,
	type ApiTool,
	type Settings,
	type TrashUsage,
} from "../core/settings.ts";
import type { Commit, CommitFile, DiffFile, Snapshot } from "../core/types.ts";
import { describeUndo } from "../core/undo.ts";
import type { GitApi } from "../shared/api.ts";
import { BlameView } from "./blame-view.ts";
import { pickKey, renderDiff, type DiffLayout } from "./diff-view.ts";
import { byId, clear, el, fullDate } from "./dom.ts";
import { LogView } from "./log-view.ts";

declare global {
	interface Window {
		gitcraft: GitApi;
	}
}

const api = window.gitcraft;

type Tab = "changes" | "commit" | "blame";

interface State {
	snapshot: Snapshot | null;
	/** storia caricata: la prima pagina più quelle richieste scorrendo */
	commits: Commit[];
	/** esistono altre pagine dopo `commits` */
	hasMore: boolean;
	loadingMore: boolean;
	selectedCommit: string | null;
	commitFiles: CommitFile[];
	commitPath: string | null;
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
}

const state: State = {
	snapshot: null,
	commits: [],
	hasMore: false,
	loadingMore: false,
	selectedCommit: null,
	commitFiles: [],
	commitPath: null,
	changePath: null,
	changeStaged: false,
	changeDiff: null,
	picked: new Set(),
	diffLayout: savedLayout(),
	tab: "changes",
	searchQuery: null,
};

/** Il formato del diff è una preferenza dell'utente: si ricorda fra un avvio e l'altro. */
function savedLayout(): DiffLayout {
	try {
		return localStorage.getItem("gitcraft.diffLayout") === "split"
			? "split"
			: "unified";
	} catch {
		return "unified";
	}
}

const ui = {
	repoName: byId("repo-name"),
	repoBranch: byId("repo-branch"),
	repoWatch: byId("repo-watch"),
	repoSync: byId("repo-sync"),
	btnOpen: byId<HTMLButtonElement>("btn-open"),
	btnUndo: byId<HTMLButtonElement>("btn-undo"),
	btnRefresh: byId<HTMLButtonElement>("btn-refresh"),
	btnFetch: byId<HTMLButtonElement>("btn-fetch"),
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
	tabBlame: byId<HTMLButtonElement>("tab-blame"),
	panelChanges: byId("panel-changes"),
	panelCommit: byId("panel-commit"),
	panelBlame: byId("panel-blame"),
	blamePath: byId("blame-path"),
	changesCount: byId("changes-count"),
	changesList: byId("changes-list"),
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

/** Esegue un'operazione Git mostrando l'errore reale invece di fallire in silenzio. */
async function guard<T>(
	label: string,
	task: () => Promise<T>
): Promise<T | null> {
	try {
		return await task();
	} catch (error) {
		toast(`${label}: ${(error as Error).message}`);
		return null;
	}
}

// ── rendering ────────────────────────────────────────────────────────────────

function applySnapshot(snapshot: Snapshot): void {
	const sameRepo = state.snapshot?.info.root === snapshot.info.root;
	if (!sameRepo && state.searchQuery) {
		state.searchQuery = null;
		ui.searchInput.value = "";
		ui.btnSearchClear.classList.add("hidden");
		ui.searchInfo.textContent = "";
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

	ui.repoName.textContent = snapshot.info.name;
	ui.repoBranch.textContent = snapshot.info.branch ?? "HEAD staccato";
	ui.repoBranch.classList.remove("hidden");

	const { ahead, behind } = snapshot.status;
	ui.repoSync.textContent = `↑${ahead} ↓${behind}`;
	ui.repoSync.classList.remove("hidden");

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
	state.loadingMore = true;
	try {
		const page = await guard("Storia", () =>
			api.moreCommits(state.commits.length)
		);
		if (!page) return;
		const known = new Set(state.commits.map((commit) => commit.sha));
		const added = page.commits.filter((commit) => !known.has(commit.sha));
		state.commits = state.commits.concat(added);
		state.hasMore = page.hasMore && added.length > 0;
		updateCommitCount();
		if (!state.searchQuery)
			logView.setData(state.commits, layoutGraph(state.commits));
	} finally {
		state.loadingMore = false;
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
			item.appendChild(el("span", "ref-name", ref.short));
			if (ref.ahead || ref.behind) {
				item.appendChild(
					el("span", "ref-track", `↑${ref.ahead} ↓${ref.behind}`)
				);
			}
			item.title =
				ref.kind === "tag" ? ref.name : `checkout ${ref.short}`;
			if (ref.kind !== "tag") {
				item.addEventListener("click", () => void checkout(ref.short));
			}
			container.appendChild(item);
		}
	}
}

function renderChanges(snapshot: Snapshot): void {
	const entries = snapshot.status.entries;
	ui.changesCount.textContent = String(entries.length);
	clear(ui.changesList);

	if (entries.length === 0) {
		const empty = el("li", "muted", "Nessuna modifica.");
		empty.style.cursor = "default";
		ui.changesList.appendChild(empty);
		return;
	}

	for (const entry of entries) {
		const item = el("li");
		item.dataset.path = entry.path;
		if (entry.path === state.changePath) item.classList.add("is-selected");

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
		const fullyStaged = entry.index !== "." && entry.worktree === ".";
		const toggle = el("button", "icon-btn", fullyStaged ? "−" : "+");
		toggle.dataset.act = fullyStaged ? "unstage" : "stage";
		toggle.title = fullyStaged
			? "Togli dallo stage"
			: "Aggiungi allo stage";
		acts.appendChild(toggle);

		const discard = el("button", "icon-btn", "×");
		discard.dataset.act = "discard";
		discard.title = "Scarta le modifiche";
		acts.appendChild(discard);

		item.appendChild(acts);
		ui.changesList.appendChild(item);
	}
}

function renderCommitFiles(): void {
	clear(ui.commitFilesList);
	const commit = state.snapshot?.commits.find(
		(c) => c.sha === state.selectedCommit
	);
	clear(ui.commitMeta);
	if (commit) {
		const sha = el("div", "sha", commit.sha.slice(0, 10));
		const subject = el("div", "subject", commit.subject);
		ui.commitMeta.append(sha, subject);
		ui.commitMeta.title = fullDate(commit.timestamp * 1000);
	}

	if (state.commitFiles.length === 0) {
		ui.commitFilesList.appendChild(el("li", "muted", "Nessun file."));
		return;
	}

	for (const file of state.commitFiles) {
		const item = el("li");
		item.dataset.path = file.path;
		if (file.path === state.commitPath) item.classList.add("is-selected");
		item.appendChild(
			el("span", `st st-${file.status.toLowerCase()}`, file.status)
		);
		item.appendChild(el("span", "name", file.path));
		ui.commitFilesList.appendChild(item);
	}
}

// ── azioni ───────────────────────────────────────────────────────────────────

async function boot(): Promise<void> {
	const snapshot = await guard("Apertura", () => api.open());
	if (snapshot) applySnapshot(snapshot);
}

async function refresh(): Promise<void> {
	const snapshot = await guard("Aggiornamento", () => api.refresh());
	if (snapshot) applySnapshot(snapshot);
}

async function selectCommit(sha: string): Promise<void> {
	state.selectedCommit = sha;
	state.commitPath = null;
	setTab("commit");
	logView.select(sha);

	const files = await guard("Commit", () => api.commitFiles(sha));
	if (!files) return;
	state.commitFiles = files;
	renderCommitFiles();

	const first = files[0];
	if (first) await selectCommitFile(first.path);
	else renderDiff(ui.commitDiff, null, "Commit senza modifiche ai file.");
}

async function selectCommitFile(path: string): Promise<void> {
	const sha = state.selectedCommit;
	if (!sha) return;
	state.commitPath = path;
	renderCommitFiles();
	const file = await guard("Diff", () => api.commitPatch(sha, path));
	if (file) {
		renderDiff(ui.commitDiff, file, "Nessuna differenza.", {
			layout: state.diffLayout,
		});
	}
}

async function selectChange(path: string): Promise<void> {
	const entry = state.snapshot?.status.entries.find(
		(item) => item.path === path
	);
	if (!entry) return;
	if (state.changePath !== path) clearPicked();
	state.changePath = path;
	state.changeStaged = entry.index !== "." && entry.worktree === ".";
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
	const file = await guard("Diff", () =>
		api.worktreePatch(path, state.changeStaged)
	);
	if (!file) return;
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

function setTab(tab: Tab): void {
	state.tab = tab;
	ui.tabChanges.classList.toggle("is-active", tab === "changes");
	ui.tabCommit.classList.toggle("is-active", tab === "commit");
	ui.tabBlame.classList.toggle("is-active", tab === "blame");
	ui.panelChanges.classList.toggle("is-active", tab === "changes");
	ui.panelCommit.classList.toggle("is-active", tab === "commit");
	ui.panelBlame.classList.toggle("is-active", tab === "blame");
	if (tab === "blame") void loadBlame();
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
	blameView.setData(null, "Lettura del blame…");
	const file = await guard("Blame", () => api.blame(path));
	if (!file) return;
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
	setTab("changes");
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

// ── eventi ───────────────────────────────────────────────────────────────────

ui.btnOpen.addEventListener("click", () => {
	void (async () => {
		const snapshot = await guard("Apertura", () => api.open());
		if (snapshot) applySnapshot(snapshot);
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

for (const button of document.querySelectorAll<HTMLButtonElement>(
	"[data-diff]"
)) {
	button.addEventListener("click", () => {
		const layout: DiffLayout =
			button.dataset.diff === "split" ? "split" : "unified";
		if (layout === state.diffLayout) return;
		state.diffLayout = layout;
		try {
			localStorage.setItem("gitcraft.diffLayout", layout);
		} catch {
			// storage negato: la preferenza vale solo per questa sessione
		}
		updateDiffButtons();
		if (state.changePath && state.changeDiff) renderChangeDiff();
		if (state.tab === "commit" && state.commitPath) {
			void selectCommitFile(state.commitPath);
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

ui.tabChanges.addEventListener("click", () => setTab("changes"));
ui.tabCommit.addEventListener("click", () => setTab("commit"));
ui.tabBlame.addEventListener("click", () => setTab("blame"));

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

ui.changesList.addEventListener("click", (event) => {
	const target = event.target as HTMLElement;
	const action = target.closest<HTMLElement>(".icon-btn")?.dataset.act;
	const path = target.closest<HTMLElement>("li")?.dataset.path;
	if (!path) return;

	if (action === "stage") void stage([path]);
	else if (action === "unstage") void unstage([path]);
	else if (action === "discard") void discard([path]);
	else void selectChange(path);
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
	const previous = state.snapshot?.commits[0]?.sha ?? null;
	applySnapshot(event.snapshot);
	const next = event.snapshot.commits[0]?.sha ?? null;
	if (previous && next !== previous)
		toast("Repository aggiornato da fuori.", "ok");
});

void boot();
