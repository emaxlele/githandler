import { spawn, type ChildProcess } from "node:child_process";
import {
	app,
	BrowserWindow,
	dialog,
	ipcMain,
	Menu,
	nativeImage,
	nativeTheme,
	screen,
	shell,
} from "electron";
import { writeFile } from "node:fs/promises";
import { basename, join } from "node:path";

import {
	CHANGED_CHANNEL,
	DRAG_CHANNEL,
	NETWORK_CHANNEL,
	OAUTH_CHANNEL,
	PANEL_DETACHED_CHANNEL,
	PANEL_STATE_CHANNEL,
	TERMINAL_CHANNEL,
	type AccountInput,
	type IpcChannel,
	type PanelState,
	type TerminalEvent,
} from "../shared/api.ts";
import {
	commitWebUrl,
	fileWebUrl,
	hostFromUrl,
	remoteWeb,
} from "../core/providers.ts";
import { parseHistoryQuery } from "../core/search.ts";
import type { ContentQuery } from "../core/content.ts";
import {
	APPEARANCE_DEFAULTS,
	FONT_SCALE_FACTORS,
	normalizeSettings,
	type AppearanceSettings,
} from "../core/settings.ts";
import type { NewPullRequest } from "../core/pulls.ts";
import type { RebaseStep } from "../core/rebase.ts";
import {
	accountRepos,
	accountsInfo,
	credentialEnvFor,
	hydrateTokens,
	removeAccount,
	repoAccountChoice,
	saveAccount,
	setRepoAccount,
} from "./accounts.ts";
import { listWorkflowRuns, runWorkflowAction } from "./actions.ts";
import type { WorkflowAction } from "../core/actions.ts";
import {
	addPullComment,
	createPull,
	listPulls,
	pullChecks,
	pullComments,
} from "./pulls.ts";
import { exportArchive } from "./export.ts";
import { forkBranches, forkInfo, forkPreview, syncFork } from "./fork.ts";
import { CliGitBackend } from "./backend.ts";
import {
	listRepoFiles,
	readCommitFile,
	readWorkingFile,
	resolveInside,
} from "./files.ts";
import { claimAccount, cancelOAuth, startOAuth } from "./oauth.ts";
import { originRemote } from "./remote.ts";
import { cloneRepository, initRepository, type Identity } from "./repos.ts";
import { loadSettings, saveSettings } from "./settings.ts";
import { startCiNotifier, type CiNotifier } from "./tray.ts";
import { startWatcher } from "./watcher.ts";

const argv = process.argv.slice(1);
const argValue = (name: string): string | null => {
	const index = argv.indexOf(name);
	return index >= 0 ? argv[index + 1] ?? null : null;
};

const shotsPath = argValue("--shots-output");
const shotsMode = argv.includes("--shots") || shotsPath !== null;
/** Override della lingua per screenshot e prove: la scelta dell'utente resta nelle impostazioni. */
const localeOverride =
	process.env.GITHANDLER_LOCALE ?? argValue("--locale") ?? null;
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
let panelWindow: BrowserWindow | null = null;
/** Ultima selezione pubblicata: la finestra staccata la riceve appena è pronta. */
let lastPanelState: PanelState | null = null;
let stopWatching: (() => void) | null = null;
let refreshing = false;
let refreshPending = false;
/** Appearance is applied by the main process: zoom and native colour-scheme are window properties. */
let currentAppearance: AppearanceSettings = { ...APPEARANCE_DEFAULTS };

function windowBackground(appearance: AppearanceSettings): string {
	if (appearance.theme === "light") return "#f7f8fa";
	if (appearance.theme === "oled") return "#000000";
	return "#0d1017";
}

/** Zoom, colour-scheme and background for one window; a destroyed window is simply skipped. */
function applyWindowAppearance(
	win: BrowserWindow,
	appearance: AppearanceSettings
): void {
	if (win.isDestroyed()) return;
	win.webContents.setZoomFactor(FONT_SCALE_FACTORS[appearance.fontScale]);
	win.setBackgroundColor(windowBackground(appearance));
}

/** The renderer owns the theme attribute; here we only keep native widgets and zoom in step. */
function applyAppearance(appearance: AppearanceSettings): void {
	currentAppearance = appearance;
	nativeTheme.themeSource =
		appearance.theme === "auto"
			? "system"
			: appearance.theme === "oled"
			? "dark"
			: appearance.theme;
	for (const win of BrowserWindow.getAllWindows()) {
		applyWindowAppearance(win, appearance);
	}
}

async function readAppearance(): Promise<AppearanceSettings> {
	try {
		return (await loadSettings()).appearance;
	} catch (error) {
		process.stderr.write(
			`impostazioni non leggibili, aspetto predefinito: ${String(
				error
			)}\n`
		);
		return { ...APPEARANCE_DEFAULTS };
	}
}

