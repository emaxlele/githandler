import type { HunkSelection, PatchMode } from "../core/patch.ts";
import { buildPatch } from "../core/patch.ts";
import type { CommitFile, DiffFile, Snapshot } from "../core/types.ts";
import type { GitApi } from "../shared/api.ts";
import { pickKey, renderDiff } from "./diff-view.ts";
import { byId, clear, el, fullDate } from "./dom.ts";
import { LogView } from "./log-view.ts";

declare global {
	interface Window {
		gitcraft: GitApi;
	}
}

const api = window.gitcraft;

type Tab = "changes" | "commit";

interface State {
	snapshot: Snapshot | null;
	selectedCommit: string | null;
	commitFiles: CommitFile[];
	commitPath: string | null;
	changePath: string | null;
	changeStaged: boolean;
	/** Diff attualmente disegnato per il working tree: serve a ricostruire le patch parziali. */
	changeDiff: DiffFile | null;
	/** Righe scelte per lo staging parziale, nella forma `hunk:line`. */
	picked: Set<string>;
	tab: Tab;
}

const state: State = {
	snapshot: null,
	selectedCommit: null,
	commitFiles: [],
	commitPath: null,
	changePath: null,
	changeStaged: false,
	changeDiff: null,
	picked: new Set(),
	tab: "changes",
};

const ui = {
	repoName: byId("repo-name"),
	repoBranch: byId("repo-branch"),
	repoSync: byId("repo-sync"),
	btnOpen: byId<HTMLButtonElement>("btn-open"),
	btnRefresh: byId<HTMLButtonElement>("btn-refresh"),
	btnFetch: byId<HTMLButtonElement>("btn-fetch"),
	listBranches: byId("list-branches"),
	listRemotes: byId("list-remotes"),
	listTags: byId("list-tags"),
	newBranchForm: byId<HTMLFormElement>("new-branch-form"),
	newBranchName: byId<HTMLInputElement>("new-branch-name"),
	btnNewBranch: byId<HTMLButtonElement>("btn-new-branch"),
	commitCount: byId("commit-count"),
	tabChanges: byId<HTMLButtonElement>("tab-changes"),
	tabCommit: byId<HTMLButtonElement>("tab-commit"),
	panelChanges: byId("panel-changes"),
	panelCommit: byId("panel-commit"),
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
	toast: byId("toast"),
};

const logView = new LogView((sha) => void selectCommit(sha));

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
	state.snapshot = snapshot;

	logView.setEmptyMessage(
		snapshot.commits.length === 0
			? "Repository senza commit: crea il primo dalla scheda Modifiche."
			: ""
	);

	if (
		state.selectedCommit &&
		!snapshot.commits.some((c) => c.sha === state.selectedCommit)
	) {
		state.selectedCommit = null;
	}

	ui.repoName.textContent = snapshot.info.name;
	ui.repoBranch.textContent = snapshot.info.branch ?? "HEAD staccato";
	ui.repoBranch.classList.remove("hidden");

	const { ahead, behind } = snapshot.status;
	ui.repoSync.textContent = `↑${ahead} ↓${behind}`;
	ui.repoSync.classList.remove("hidden");

	ui.commitCount.textContent = `${snapshot.commits.length} commit`;
	logView.setData(snapshot.commits, snapshot.graph);
	if (state.selectedCommit) logView.select(state.selectedCommit);

	renderRefs(snapshot);
	renderChanges(snapshot);
	void reloadOpenDiff();
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
	if (file) renderDiff(ui.commitDiff, file, "Nessuna differenza.");
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
	ui.panelChanges.classList.toggle("is-active", tab === "changes");
	ui.panelCommit.classList.toggle("is-active", tab === "commit");
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
	if (
		!window.confirm(
			`Scartare le modifiche di ${label}? L'operazione non è reversibile.`
		)
	)
		return;
	const snapshot = await guard("Scarta", () => api.discard(paths));
	if (snapshot) applySnapshot(snapshot);
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

ui.btnRefresh.addEventListener("click", () => void refresh());
ui.btnFetch.addEventListener("click", () => void fetchAll());

ui.tabChanges.addEventListener("click", () => setTab("changes"));
ui.tabCommit.addEventListener("click", () => setTab("commit"));

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
			if (lines.length > 0) void applyPartial(selectionForHunk(hunk, lines));
		}
		return;
	}

	const line = target.closest<HTMLElement>(".dline[data-selectable]");
	if (!line) return;
	// solo i numeri di riga fanno da casella: il testo del diff resta selezionabile
	if (!target.closest(".no") && !target.closest(".mk")) return;
	togglePick(Number(line.dataset.hunk), Number(line.dataset.line));
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
	if (event.key === "ArrowDown") {
		event.preventDefault();
		logView.step(1);
	} else if (event.key === "ArrowUp") {
		event.preventDefault();
		logView.step(-1);
	}
});

void boot();
