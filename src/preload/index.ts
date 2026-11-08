import { contextBridge, ipcRenderer } from "electron";

import type { GitApi } from "../shared/api.ts";

const api: GitApi = {
	open: (path) => ipcRenderer.invoke("git:open", path),
	refresh: () => ipcRenderer.invoke("git:refresh"),
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
};

contextBridge.exposeInMainWorld("gitcraft", api);