/** Il backend di un repository già aperto; un root sconosciuto è un errore, non un'apertura implicita. */
/**
 * Un backend che conosce anche le credenziali degli account collegati (per fetch/pull/push).
 *
 * Le credenziali dipendono dal **repository**, non solo dall'host: `repoAccounts` dice quale
 * account usare quando due stanno sullo stesso host. Il root si conosce dopo `open`, quindi la
 * chiusura lo legge da una scatola che viene riempita subito dopo.
 */
function newBackend(rootRef: { root: string | null }): CliGitBackend {
	return new CliGitBackend({
		settings: loadSettings,
		credentials: (host) =>
			credentialEnvFor(host, rootRef.root ?? undefined),
	});
}

/** Apre un repository già sul disco: backend, mappa per root, watcher sulla scheda attiva. */
async function openBackend(
	target: string
): Promise<Awaited<ReturnType<CliGitBackend["open"]>>> {
	const rootRef: { root: string | null } = { root: null };
	const backend = newBackend(rootRef);
	const snapshot = await backend.open(target);
	rootRef.root = snapshot.info.root;
	backends.set(snapshot.info.root, backend);
	activeRoot = snapshot.info.root;
	watchRepository(snapshot.info.root);
	// il repository è appena diventato attivo: la fotografia dei workflow parte da qui
	void ciNotifier?.checkNow();
	return snapshot;
}

function backendFor(root: string): CliGitBackend {
	const backend = backends.get(root);
	if (!backend) throw new Error(`Repository non aperto: ${root}`);
	return backend;
}

/** Ogni finestra aperta riceve gli eventi: la principale e quella dei dettagli. */
function broadcast(channel: string, payload: unknown): void {
	for (const win of BrowserWindow.getAllWindows()) {
		if (!win.isDestroyed()) win.webContents.send(channel, payload);
	}
}

