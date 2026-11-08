import { spawn, type ChildProcess } from "node:child_process";
import { app, BrowserWindow, dialog, ipcMain, Menu } from "electron";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";

import {
	CHANGED_CHANNEL,
	TERMINAL_CHANNEL,
	type IpcChannel,
	type TerminalEvent,
} from "../shared/api.ts";
import { normalizeSettings } from "../core/settings.ts";
import { CliGitBackend } from "./backend.ts";
import { loadSettings, saveSettings } from "./settings.ts";
import { startWatcher } from "./watcher.ts";

const argv = process.argv.slice(1);
const argValue = (name: string): string | null => {
	const index = argv.indexOf(name);
	return index >= 0 ? argv[index + 1] ?? null : null;
};

const shotsPath = argValue("--shots-output");
const shotsMode = argv.includes("--shots") || shotsPath !== null;
let pendingRepo = argValue("--repo");

/**
 * Sorveglianza del repository: opt-in (`--watch` o `GITHANDLER_WATCH=1`), spenta con `--no-watch`.
 * Un client che si aggiorna da solo mentre si lavora in terminale è utile solo se lo si vuole.
 */
const watchEnabled = argv.includes("--no-watch")
	? false
	: argv.includes("--watch") || process.env.GITHANDLER_WATCH === "1";

/**
 * Su questa macchina il processo GPU di Chromium non parte (vedi `clevo-control`).
 * Per un'app testuale il rendering software è invisibile: lo teniamo come default e
 * lasciamo `GITHANDLER_GPU=1` per riattivare l'accelerazione dove funziona.
 */
if (process.env.GITHANDLER_GPU !== "1") app.disableHardwareAcceleration();

/**
 * Più repository aperti insieme: un backend per root, il root attivo guida watcher e refresh.
 * Il renderer sceglie la scheda con `git:use`; ogni chiamata porta il root come primo argomento,
 * quindi una risposta in ritardo non può finire sul repository sbagliato.
 */
const backends = new Map<string, CliGitBackend>();
let activeRoot: string | null = null;
let window: BrowserWindow | null = null;
let stopWatching: (() => void) | null = null;
let refreshing = false;
let refreshPending = false;

/** Il backend di un repository già aperto; un root sconosciuto è un errore, non un'apertura implicita. */
function backendFor(root: string): CliGitBackend {
	const backend = backends.get(root);
	if (!backend) throw new Error(`Repository non aperto: ${root}`);
	return backend;
}

function sendTerminal(event: TerminalEvent): void {
	window?.webContents.send(TERMINAL_CHANNEL, event);
}

function cleanError(error: unknown): string {
	const message = error instanceof Error ? error.message : String(error);
	return message.replace(
		/^Error invoking remote method '[^']+': (Error: )?/,
		""
	);
}

/** Rilegge il repository e lo manda al renderer; un solo aggiornamento in volo alla volta. */
async function pushRefresh(): Promise<void> {
	if (refreshing) {
		refreshPending = true;
		return;
	}
	refreshing = true;
	try {
		if (!activeRoot) return;
		const snapshot = await backendFor(activeRoot).refresh();
		window?.webContents.send(CHANGED_CHANNEL, {
			kind: "snapshot",
			snapshot,
		});
	} catch (error) {
		window?.webContents.send(CHANGED_CHANNEL, {
			kind: "error",
			message: cleanError(error),
		});
	} finally {
		refreshing = false;
		if (refreshPending) {
			refreshPending = false;
			void pushRefresh();
		}
	}
}

function watchRepository(root: string): void {
	stopWatching?.();
	stopWatching = null;
	if (!watchEnabled) return;
	stopWatching = startWatcher({ root, onChange: () => void pushRefresh() });
}

function handle<T>(
	channel: IpcChannel,
	fn: (...args: never[]) => Promise<T>
): void {
	ipcMain.handle(channel, async (_event, ...args) => {
		try {
			return await (fn as (...inner: unknown[]) => Promise<T>)(...args);
		} catch (error) {
			throw new Error(cleanError(error));
		}
	});
}

