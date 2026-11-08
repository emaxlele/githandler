import { contextBridge, ipcRenderer } from "electron";

import type { GitApi } from "../shared/api.ts";
import { CHANGED_CHANNEL, type RepoChangeEvent } from "../shared/api.ts";

const api: GitApi = {
	open: (path) => ipcRenderer.invoke("git:open", path),
	refresh: () => ipcRenderer.invoke("git:refresh"),
	commitDetails: (sha) => ipcRenderer.invoke("git:commitDetails", sha),
	commitFiles: (sha) => ipcRenderer.invoke("git:commitFiles", sha),
	commitPatch: (sha, path) =>
		ipcRenderer.invoke("git:commitPatch", sha, path),
	worktreePatch: (path, staged) =>
		ipcRenderer.invoke("git:worktreePatch", path, staged),
	stage: (paths) => ipcRenderer.invoke("git:stage", paths),
	applyPatch: (path, patch, mode) =>
		ipcRenderer.invoke("git:applyPatch", path, patch, mode),
	unstage: (paths) => ipcRenderer.invoke("git:unstage", paths),
	discard: (paths) => ipcRenderer.invoke("git:discard", paths),
	commit: (message, all) => ipcRenderer.invoke("git:commit", message, all),
	checkout: (branch) => ipcRenderer.invoke("git:checkout", branch),
	createBranch: (name) => ipcRenderer.invoke("git:createBranch", name),
	fetch: () => ipcRenderer.invoke("git:fetch"),
	search: (query) => ipcRenderer.invoke("git:search", query),
	moreCommits: (skip) => ipcRenderer.invoke("git:moreCommits", skip),
	blame: (path, start, end) =>
		ipcRenderer.invoke("git:blame", path, start, end),
	undo: () => ipcRenderer.invoke("git:undo"),
	settings: () => ipcRenderer.invoke("app:settings"),
	saveSettings: (settings) =>
		ipcRenderer.invoke("app:settings:save", settings),
	trashUsage: () => ipcRenderer.invoke("app:trashUsage"),
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
};

contextBridge.exposeInMainWorld("githandler", api);