function sendTerminal(event: TerminalEvent): void {
	broadcast(TERMINAL_CHANNEL, event);
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
		broadcast(CHANGED_CHANNEL, { kind: "snapshot", snapshot });
	} catch (error) {
		broadcast(CHANGED_CHANNEL, {
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

/** Icona del trascinamento: la stessa dell'app, letta una volta sola. */
let dragIcon: Electron.NativeImage | null = null;

function startFileDrag(
	event: Electron.IpcMainEvent,
	root: unknown,
	path: unknown
): void {
	try {
		if (typeof root !== "string" || typeof path !== "string") return;
		backendFor(root);
		const absolute = resolveInside(root, path);
		dragIcon ??= nativeImage.createFromPath(join(__dirname, "../tray.png"));
		event.sender.startDrag({
			file: absolute,
			icon: dragIcon.isEmpty() ? nativeImage.createEmpty() : dragIcon,
		});
	} catch (error) {
		// il renderer non può ricevere un errore da un canale di solo invio: resta su stderr
		process.stderr.write(`trascinamento non avviato: ${String(error)}\n`);
	}
}

function registerIpc(): void {
	ipcMain.on(DRAG_CHANNEL, (event, root: unknown, path: unknown) =>
		startFileDrag(event, root, path)
	);
	handle("git:open", async (path?: string, interactive = true) => {
		// `--repo` vale per la prima apertura senza percorso: le schede riaperte all'avvio non lo consumano
		let target = path;
		if (!target && pendingRepo) {
			target = pendingRepo;
			pendingRepo = null;
		}

		if (!target) {
			if (shotsMode || !window || !interactive) return null;
			const settings = await loadSettings();
			const result = await dialog.showOpenDialog(window, {
				title: "Apri un repository Git",
				properties: ["openDirectory"],
				defaultPath: settings.defaultRoot ?? undefined,
			});
			target = result.filePaths[0];
			if (result.canceled || !target) return null;
		}

		return openBackend(target);
	});

	handle("git:close", async (root: string) => {
		// con i dettagli in una finestra separata il backend serve ancora a quella finestra
		if (!panelWindow) backends.delete(root);
		if (activeRoot === root) {
			activeRoot = null;
			stopWatching?.();
			stopWatching = null;
		}
	});

	handle("repo:init", async (path: string, identity: Identity | null) => {
		await initRepository(path, identity);
		return openBackend(path);
	});

	handle("repo:clone", async (url: string, dest: string) => {
		await cloneRepository(
			url,
			dest,
			await credentialEnvFor(hostFromUrl(url)),
			(progress) =>
				broadcast(NETWORK_CHANNEL, {
					root: null,
					scope: "clone",
					...progress,
				})
		);
		return openBackend(dest);
	});

	handle("git:use", async (root: string) => {
		backendFor(root);
		activeRoot = root;
		watchRepository(root);
		void ciNotifier?.checkNow();
	});

	handle("git:refresh", (root: string) => backendFor(root).refresh());
	handle("git:commitDetails", (root: string, sha: string) =>
		backendFor(root).commitDetails(sha)
	);
	handle("git:commitFiles", (root: string, sha: string) =>
		backendFor(root).commitFiles(sha)
	);
	handle("git:commitStat", (root: string, sha: string) =>
		backendFor(root).commitStat(sha)
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
		(
			root: string,
			path: string,
			patch: string,
			mode: "stage" | "unstage"
		) => backendFor(root).applyPatch(path, patch, mode)
	);
	handle("git:unstage", (root: string, paths: string[]) =>
		backendFor(root).unstage(paths)
	);
	handle("git:discard", (root: string, paths: string[]) =>
		backendFor(root).discard(paths)
	);
	handle(
		"git:commit",
		(root: string, message: string, all: boolean, sign?: boolean) =>
			backendFor(root).commit(message, all, sign === true)
	);
	handle("git:checkout", (root: string, branch: string) =>
		backendFor(root).checkout(branch)
	);
	handle("git:createBranch", (root: string, name: string) =>
		backendFor(root).createBranch(name)
	);
	handle("git:fetch", (root: string) =>
		backendFor(root).fetch((progress) =>
			broadcast(NETWORK_CHANNEL, { root, scope: "fetch", ...progress })
		)
	);
	handle("git:pull", (root: string) =>
		backendFor(root).pull((progress) =>
			broadcast(NETWORK_CHANNEL, { root, scope: "pull", ...progress })
		)
	);
	handle("git:push", (root: string) =>
		backendFor(root).push((progress) =>
			broadcast(NETWORK_CHANNEL, { root, scope: "push", ...progress })
		)
	);
	handle("git:stashList", (root: string) => backendFor(root).stashList());
	handle("git:stashSave", (root: string, message: string, paths?: string[]) =>
		backendFor(root).stashSave(message, paths)
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
	handle("git:createBranchAt", (root: string, name: string, sha: string) =>
		backendFor(root).createBranchAt(name, sha)
	);
	handle("git:checkoutCommit", (root: string, sha: string) =>
		backendFor(root).checkoutCommit(sha)
	);
	handle(
		"git:reset",
		(root: string, sha: string, mode: "soft" | "mixed" | "hard") =>
			backendFor(root).reset(sha, mode)
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
	handle("git:conflicts", (root: string) => backendFor(root).conflicts());
	handle("git:conflictDetail", (root: string, path: string) =>
		backendFor(root).conflictDetail(path)
	);
	handle(
		"git:resolveConflictFile",
		(root: string, path: string, side: "ours" | "theirs") =>
			backendFor(root).resolveConflictFile(path, side)
	);
	handle(
		"git:writeResolvedFile",
		(root: string, path: string, text: string) =>
			backendFor(root).writeResolvedFile(path, text)
	);
	handle("git:markResolved", (root: string, paths: string[]) =>
		backendFor(root).markResolved(paths)
	);
	handle("git:continueOperation", (root: string) =>
		backendFor(root).continueOperation()
	);
	handle("git:search", (root: string, query: string) =>
		backendFor(root).search(parseHistoryQuery(query))
	);
	handle("git:searchContent", (root: string, query: ContentQuery) =>
		backendFor(root).searchContent(query)
	);
	handle("git:reflog", (root: string, limit?: number) =>
		backendFor(root).reflog(limit)
	);
	handle("git:moreCommits", (root: string, skip: number) =>
		backendFor(root).historyPage(skip)
	);
	handle(
		"git:blame",
		(root: string, path: string, start?: number, end?: number) =>
			backendFor(root).blame(path, start, end)
	);
	handle("git:undo", (root: string) => backendFor(root).undo());
	handle("git:commitTemplate", (root: string) =>
		backendFor(root).commitTemplate()
	);
	handle("git:health", (root: string) => backendFor(root).health());
	handle("git:remoteChecks", (root: string) =>
		backendFor(root).remoteChecks()
	);
	handle("git:worktrees", (root: string) => backendFor(root).worktrees());
	handle("git:createWorktree", (root: string, path: string, branch: string) =>
		backendFor(root).createWorktree(path, branch)
	);
	handle("git:removeWorktree", (root: string, path: string) =>
		backendFor(root).removeWorktree(path)
	);
	handle(
		"git:treeEntries",
		(root: string, ref: string | null, path: string) =>
			backendFor(root).treeEntries(ref, path)
	);
	handle("git:rebaseCandidates", (root: string, from: string) =>
		backendFor(root).rebaseCandidates(from)
	);
	handle(
		"git:rebaseInteractive",
		(root: string, base: string, steps: RebaseStep[], head: string) =>
			backendFor(root).rebaseInteractive(base, steps, head)
	);
	handle("app:watching", async () => watchEnabled && stopWatching !== null);
	handle("app:settings", () => loadSettings());
	handle("app:settings:save", async (input: unknown) => {
		// il renderer non è una fonte attendibile: si normalizza prima di scrivere
		const settings = normalizeSettings(input);
		await saveSettings(settings);
		applyAppearance(settings.appearance);
		return settings;
	});
	handle("app:trashUsage", (root: string) => backendFor(root).trashUsage());

	// Cartella scelta per i campi «Sfoglia…»: il renderer non vede il filesystem, chiede qui.
	handle("app:chooseFolder", async (title?: string, start?: string) => {
		if (!window) return null;
		const settings = await loadSettings();
		const result = await dialog.showOpenDialog(window, {
			title: title ?? "Scegli una cartella",
			properties: ["openDirectory", "createDirectory"],
			defaultPath: start || settings.defaultRoot || undefined,
		});
		return result.canceled ? null : result.filePaths[0] ?? null;
	});

	// Account: i metadati stanno su disco, i token solo in memoria (vedi accounts.ts).
	handle("accounts:list", () => accountsInfo());
	handle("accounts:save", (account: unknown, token?: string) =>
		saveAccount(account, token)
	);
	handle("accounts:remove", (id: string) => removeAccount(id));
	handle("accounts:repos", (id: string, page?: number) =>
		accountRepos(id, page)
	);

	// Account per repository: la scelta salvata (`repoAccounts`) e le regole di `chooseRepoAccount`.
	handle("repo:account", (root: string) => repoAccountChoice(root));
	handle("repo:account:set", (root: string, id: string | null) =>
		setRepoAccount(root, id)
	);

	// «Accedi» senza Client ID: prima si cerca un token già presente sulla macchina.
	handle("accounts:claim", (input: AccountInput) => claimAccount(input));

	// Fork e Actions: sono dati del provider, non del repository.
	handle("repo:forkInfo", (root: string) => forkInfo(root));
	handle("repo:forkBranches", (root: string) => forkBranches(root));
	handle("repo:forkPreview", (root: string, branch?: string) =>
		forkPreview(root, branch)
	);
	handle(
		"repo:syncFork",
		(root: string, mode: "merge" | "rebase", branch?: string) =>
			syncFork(root, mode, branch)
	);
	handle("actions:runs", (root: string) => listWorkflowRuns(root));
	handle("pulls:list", (root: string) => listPulls(root));
	handle("pulls:create", (root: string, input: NewPullRequest) =>
		createPull(root, input)
	);
	handle("pulls:checks", (root: string, sha: string) =>
		pullChecks(root, sha)
	);
	handle("pulls:comments", (root: string, number: number) =>
		pullComments(root, number)
	);
	handle(
		"pulls:comment",
		(root: string, number: number, body: string) =>
			addPullComment(root, number, body)
	);
	handle("actions:run", (root: string, id: string, action: WorkflowAction) =>
		runWorkflowAction(root, id, action)
	);

	// Accesso dal browser: il token resta nel main, la finestra riceve solo l'esito.
	handle("accounts:oauthStart", (input: AccountInput, clientId: string) =>
		startOAuth(input, clientId, (event) => broadcast(OAUTH_CHANNEL, event))
	);
	handle("accounts:oauthCancel", async () => cancelOAuth());

	// File e cartella: il renderer manda percorsi relativi, il main li verifica e tocca il sistema.
	handle("repo:openFolder", async (root: string) => {
		const failure = await shell.openPath(root);
		if (failure) throw new Error(failure);
	});

	handle("repo:openFile", async (root: string, path: string) => {
		const failure = await shell.openPath(resolveInside(root, path));
		if (failure) throw new Error(failure);
	});

	handle("repo:revealFile", async (root: string, path: string) => {
		shell.showItemInFolder(resolveInside(root, path));
	});

	handle(
		"repo:saveCopy",
		async (root: string, path: string, sha: string | null) => {
			const bytes = sha
				? await readCommitFile(root, sha, path)
				: await readWorkingFile(root, path);
			const settings = await loadSettings();
			const options: Electron.SaveDialogOptions = {
				title: "Salva una copia del file",
				defaultPath: join(
					settings.defaultRoot ?? app.getPath("downloads"),
					basename(path)
				),
				properties: ["showOverwriteConfirmation", "createDirectory"],
			};
			const result = window
				? await dialog.showSaveDialog(window, options)
				: await dialog.showSaveDialog(options);
			const destination = result.filePath;
			if (result.canceled || !destination) return null;
			await writeFile(destination, bytes);
			return destination;
		}
	);

	// Il file è relativo e non attendibile: `resolveInside` lo verifica. Il servizio arriva
	// dall'account scelto perché Gitea non si riconosce dall'host.
	handle(
		"repo:openFileInBrowser",
		async (root: string, path: string, ref?: string | null) => {
			const remote = await originRemote(root);
			const choice = await repoAccountChoice(root);
			const branch = ref || backendFor(root).info?.branch || "HEAD";
			const url = remote
				? fileWebUrl(remote, branch, path, choice.account?.provider)
				: null;
			if (!url)
				throw new Error(
					"Questo remoto non ha un indirizzo web per i file: serve un `origin` GitHub, GitLab, Bitbucket o Gitea."
				);
			await shell.openExternal(url);
		}
	);

	handle("repo:listFiles", (root: string, ref?: string | null) =>
		listRepoFiles(root, ref ?? null)
	);

	handle("repo:exportZip", async (root: string) => {
		const info = backendFor(root).info;
		const settings = await loadSettings();
		const options: Electron.SaveDialogOptions = {
			title: "Esporta HEAD in un archivio zip",
			defaultPath: join(
				settings.defaultRoot ?? app.getPath("downloads"),
				`${info?.name ?? "repository"}.zip`
			),
			properties: ["showOverwriteConfirmation", "createDirectory"],
		};
		const result = window
			? await dialog.showSaveDialog(window, options)
			: await dialog.showSaveDialog(options);
		const destination = result.filePath;
		if (result.canceled || !destination) return null;
		await exportArchive(root, destination);
		return destination;
	});

	handle("repo:openInBrowser", async (root: string) => {
		const web = remoteWeb((await originRemote(root)) ?? "");
		if (!web)
			throw new Error(
				"Il remoto «origin» non è un indirizzo web: non c'è niente da aprire nel browser."
			);
		await shell.openExternal(web.base);
	});

	handle("repo:openCommitInBrowser", async (root: string, sha: string) => {
		const url = commitWebUrl((await originRemote(root)) ?? "", sha);
		if (!url)
			throw new Error(
				"Questo remoto non ha un indirizzo web per i commit: serve un `origin` GitHub, GitLab, Bitbucket o Gitea."
			);
		await shell.openExternal(url);
	});

	handle("app:openExternal", async (url: string) => {
		// solo http/https, niente `file://` o schemi che lanciano programmi
		let parsed: URL;
		try {
			parsed = new URL(url);
		} catch {
			throw new Error(`Indirizzo non valido: ${url}`);
		}
		if (parsed.protocol !== "https:" && parsed.protocol !== "http:")
			throw new Error(
				`Si possono aprire solo indirizzi http o https: ${url}`
			);
		await shell.openExternal(parsed.toString());
	});

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

	// Il pannello dei dettagli può vivere in una finestra sua: la principale pubblica la
	// selezione, questa la rimanda a tutte le finestre (e la tiene per la prossima apertura).
	handle("panel:detach", async (root: string) => {
		backendFor(root);
		openPanelWindow(root);
		return true;
	});
	handle("panel:sync", async (root: string, input: unknown) => {
		lastPanelState = { ...(input as PanelState), root };
		broadcast(PANEL_STATE_CHANNEL, lastPanelState);
	});
}

function buildMenu(): void {
	Menu.setApplicationMenu(
		Menu.buildFromTemplate([
			{
				label: "GitHandler",
				submenu: [
					// Ctrl+R is the app's refresh: reloading the window from here would win over it
					{ role: "reload", accelerator: "CmdOrCtrl+Shift+R" },
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

/**
 * Finestra dei dettagli: stesso renderer, modalità `panel`. Non è figlia della principale, così
 * si può spostare, ridurre a icona e affiancare; quando si chiude il pannello torna al suo posto.
 */
function openPanelWindow(root: string): void {
	if (panelWindow && !panelWindow.isDestroyed()) {
		panelWindow.focus();
		return;
	}
	const created = new BrowserWindow({
		width: 900,
		height: 620,
		minWidth: 520,
		minHeight: 320,
		backgroundColor: windowBackground(currentAppearance),
		title: "GitHandler — dettagli",
		webPreferences: {
			preload: join(__dirname, "../preload/index.js"),
			contextIsolation: true,
			nodeIntegration: false,
			sandbox: true,
		},
	});
	panelWindow = created;
	applyWindowAppearance(created, currentAppearance);

	if (window) {
		const bounds = window.getBounds();
		const area = screen.getDisplayMatching(bounds).workArea;
		const x = Math.max(
			area.x,
			Math.min(bounds.x + bounds.width - 900, area.x + area.width - 900)
		);
		const y = Math.max(
			area.y + 32,
			Math.min(bounds.y + 48, area.y + area.height - 620)
		);
		created.setPosition(Math.round(x), Math.round(y));
	}

	created.loadFile(join(__dirname, "../renderer/index.html"), {
		query: {
			panel: "1",
			root,
			...(localeOverride ? { locale: localeOverride } : {}),
		},
	});

	// la selezione può essere già stata pubblicata prima che la finestra fosse pronta
	created.webContents.once("did-finish-load", () => {
		if (lastPanelState && !created.isDestroyed()) {
			created.webContents.send(PANEL_STATE_CHANNEL, lastPanelState);
		}
	});

	created.on("closed", () => {
		panelWindow = null;
		broadcast(PANEL_DETACHED_CHANNEL, { detached: false });
	});
	broadcast(PANEL_DETACHED_CHANNEL, { detached: true });
}

function createWindow(): void {
	window = new BrowserWindow({
		width: 1440,
		height: 900,
		minWidth: 900,
		minHeight: 560,
		backgroundColor: windowBackground(currentAppearance),
		show: false,
		title: "GitHandler",
		webPreferences: {
			preload: join(__dirname, "../preload/index.js"),
			contextIsolation: true,
			nodeIntegration: false,
			sandbox: true,
		},
	});

	applyWindowAppearance(window, currentAppearance);
	window.loadFile(
		join(__dirname, "../renderer/index.html"),
		localeOverride ? { query: { locale: localeOverride } } : undefined
	);

	window.once("ready-to-show", () => window?.show());

	if (shotsMode) {
		if (process.env.GITHANDLER_SHOTS_DEBUG === "1") {
			window.webContents.on(
				"console-message",
				(_event, level, message) => {
					process.stdout.write(`renderer[${level}]: ${message}\n`);
				}
			);
		}
		window.webContents.once("did-finish-load", () => void runShots());
	}

	window.on("closed", () => {
		stopWatching?.();
		stopWatching = null;
		window = null;
		// la finestra dei dettagli non ha senso senza quella principale
		panelWindow?.close();
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

	// La schermata di benvenuto e i dialoghi si vedono senza repository aperto: vengono prima.
	const startSteps: Array<[string, string | null]> = [
		["undefined", target.replace(/\.png$/, "-welcome.png")],
		[
			`(() => {
				document.getElementById("btn-welcome-create")?.click();
				document.getElementById("create-name").value = "nuovo-progetto";
				document.getElementById("create-user-name").value = "Mario Prova";
				document.getElementById("create-user-email").value = "mario@example.org";
			})()`,
			target.replace(/\.png$/, "-create.png"),
		],
		[
			`(() => {
				document.getElementById("create-dialog")?.close();
				document.getElementById("btn-welcome-clone")?.click();
				const url = document.getElementById("clone-url");
				url.value = "https://github.com/emaxlele/githandler.git";
				url.dispatchEvent(new Event("input", { bubbles: true }));
			})()`,
			target.replace(/\.png$/, "-clone.png"),
		],
		[
			`(() => {
				document.getElementById("clone-dialog")?.close();
				document.getElementById("btn-welcome-account")?.click();
			})()`,
			target.replace(/\.png$/, "-account.png"),
		],
		[`document.getElementById("account-dialog")?.close()`, null],
	];

	const steps: Array<[string, string | null]> = [
		[
			`document.querySelectorAll(".row")[2]?.click()`,
			target.replace(/\.png$/, "-commit.png"),
		],
		[
			`document.getElementById("side-changes")?.click();
			 document.querySelector("#changes-list-unstaged li")?.click();`,
			target.replace(/\.png$/, "-changes.png"),
		],
		[
			`document.getElementById("tab-tree")?.click();
			 document.querySelector("#tree-list .tree-node:last-child")?.click();`,
			target.replace(/\.png$/, "-tree.png"),
		],
		[
			`(() => {
				document.getElementById("btn-tree-mode")?.click();
				return new Promise((resolve) => setTimeout(resolve, 400));
			})()`,
			null,
		],
		[
			`(() => {
				const dir = [...document.querySelectorAll("#tree-list .tree-node")]
					.find((node) => node.dataset.dir === "true");
				dir?.click();
				return new Promise((resolve) => setTimeout(resolve, 500));
			})()`,
			target.replace(/\.png$/, "-tree-all.png"),
		],
		[
			`document.getElementById("tab-blame")?.click()`,
			target.replace(/\.png$/, "-blame.png"),
		],
		[
			`(() => {
				const input = document.getElementById("search-input");
				input.focus();
			})()`,
			target.replace(/\.png$/, "-search-hint.png"),
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
			`(() => {
				const row = document.querySelectorAll("#log .row")[3];
				if (!row) return;
				row.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, clientX: 320, clientY: 300 }));
			})()`,
			target.replace(/\.png$/, "-commit-menu.png"),
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
		[
			`(() => {
				document.getElementById("settings-dialog")?.close();
				document.dispatchEvent(new KeyboardEvent("keydown", { key: "k", ctrlKey: true, bubbles: true }));
				const input = document.getElementById("palette-input");
				input.value = "pull request";
				input.dispatchEvent(new Event("input", { bubbles: true }));
				input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
			})()`,
			target.replace(/\.png$/, "-pulls.png"),
		],
		[`document.getElementById("pulls-dialog")?.close()`, null],

		[
			`(() => {
				document.dispatchEvent(new KeyboardEvent("keydown", { key: "k", ctrlKey: true, bubbles: true }));
				const input = document.getElementById("palette-input");
				input.value = "reflog";
				input.dispatchEvent(new Event("input", { bubbles: true }));
				input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
			})()`,
			target.replace(/\.png$/, "-reflog.png"),
		],
		[`document.getElementById("reflog-dialog")?.close()`, null],
		[
			`(() => {
				document.dispatchEvent(new KeyboardEvent("keydown", { key: "k", ctrlKey: true, bubbles: true }));
				const input = document.getElementById("palette-input");
				input.value = "contenuto";
				input.dispatchEvent(new Event("input", { bubbles: true }));
				input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
			})()`,
			target.replace(/\.png$/, "-content.png"),
		],
		[
			`(() => {
				const field = document.getElementById("content-query");
				field.value = "export";
				document.getElementById("content-form").requestSubmit();
			})()`,
			target.replace(/\.png$/, "-content-results.png"),
		],
		[`document.getElementById("content-dialog")?.close()`, null],
		[
			`(() => {
				document.dispatchEvent(new KeyboardEvent("keydown", { key: "k", ctrlKey: true, bubbles: true }));
				const input = document.getElementById("palette-input");
				input.value = "salute";
				input.dispatchEvent(new Event("input", { bubbles: true }));
				input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
			})()`,
			target.replace(/\.png$/, "-health.png"),
		],
		[`document.getElementById("health-remotes")?.click()`, null],
		[
			`new Promise((resolve) => setTimeout(resolve, 900))`,
			target.replace(/\.png$/, "-health-remotes.png"),
		],
		[`document.getElementById("health-dialog")?.close()`, null],
		[
			`(() => {
				document.dispatchEvent(new KeyboardEvent("keydown", { key: "k", ctrlKey: true, bubbles: true }));
				const input = document.getElementById("palette-input");
				input.value = "recupero";
				input.dispatchEvent(new Event("input", { bubbles: true }));
				input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
			})()`,
			target.replace(/\.png$/, "-recovery.png"),
		],
		[`document.getElementById("recovery-dialog")?.close()`, null],
		[
			`(() => {
				document.dispatchEvent(new KeyboardEvent("keydown", { key: "k", ctrlKey: true, bubbles: true }));
				const input = document.getElementById("palette-input");
				input.value = "worktree";
				input.dispatchEvent(new Event("input", { bubbles: true }));
				input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
			})()`,
			target.replace(/\.png$/, "-worktree.png"),
		],
		[`document.getElementById("worktree-dialog")?.close()`, null],
		[
			`(() => {
				// il commit in testa al ramo: un commit di un altro ramo non è riscrivibile
				document.querySelectorAll(".row")[3]?.click();
				return new Promise((resolve) => setTimeout(resolve, 300));
			})()`,
			null,
		],
		[
			`(() => {
				document.dispatchEvent(new KeyboardEvent("keydown", { key: "k", ctrlKey: true, bubbles: true }));
				const input = document.getElementById("palette-input");
				input.value = "rebase interattivo";
				input.dispatchEvent(new Event("input", { bubbles: true }));
				input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
				return new Promise((resolve) => setTimeout(resolve, 700));
			})()`,
			target.replace(/\.png$/, "-rebase.png"),
		],
		[
			`(() => {
				const select = document.querySelector('#rebase-list select[data-rebase-action="1"]');
				if (select) {
					select.value = "reword";
					select.dispatchEvent(new Event("change", { bubbles: true }));
				}
				const area = document.querySelector('textarea[data-rebase-message="1"]');
				if (area) area.value = "feat: tema scuro\\n\\nCorpo riscritto dall'interfaccia.";
				return new Promise((resolve) => setTimeout(resolve, 300));
			})()`,
			target.replace(/\.png$/, "-rebase-reword.png"),
		],
		[`document.getElementById("rebase-dialog")?.close()`, null],
		[
			`(() => {
				document.dispatchEvent(new KeyboardEvent("keydown", { key: "k", ctrlKey: true, bubbles: true }));
				const input = document.getElementById("palette-input");
				input.value = "vai al commit";
				input.dispatchEvent(new Event("input", { bubbles: true }));
				input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
				const field = document.getElementById("input-field");
				field.value = "ee3e984";
				document.getElementById("input-form").requestSubmit();
			})()`,
			target.replace(/\.png$/, "-goto.png"),
		],
		[
			`(() => {
				document.dispatchEvent(new KeyboardEvent("keydown", { key: "k", ctrlKey: true, bubbles: true }));
			})()`,
			target.replace(/\.png$/, "-palette.png"),
		],
		[
			`(() => {
				const input = document.getElementById("palette-input");
				input.value = "ram";
				input.dispatchEvent(new Event("input", { bubbles: true }));
			})()`,
			target.replace(/\.png$/, "-palette-search.png"),
		],
		[
			`(() => {
				const input = document.getElementById("palette-input");
				input.value = "terminale";
				input.dispatchEvent(new Event("input", { bubbles: true }));
				input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
			})()`,
			target.replace(/\.png$/, "-palette-run.png"),
		],
		[
			`(() => {
				document.getElementById("palette-dialog")?.close();
				document.dispatchEvent(new KeyboardEvent("keydown", { key: "?", bubbles: true }));
			})()`,
			target.replace(/\.png$/, "-keys.png"),
		],
		[`document.getElementById("keys-dialog")?.close()`, null],
	];

	try {
		await wait(1500);
		const shoot = async (
			script: string,
			file: string | null
		): Promise<void> => {
			if (script !== "undefined") {
				const result = await window!.webContents
					.executeJavaScript(script)
					.catch((error) => `errore: ${cleanError(error)}`);
				if (process.env.GITHANDLER_SHOTS_DEBUG === "1")
					process.stdout.write(`debug: ${String(result)}\n`);
			}
			await wait(900);
			if (!file) return;
			const image = await window!.webContents.capturePage();
			await writeFile(file, image.toPNG());
			process.stdout.write(`screenshot: ${file}\n`);
		};

		for (const [script, file] of startSteps) await shoot(script, file);

		// Senza `--repo` la finestra resta sul benvenuto: gli screenshot del repository non hanno senso.
		const empty = await window.webContents
			.executeJavaScript(`document.body.classList.contains("is-empty")`)
			.catch(() => true);
		if (empty) return;
		for (const [script, file] of steps) await shoot(script, file);

		// Il dialogo dei conflitti si prova solo su un repository che ne ha davvero uno: lo
		// scenario si attiva con GITHANDLER_SHOTS_CONFLICT=1 e un ramo chiamato `conflitto`.
		if (process.env.GITHANDLER_SHOTS_CONFLICT === "1") {
			await shoot(
				`(() => {
					document.getElementById("settings-dialog")?.close();
					window.confirm = () => true;
				})()`,
				null
			);
			await shoot(
				`(() => {
					const item = [...document.querySelectorAll("#list-branches li")]
						.find((node) => node.textContent?.includes("conflitto"));
					item?.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, clientX: 230, clientY: 300 }));
				})()`,
				null
			);
			await shoot(
				`(() => {
					const entry = [...document.querySelectorAll("#ctx-menu .ctx-item")]
						.find((node) => (node.textContent ?? "").startsWith("Merge"));
					entry?.click();
				})()`,
				null
			);
			await shoot(
				`new Promise((resolve) => setTimeout(resolve, 2000))`,
				target.replace(/\.png$/, "-conflict.png")
			);
			// Risoluzione dall'interfaccia: scelta per hunk, salvataggio, «segna risolto»,
			// scelta per file e «continua» fino al commit di merge.
			await shoot(
				`(() => {
					document.querySelector('input[name="conflict-hunk-0"][value="theirs"]')?.click();
					document.getElementById("conflict-apply-hunks")?.click();
				})()`,
				null
			);
			await shoot(
				`document.getElementById("conflict-save")?.click()`,
				null
			);
			await shoot(
				`document.getElementById("conflict-mark")?.click()`,
				target.replace(/\.png$/, "-conflict-marked.png")
			);
			await shoot(
				`document.getElementById("conflict-use-theirs")?.click()`,
				null
			);
			await shoot(
				`(() => {
					const button = document.getElementById("conflict-continue");
					if (button?.disabled) return console.error("continua disabilitato");
					button?.click();
				})()`,
				target.replace(/\.png$/, "-conflict-done.png")
			);
		}
	} catch (error) {
		process.stderr.write(`screenshot fallito: ${cleanError(error)}\n`);
	} finally {
		app.quit();
	}
}

let ciNotifier: CiNotifier | null = null;

/** Riporta la finestra davanti; se non c'è più la ricrea. */
function showWindow(): void {
	if (!window || window.isDestroyed()) {
		createWindow();
		return;
	}
	if (window.isMinimized()) window.restore();
	window.show();
	window.focus();
}

app.whenReady().then(async () => {
	currentAppearance = await readAppearance();
	applyAppearance(currentAppearance);
	registerIpc();
	buildMenu();
	createWindow();
	// i token già presenti sulla macchina tornano in memoria: nessun «Accedi» dopo un riavvio
	if (!shotsMode) void hydrateTokens();
	if (!shotsMode)
		void startCiNotifier({
			getRoot: () => activeRoot,
			showWindow,
		}).then((notifier) => {
			ciNotifier = notifier;
		});

	app.on("activate", () => {
		if (BrowserWindow.getAllWindows().length === 0) createWindow();
	});
});

app.on("before-quit", () => {
	ciNotifier?.stop();
	ciNotifier = null;
});

app.on("window-all-closed", () => {
	if (process.platform !== "darwin") app.quit();
});