function registerIpc(): void {
	handle("git:open", async (path?: string) => {
		let target = path ?? pendingRepo ?? undefined;
		pendingRepo = null;

		if (!target) {
			if (shotsMode || !window) return null;
			const result = await dialog.showOpenDialog(window, {
				title: "Apri un repository Git",
				properties: ["openDirectory"],
			});
			target = result.filePaths[0];
			if (result.canceled || !target) return null;
		}

		const backend = new CliGitBackend({ settings: loadSettings });
		const snapshot = await backend.open(target);
		backends.set(snapshot.info.root, backend);
		activeRoot = snapshot.info.root;
		watchRepository(snapshot.info.root);
		return snapshot;
	});

	handle("git:use", async (root: string) => {
		backendFor(root);
		activeRoot = root;
		watchRepository(root);
	});

	handle("git:refresh", (root: string) => backendFor(root).refresh());
	handle("git:commitDetails", (root: string, sha: string) =>
		backendFor(root).commitDetails(sha)
	);
	handle("git:commitFiles", (root: string, sha: string) =>
		backendFor(root).commitFiles(sha)
	);
	handle("git:commitPatch", (root: string, sha: string, path: string) =>
		backendFor(root).commitPatch(sha, path)
	);
	handle("git:worktreePatch", (root: string, path: string, staged: boolean) =>
		backendFor(root).worktreePatch(path, staged)
	);
	handle("git:stage", (root: string, paths: string[]) =>
		backendFor(root).stage(paths)
	);
	handle(
		"git:applyPatch",
		(root: string, path: string, patch: string, mode: "stage" | "unstage") =>
			backendFor(root).applyPatch(path, patch, mode)
	);
	handle("git:unstage", (root: string, paths: string[]) =>
		backendFor(root).unstage(paths)
	);
	handle("git:discard", (root: string, paths: string[]) =>
		backendFor(root).discard(paths)
	);
	handle("git:commit", (root: string, message: string, all: boolean) =>
		backendFor(root).commit(message, all)
	);
	handle("git:checkout", (root: string, branch: string) =>
		backendFor(root).checkout(branch)
	);
	handle("git:createBranch", (root: string, name: string) =>
		backendFor(root).createBranch(name)
	);
	handle("git:fetch", (root: string) => backendFor(root).fetch());
	handle("git:pull", (root: string) => backendFor(root).pull());
	handle("git:push", (root: string) => backendFor(root).push());
	handle("git:stashList", (root: string) => backendFor(root).stashList());
	handle("git:stashSave", (root: string, message: string) =>
		backendFor(root).stashSave(message)
	);
	handle("git:stashApply", (root: string, index: number, drop: boolean) =>
		backendFor(root).stashApply(index, drop)
	);
	handle("git:stashDrop", (root: string, index: number) =>
		backendFor(root).stashDrop(index)
	);
	handle("git:submodules", (root: string) => backendFor(root).submodules());
	handle("git:updateSubmodules", (root: string) =>
		backendFor(root).updateSubmodules()
	);
	handle("git:merge", (root: string, branch: string) =>
		backendFor(root).merge(branch)
	);
	handle("git:rebase", (root: string, onto: string) =>
		backendFor(root).rebase(onto)
	);
	handle("git:cherryPick", (root: string, sha: string) =>
		backendFor(root).cherryPick(sha)
	);
	handle("git:renameBranch", (root: string, from: string, to: string) =>
		backendFor(root).renameBranch(from, to)
	);
	handle("git:deleteBranch", (root: string, name: string, force: boolean) =>
		backendFor(root).deleteBranch(name, force)
	);
	handle("git:checkoutTracking", (root: string, ref: string, local: string) =>
		backendFor(root).checkoutTracking(ref, local)
	);
	handle("git:abortOperation", (root: string) =>
		backendFor(root).abortOperation()
	);
	handle("git:search", (root: string, query: string) =>
		backendFor(root).search(query)
	);
	handle("git:moreCommits", (root: string, skip: number) =>
		backendFor(root).historyPage(skip)
	);
	handle("git:blame", (root: string, path: string, start?: number, end?: number) =>
		backendFor(root).blame(path, start, end)
	);
	handle("git:undo", (root: string) => backendFor(root).undo());
	handle("app:watching", async () => watchEnabled && stopWatching !== null);
	handle("app:settings", () => loadSettings());
	handle("app:settings:save", async (input: unknown) => {
		// il renderer non è una fonte attendibile: si normalizza prima di scrivere
		const settings = normalizeSettings(input);
		await saveSettings(settings);
		return settings;
	});
	handle("app:trashUsage", (root: string) => backendFor(root).trashUsage());

	// Il terminale esegue quello che l'utente scrive: è una shell, non un comando Git strutturato.
	const terminals = new Map<string, ChildProcess>();
	handle("term:run", async (root: string, id: string, command: string) => {
		const cwd = backendFor(root).info?.root ?? root;
		if (!command.trim()) return;
		terminals.get(id)?.kill();

		const child = spawn("bash", ["-lc", command], {
			cwd,
			env: {
				...process.env,
				TERM: "dumb",
				PAGER: "cat",
				GIT_PAGER: "cat",
				// un comando che chiede password non deve restare appeso senza TTY
				GIT_TERMINAL_PROMPT: "0",
			},
		});
		terminals.set(id, child);

		child.stdout?.on("data", (chunk: Buffer) =>
			sendTerminal({ kind: "data", id, text: chunk.toString("utf8") })
		);
		child.stderr?.on("data", (chunk: Buffer) =>
			sendTerminal({ kind: "data", id, text: chunk.toString("utf8") })
		);
		child.on("error", (error) => {
			terminals.delete(id);
			sendTerminal({ kind: "error", id, message: cleanError(error) });
		});
		child.on("close", (code) => {
			terminals.delete(id);
			sendTerminal({ kind: "exit", id, code });
		});
	});
	handle("term:kill", async (id: string) => {
		terminals.get(id)?.kill();
	});
}

