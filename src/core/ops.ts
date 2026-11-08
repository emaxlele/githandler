/**
 * Costruttori di argomenti per le operazioni che toccano il remoto e i rami.
 * Come nel resto del core: funzioni pure, testabili senza repository, con i controlli sui nomi che
 * Git accetterebbe a fatica (`--upload-pack=…` in un nome ramo non deve diventare un'opzione).
 */

import type { StashEntry, SubmoduleInfo, SubmoduleState } from "./types.ts";

/** Nome di ref accettabile: niente opzioni, spazi, sequenze riservate o caratteri di glob. */
export function assertRefName(name: string): void {
	if (
		!name ||
		name.startsWith("-") ||
		/\s/.test(name) ||
		name.includes("..") ||
		name.includes("@{") ||
		/[~^:?*[\\]/.test(name) ||
		name.endsWith("/") ||
		name.endsWith(".lock")
	) {
		throw new Error(`Nome di ref non valido: ${name}`);
	}
}

/**
 * Pull senza sorprese: solo fast-forward. Un ramo divergente si ferma con il messaggio di Git
 * invece di creare un merge che l'utente non ha chiesto.
 */
export function pullArgs(): string[] {
	return ["pull", "--ff-only"];
}

/**
 * Push senza forza. Senza upstream il primo push crea il tracking su `origin`, altrimenti Git
 * risponderebbe "no upstream branch" e l'utente dovrebbe uscire dall'app.
 */
export function pushArgs(
	branch: string | null,
	hasUpstream: boolean
): string[] {
	if (hasUpstream) return ["push"];
	if (!branch)
		throw new Error(
			"HEAD staccato: fai checkout di un ramo prima di pushare."
		);
	assertRefName(branch);
	return ["push", "--set-upstream", "origin", branch];
}

export function mergeArgs(branch: string): string[] {
	assertRefName(branch);
	return ["merge", "--no-edit", "--", branch];
}

export function rebaseArgs(onto: string): string[] {
	assertRefName(onto);
	return ["rebase", "--", onto];
}

export function cherryPickArgs(sha: string): string[] {
	if (!/^[0-9a-f]{7,64}$/.test(sha))
		throw new Error(`SHA non valido: ${sha}`);
	return ["cherry-pick", "--", sha];
}

export function renameBranchArgs(from: string, to: string): string[] {
	assertRefName(from);
	assertRefName(to);
	return ["branch", "-m", from, to];
}

export function deleteBranchArgs(name: string, force: boolean): string[] {
	assertRefName(name);
	return ["branch", force ? "-D" : "-d", name];
}

/** Ramo locale con tracking da un ref remoto: `origin/feature/x` → `feature/x`. */
export function checkoutTrackingArgs(
	remoteRef: string,
	local: string
): string[] {
	assertRefName(local);
	if (!remoteRef || remoteRef.startsWith("-") || /\s/.test(remoteRef))
		throw new Error(`Ref remoto non valido: ${remoteRef}`);
	return ["switch", "--track", "-c", local, remoteRef];
}

/** Nome locale proposto per un ref remoto: `origin/feature/x` → `feature/x`. */
export function localNameForRemote(remoteRef: string): string {
	const slash = remoteRef.indexOf("/");
	const name = slash >= 0 ? remoteRef.slice(slash + 1) : remoteRef;
	if (!name) throw new Error(`Ref remoto non valido: ${remoteRef}`);
	return name;
}

/** `git stash list`: posizione, sha, data e messaggio. */
export const STASH_FORMAT = "%gd%x00%H%x00%ct%x00%gs%x1e";

export function stashListArgs(): string[] {
	return ["stash", "list", `--format=${STASH_FORMAT}`];
}

export function stashSaveArgs(message: string): string[] {
	const args = ["stash", "push", "--include-untracked"];
	const subject = message.trim();
	if (subject) args.push("-m", subject);
	return args;
}

export function stashApplyArgs(index: number, drop: boolean): string[] {
	assertStashIndex(index);
	return ["stash", drop ? "pop" : "apply", `stash@{${index}}`];
}

export function stashDropArgs(index: number): string[] {
	assertStashIndex(index);
	return ["stash", "drop", `stash@{${index}}`];
}

function assertStashIndex(index: number): void {
	if (!Number.isInteger(index) || index < 0)
		throw new Error(`Indice dello stash non valido: ${index}`);
}

export function parseStashList(raw: string): StashEntry[] {
	const entries: StashEntry[] = [];
	for (const chunk of raw.split("\x1e")) {
		const record = chunk.replace(/^\n+/, "");
		if (!record) continue;
		const fields = record.split("\x00");
		if (fields.length < 4) continue;
		const [ref, sha, created, message] = fields as [
			string,
			string,
			string,
			string
		];
		const position = /^stash@\{(\d+)\}$/.exec(ref);
		const timestamp = Number(created);
		if (!position || !Number.isFinite(timestamp)) continue;
		entries.push({
			index: Number(position[1]),
			sha,
			message,
			branch: /^(?:WIP on|On) ([^:]+):/.exec(message)?.[1] ?? null,
			timestamp,
		});
	}
	return entries;
}

/** `git submodule status`: primo carattere lo stato, poi sha, path e descrizione fra parentesi. */
export function parseSubmodules(raw: string): SubmoduleInfo[] {
	const modules: SubmoduleInfo[] = [];
	for (const line of raw.split("\n")) {
		const match =
			/^([ +\-U])([0-9a-f]{7,64})\s+(.+?)(?:\s+\((.*)\))?$/.exec(line);
		if (!match) continue;
		const [, flag, sha, path, description] = match;
		const state: SubmoduleState =
			flag === "+"
				? "modified"
				: flag === "-"
				? "uninitialized"
				: flag === "U"
				? "conflict"
				: "clean";
		modules.push({ path, sha, state, description: description ?? null });
	}
	return modules;
}
