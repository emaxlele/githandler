import { contextBridge, ipcRenderer } from "electron";

import type { GitApi } from "../shared/api.ts";
import {
	CHANGED_CHANNEL,
	DRAG_CHANNEL,
	NETWORK_CHANNEL,
	OAUTH_CHANNEL,
	PANEL_DETACHED_CHANNEL,
	PANEL_STATE_CHANNEL,
	TERMINAL_CHANNEL,
	type NetworkEvent,
	type OAuthEvent,
	type PanelState,
	type RepoChangeEvent,
	type TerminalEvent,
} from "../shared/api.ts";

/**
 * Le chiamate valgono per il repository attivo. Il root viaggia come primo argomento e non lo sceglie
 * il renderer a ogni richiesta: `open` e `use` lo impostano, così una scheda non può leggere per
 * sbaglio i dati di un'altra.
 */
let currentRoot: string | null = null;

function invokeRepo<T>(channel: string, ...args: unknown[]): Promise<T> {
	if (!currentRoot)
		return Promise.reject(new Error("Nessun repository aperto."));
	return ipcRenderer.invoke(channel, currentRoot, ...args);
}

const api: GitApi = {
	open: async (path, interactive = true) => {
		const snapshot = await ipcRenderer.invoke(
			"git:open",
			path,
			interactive
		);
		if (snapshot) currentRoot = snapshot.info.root;
		return snapshot;
	},
	use: async (root) => {
		await ipcRenderer.invoke("git:use", root);
		currentRoot = root;
	},
	refresh: () => invokeRepo("git:refresh"),
	commitDetails: (sha) => invokeRepo("git:commitDetails", sha),
	commitFiles: (sha) => invokeRepo("git:commitFiles", sha),
	commitStat: (sha) => invokeRepo("git:commitStat", sha),
	commitPatch: (sha, path) => invokeRepo("git:commitPatch", sha, path),
	worktreePatch: (path, staged) =>
		invokeRepo("git:worktreePatch", path, staged),
	stage: (paths) => invokeRepo("git:stage", paths),
	applyPatch: (path, patch, mode) =>
		invokeRepo("git:applyPatch", path, patch, mode),
	unstage: (paths) => invokeRepo("git:unstage", paths),
	discard: (paths) => invokeRepo("git:discard", paths),
	commit: (message, all, sign) =>
		invokeRepo("git:commit", message, all, sign),
	checkout: (branch) => invokeRepo("git:checkout", branch),
	createBranch: (name) => invokeRepo("git:createBranch", name),
	fetch: () => invokeRepo("git:fetch"),
	pull: () => invokeRepo("git:pull"),
	push: () => invokeRepo("git:push"),
	stashList: () => invokeRepo("git:stashList"),
	stashSave: (message, paths) => invokeRepo("git:stashSave", message, paths),
	stashApply: (index, drop) => invokeRepo("git:stashApply", index, drop),
	stashDrop: (index) => invokeRepo("git:stashDrop", index),
	submodules: () => invokeRepo("git:submodules"),
	updateSubmodules: () => invokeRepo("git:updateSubmodules"),
	merge: (branch) => invokeRepo("git:merge", branch),
	rebase: (onto) => invokeRepo("git:rebase", onto),
	cherryPick: (sha) => invokeRepo("git:cherryPick", sha),
	createBranchAt: (name, sha) => invokeRepo("git:createBranchAt", name, sha),
	checkoutCommit: (sha) => invokeRepo("git:checkoutCommit", sha),
	closeRepo: async (root) => {
		await ipcRenderer.invoke("git:close", root);
		if (currentRoot === root) currentRoot = null;
	},
	initRepo: async (path, identity) => {
		const snapshot: Awaited<ReturnType<GitApi["initRepo"]>> =
			await ipcRenderer.invoke("repo:init", path, identity);
		currentRoot = snapshot.info.root;
		return snapshot;
	},
	cloneRepo: async (url, dest) => {
		const snapshot: Awaited<ReturnType<GitApi["cloneRepo"]>> =
			await ipcRenderer.invoke("repo:clone", url, dest);
		currentRoot = snapshot.info.root;
		return snapshot;
	},
	chooseFolder: (title, start) =>
		ipcRenderer.invoke("app:chooseFolder", title, start),
	accounts: () => ipcRenderer.invoke("accounts:list"),
	saveAccount: (account, token) =>
		ipcRenderer.invoke("accounts:save", account, token),
	removeAccount: (id) => ipcRenderer.invoke("accounts:remove", id),
	accountRepos: (id, page) => ipcRenderer.invoke("accounts:repos", id, page),
	claimAccount: (input) => ipcRenderer.invoke("accounts:claim", input),
	repoAccount: () => invokeRepo("repo:account"),
	setRepoAccount: (id) => invokeRepo("repo:account:set", id),
	forkInfo: () => invokeRepo("repo:forkInfo"),
	forkBranches: () => invokeRepo("repo:forkBranches"),
	forkPreview: (branch) => invokeRepo("repo:forkPreview", branch),
	syncFork: (mode, branch) => invokeRepo("repo:syncFork", mode, branch),
	workflowRuns: () => invokeRepo("actions:runs"),
	workflowRunAction: (id, action) => invokeRepo("actions:run", id, action),
	workflows: () => invokeRepo("actions:workflows"),
	dispatchWorkflow: (id, ref, inputs) =>
		invokeRepo("actions:dispatch", id, ref, inputs),
	pullRequests: () => invokeRepo("pulls:list"),
	createPullRequest: (input) => invokeRepo("pulls:create", input),
	pullChecks: (sha) => invokeRepo("pulls:checks", sha),
	pullComments: (number) => invokeRepo("pulls:comments", number),
	addPullComment: (number, body) => invokeRepo("pulls:comment", number, body),
	pullReviews: (number) => invokeRepo("pulls:reviews", number),
	approvePull: (number) => invokeRepo("pulls:approve", number),
	requestPullChanges: (number, message) =>
		invokeRepo("pulls:request-changes", number, message),
	withdrawPullApproval: (number) =>
		invokeRepo("pulls:withdraw-approval", number),
	listRepoFiles: (ref) => invokeRepo("repo:listFiles", ref),
	exportZip: () => invokeRepo("repo:exportZip"),
	openFileInBrowser: (path, ref) =>
		invokeRepo("repo:openFileInBrowser", path, ref),
	openRepoFolder: (root) => ipcRenderer.invoke("repo:openFolder", root),
	openFile: (root, path) => ipcRenderer.invoke("repo:openFile", root, path),
	revealFile: (root, path) =>
		ipcRenderer.invoke("repo:revealFile", root, path),
	saveCopy: (root, path, sha) =>
		ipcRenderer.invoke("repo:saveCopy", root, path, sha),
	openInBrowser: (root) => ipcRenderer.invoke("repo:openInBrowser", root),
	openCommitInBrowser: (root, sha) =>
		ipcRenderer.invoke("repo:openCommitInBrowser", root, sha),
	openExternal: (url) => ipcRenderer.invoke("app:openExternal", url),
	oauthStart: (input, clientId) =>
		ipcRenderer.invoke("accounts:oauthStart", input, clientId),
	oauthCancel: () => ipcRenderer.invoke("accounts:oauthCancel"),
	onOauth: (listener) => {
		const handler = (
			_event: Electron.IpcRendererEvent,
			event: OAuthEvent
		): void => listener(event);
		ipcRenderer.on(OAUTH_CHANNEL, handler);
		return () => {
			ipcRenderer.removeListener(OAUTH_CHANNEL, handler);
		};
	},
	reset: (sha, mode) => invokeRepo("git:reset", sha, mode),
	renameBranch: (from, to) => invokeRepo("git:renameBranch", from, to),
	deleteBranch: (name, force) => invokeRepo("git:deleteBranch", name, force),
	checkoutTracking: (remoteRef, local) =>
		invokeRepo("git:checkoutTracking", remoteRef, local),
	abortOperation: () => invokeRepo("git:abortOperation"),
	conflicts: () => invokeRepo("git:conflicts"),
	conflictDetail: (path) => invokeRepo("git:conflictDetail", path),
	resolveConflictFile: (path, side) =>
		invokeRepo("git:resolveConflictFile", path, side),
	writeResolvedFile: (path, text) =>
		invokeRepo("git:writeResolvedFile", path, text),
	markResolved: (paths) => invokeRepo("git:markResolved", paths),
	continueOperation: () => invokeRepo("git:continueOperation"),
	search: (query) => invokeRepo("git:search", query),
	searchContent: (query) => invokeRepo("git:searchContent", query),
	reflog: (limit) => invokeRepo("git:reflog", limit),
	moreCommits: (skip) => invokeRepo("git:moreCommits", skip),
	blame: (path, start, end) => invokeRepo("git:blame", path, start, end),
	undo: () => invokeRepo("git:undo"),
	commitTemplate: () => invokeRepo("git:commitTemplate"),
	health: () => invokeRepo("git:health"),
	remoteChecks: () => invokeRepo("git:remoteChecks"),
	worktrees: () => invokeRepo("git:worktrees"),
	createWorktree: (path, branch) =>
		invokeRepo("git:createWorktree", path, branch),
	removeWorktree: (path) => invokeRepo("git:removeWorktree", path),
	treeEntries: (ref, path) => invokeRepo("git:treeEntries", ref, path),
	rebaseCandidates: (from) => invokeRepo("git:rebaseCandidates", from),
	rebaseInteractive: (base, steps, head) =>
		invokeRepo("git:rebaseInteractive", base, steps, head),
	settings: () => ipcRenderer.invoke("app:settings"),
	saveSettings: (settings) =>
		ipcRenderer.invoke("app:settings:save", settings),
	trashUsage: () => invokeRepo("app:trashUsage"),
	watching: () => ipcRenderer.invoke("app:watching"),
	onChanged: (listener) => {
		const handler = (
			_event: Electron.IpcRendererEvent,
			event: RepoChangeEvent
		): void => listener(event);
		ipcRenderer.on(CHANGED_CHANNEL, handler);
		return () => {
			ipcRenderer.removeListener(CHANGED_CHANNEL, handler);
		};
	},
	terminalRun: (id, command) => invokeRepo("term:run", id, command),
	terminalKill: (id) => ipcRenderer.invoke("term:kill", id),
	onTerminal: (listener) => {
		const handler = (
			_event: Electron.IpcRendererEvent,
			event: TerminalEvent
		): void => listener(event);
		ipcRenderer.on(TERMINAL_CHANNEL, handler);
		return () => {
			ipcRenderer.removeListener(TERMINAL_CHANNEL, handler);
		};
	},
	onNetwork: (listener) => {
		const handler = (
			_event: Electron.IpcRendererEvent,
			event: NetworkEvent
		): void => listener(event);
		ipcRenderer.on(NETWORK_CHANNEL, handler);
		return () => {
			ipcRenderer.removeListener(NETWORK_CHANNEL, handler);
		};
	},
	startDrag: (root, path) => ipcRenderer.send(DRAG_CHANNEL, root, path),
	detachPanel: () => invokeRepo("panel:detach"),
	syncPanel: (panel) => invokeRepo("panel:sync", panel),
	onPanelState: (listener) => {
		const handler = (
			_event: Electron.IpcRendererEvent,
			state: PanelState
		): void => listener(state);
		ipcRenderer.on(PANEL_STATE_CHANNEL, handler);
		return () => {
			ipcRenderer.removeListener(PANEL_STATE_CHANNEL, handler);
		};
	},
	onPanelDetached: (listener) => {
		const handler = (
			_event: Electron.IpcRendererEvent,
			payload: { detached: boolean }
		): void => listener(payload.detached);
		ipcRenderer.on(PANEL_DETACHED_CHANNEL, handler);
		return () => {
			ipcRenderer.removeListener(PANEL_DETACHED_CHANNEL, handler);
		};
	},
};

contextBridge.exposeInMainWorld("githandler", api);