function buildMenu(): void {
	Menu.setApplicationMenu(
		Menu.buildFromTemplate([
			{
				label: "GitHandler",
				submenu: [
					{ role: "reload" },
					{ role: "toggleDevTools" },
					{ type: "separator" },
					{ role: "quit" },
				],
			},
			{
				label: "Modifica",
				submenu: [
					{ role: "copy" },
					{ role: "paste" },
					{ role: "selectAll" },
				],
			},
		])
	);
}

function createWindow(): void {
	window = new BrowserWindow({
		width: 1440,
		height: 900,
		minWidth: 900,
		minHeight: 560,
		backgroundColor: "#0d1017",
		show: false,
		title: "GitHandler",
		webPreferences: {
			preload: join(__dirname, "../preload/index.js"),
			contextIsolation: true,
			nodeIntegration: false,
			sandbox: true,
		},
	});

	window.loadFile(join(__dirname, "../renderer/index.html"));

	window.once("ready-to-show", () => window?.show());

	if (shotsMode) {
		window.webContents.once("did-finish-load", () => void runShots());
	}

	window.on("closed", () => {
		stopWatching?.();
		stopWatching = null;
		window = null;
	});
}

const wait = (ms: number): Promise<void> =>
	new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Modalità verifica: guida la UI con `executeJavaScript` e salva degli screenshot.
 * Non è una feature del prodotto, serve a controllare la resa senza dipendere dal display.
 */
async function runShots(): Promise<void> {
	if (!window) return;
	const target = shotsPath ?? join(app.getPath("temp"), "githandler.png");
	const steps: Array<[string, string]> = [
		[
			`document.querySelectorAll(".row")[2]?.click()`,
			target.replace(/\.png$/, "-commit.png"),
		],
		[
			`document.getElementById("tab-changes")?.click();
			 document.querySelector("#changes-list-unstaged li")?.click();`,
			target.replace(/\.png$/, "-changes.png"),
		],
		[
			`document.getElementById("tab-tree")?.click();
			 document.querySelector("#tree-list .tree-node:last-child")?.click();`,
			target.replace(/\.png$/, "-tree.png"),
		],
		[
			`document.getElementById("tab-blame")?.click()`,
			target.replace(/\.png$/, "-blame.png"),
		],
		[
			`(() => {
				const input = document.getElementById("search-input");
				input.value = "author:Anna";
				input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
			})()`,
			target.replace(/\.png$/, "-search.png"),
		],
		[
			`document.getElementById("side-changes")?.click()`,
			target.replace(/\.png$/, "-changes-main.png"),
		],
		[
			`document.querySelector("#list-branches li")?.click()`,
			target.replace(/\.png$/, "-ref.png"),
		],
		[
			`(() => {
				const item = document.querySelector("#list-branches li");
				if (!item) return;
				item.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, clientX: 220, clientY: 260 }));
			})()`,
			target.replace(/\.png$/, "-ref-menu.png"),
		],
		[
			`document.getElementById("btn-stash")?.click()`,
			target.replace(/\.png$/, "-stash.png"),
		],
		[
			`(() => {
				document.getElementById("stash-dialog")?.close();
				document.getElementById("tab-term")?.click();
				const input = document.getElementById("term-input");
				input.value = "git status --short";
				document.getElementById("term-form")
					.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
			})()`,
			target.replace(/\.png$/, "-term.png"),
		],
		[
			`document.getElementById("btn-settings")?.click()`,
			target.replace(/\.png$/, "-settings.png"),
		],
	];

	try {
		await wait(1500);
		for (const [script, file] of steps) {
			await window.webContents
				.executeJavaScript(script)
				.catch(() => undefined);
			await wait(900);
			const image = await window.webContents.capturePage();
			await writeFile(file, image.toPNG());
			process.stdout.write(`screenshot: ${file}\n`);
		}
	} catch (error) {
		process.stderr.write(`screenshot fallito: ${cleanError(error)}\n`);
	} finally {
		app.quit();
	}
}

app.whenReady().then(() => {
	registerIpc();
	buildMenu();
	createWindow();

	app.on("activate", () => {
		if (BrowserWindow.getAllWindows().length === 0) createWindow();
	});
});

app.on("window-all-closed", () => {
	if (process.platform !== "darwin") app.quit();
});
