import { app, BrowserWindow, dialog, ipcMain, Menu } from "electron";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";

import type { IpcChannel } from "../shared/api.ts";
import { CliGitBackend } from "./backend.ts";

const argv = process.argv.slice(1);
const argValue = (name: string): string | null => {
	const index = argv.indexOf(name);
	return index >= 0 ? argv[index + 1] ?? null : null;
};

const shotsPath = argValue("--shots-output");
const shotsMode = argv.includes("--shots") || shotsPath !== null;
let pendingRepo = argValue("--repo");

/**
 * Su questa macchina il processo GPU di Chromium non parte (vedi `clevo-control`).
 * Per un'app testuale il rendering software è invisibile: lo teniamo come default e
 * lasciamo `GITCRAFT_GPU=1` per riattivare l'accelerazione dove funziona.
 */
if (process.env.GITCRAFT_GPU !== "1") app.disableHardwareAcceleration();

const backend = new CliGitBackend();
let window: BrowserWindow | null = null;

function cleanError(error: unknown): string {
	const message = error instanceof Error ? error.message : String(error);
	return message.replace(
		/^Error invoking remote method '[^']+': (Error: )?/,
		""
	);
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

		return backend.open(target);
	});

	handle("git:refresh", () => backend.refresh());
	handle("git:commitFiles", (sha: string) => backend.commitFiles(sha));
	handle("git:commitPatch", (sha: string, path: string) =>
		backend.commitPatch(sha, path)
	);
	handle("git:worktreePatch", (path: string, staged: boolean) =>
		backend.worktreePatch(path, staged)
	);
	handle("git:stage", (paths: string[]) => backend.stage(paths));
	handle("git:applyPatch", (path: string, patch: string, mode: "stage" | "unstage") =>
		backend.applyPatch(path, patch, mode),
	);
	handle("git:unstage", (paths: string[]) => backend.unstage(paths));
	handle("git:discard", (paths: string[]) => backend.discard(paths));
	handle("git:commit", (message: string, all: boolean) =>
		backend.commit(message, all)
	);
	handle("git:checkout", (branch: string) => backend.checkout(branch));
	handle("git:createBranch", (name: string) => backend.createBranch(name));
	handle("git:fetch", () => backend.fetch());
}

function buildMenu(): void {
	Menu.setApplicationMenu(
		Menu.buildFromTemplate([
			{
				label: "gitcraft",
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
		title: "gitcraft",
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
	const target = shotsPath ?? join(app.getPath("temp"), "gitcraft.png");
	const steps: Array<[string, string]> = [
		[
			`document.querySelectorAll(".row")[2]?.click()`,
			target.replace(/\.png$/, "-commit.png"),
		],
		[
			`document.getElementById("tab-changes")?.click();
			 document.querySelector("#changes-list li")?.click();`,
			target.replace(/\.png$/, "-changes.png"),
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
