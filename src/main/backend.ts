import { rm } from "node:fs/promises";
import { basename, join } from "node:path";

import {
	commitDiffArgs,
	commitFilesArgs,
	parseDiff,
	parseNameStatus,
	worktreeDiffArgs,
} from "../core/diff.ts";
import { layoutGraph } from "../core/graph.ts";
import {
	attachRefs,
	logArgs,
	parseLog,
	parseRefs,
	refsArgs,
} from "../core/log.ts";
import { parseStatus, statusArgs } from "../core/status.ts";
import type {
	CommitFile,
	DiffFile,
	RepoInfo,
	Snapshot,
} from "../core/types.ts";
import { GitError, runGit } from "./git.ts";

/**
 * Unico punto in cui l'applicazione tocca il disco.
 *
 * Oggi l'implementazione è il binario `git`: compatibilità totale per costruzione (hooks, LFS,
 * credential helper, filtri, `skip-worktree`). Se un giorno le letture calde misurate lo
 * richiederanno, arriverà una `Libgit2Backend` dietro questa stessa interfaccia — non un refactor
 * dell'app.
 */
export interface GitBackend {
	open(dir: string): Promise<Snapshot>;
	refresh(): Promise<Snapshot>;
	commitFiles(sha: string): Promise<CommitFile[]>;
	commitPatch(sha: string, path: string): Promise<DiffFile>;
	worktreePatch(path: string, staged: boolean): Promise<DiffFile>;
	stage(paths: string[]): Promise<Snapshot>;
	unstage(paths: string[]): Promise<Snapshot>;
	discard(paths: string[]): Promise<Snapshot>;
	commit(message: string, all: boolean): Promise<Snapshot>;
	checkout(branch: string): Promise<Snapshot>;
	createBranch(name: string): Promise<Snapshot>;
	fetch(): Promise<Snapshot>;
}

/** Rifiuta path che possano uscire dal repository o diventare opzioni per git. */
function assertSafePath(path: string): void {
	if (
		!path ||
		path.startsWith("/") ||
		path.startsWith("-") ||
		path.split("/").includes("..")
	) {
		throw new Error(`Percorso non valido: ${path}`);
	}
}

export class CliGitBackend implements GitBackend {
	#info: RepoInfo | null = null;

	async open(dir: string): Promise<Snapshot> {
		const top = await runGit(dir, ["rev-parse", "--show-toplevel"]);
		const root = top.stdout.trim();
		const gitDir = (
			await runGit(root, ["rev-parse", "--absolute-git-dir"])
		).stdout.trim();
		const head = await runGit(
			root,
			["symbolic-ref", "--short", "-q", "HEAD"],
			{
				allowFailure: true,
			}
		);
		const branch = head.code === 0 ? head.stdout.trim() : null;

		this.#info = {
			root,
			gitDir,
			name: basename(root),
			branch,
			detached: branch === null,
		};
		return this.refresh();
	}

	async refresh(): Promise<Snapshot> {
		const info = this.#requireInfo();

		const [log, refs, status] = await Promise.all([
			runGit(info.root, logArgs(), { allowFailure: true }),
			runGit(info.root, refsArgs(), { allowFailure: true }),
			runGit(info.root, statusArgs(), { allowFailure: true }),
		]);

		const commits = parseLog(log.stdout);
		const refList = parseRefs(refs.stdout);
		attachRefs(commits, refList);

		const head = refList.find((ref) => ref.kind === "local" && ref.current);
		this.#info = {
			...info,
			branch: head?.short ?? (info.detached ? null : info.branch),
		};

		return {
			info: this.#info,
			commits,
			graph: layoutGraph(commits),
			refs: refList,
			status: parseStatus(status.stdout),
		};
	}

	async commitFiles(sha: string): Promise<CommitFile[]> {
		const info = this.#requireInfo();
		const result = await runGit(info.root, commitFilesArgs(sha));
		return parseNameStatus(result.stdout);
	}

	async commitPatch(sha: string, path: string): Promise<DiffFile> {
		const info = this.#requireInfo();
		assertSafePath(path);

		const parent = await runGit(info.root, ["rev-parse", `${sha}^`], {
			allowFailure: true,
		});
		const parentSha = parent.code === 0 ? parent.stdout.trim() : null;
		const result = await runGit(
			info.root,
			commitDiffArgs(sha, parentSha, path)
		);
		return parseDiff(result.stdout, path);
	}

	async worktreePatch(path: string, staged: boolean): Promise<DiffFile> {
		const info = this.#requireInfo();
		assertSafePath(path);

		const result = await runGit(info.root, worktreeDiffArgs(staged, path), {
			allowFailure: true,
		});
		let raw = result.stdout;

		// I file non tracciati non compaiono in `git diff`: `--no-index` produce la patch completa.
		if (!staged && !raw.trim()) {
			const noIndex = await runGit(
				info.root,
				["diff", "--no-color", "--no-index", "--", "/dev/null", path],
				{ allowFailure: true }
			);
			if (noIndex.stdout.trim()) raw = noIndex.stdout;
		}

		return parseDiff(raw, path);
	}

	async stage(paths: string[]): Promise<Snapshot> {
		const info = this.#requireInfo();
		paths.forEach(assertSafePath);
		await runGit(info.root, ["add", "--", ...paths]);
		return this.refresh();
	}

	async unstage(paths: string[]): Promise<Snapshot> {
		const info = this.#requireInfo();
		paths.forEach(assertSafePath);
		try {
			await runGit(info.root, ["restore", "--staged", "--", ...paths]);
		} catch (error) {
			// Repository senza HEAD (primo commit): `restore --staged` non ha un albero di partenza.
			if (!(error instanceof GitError)) throw error;
			await runGit(info.root, [
				"rm",
				"--cached",
				"-r",
				"--quiet",
				"--",
				...paths,
			]);
		}
		return this.refresh();
	}

	async discard(paths: string[]): Promise<Snapshot> {
		const info = this.#requireInfo();
		paths.forEach(assertSafePath);

		const status = await this.refresh();
		const untracked = new Set(
			status.status.entries
				.filter((entry) => entry.kind === "untracked")
				.map((entry) => entry.path)
		);
		const toDelete = paths.filter((path) => untracked.has(path));
		const toRestore = paths.filter((path) => !untracked.has(path));

		if (toRestore.length > 0)
			await runGit(info.root, ["restore", "--", ...toRestore]);
		for (const path of toDelete) {
			await rm(join(info.root, path), { force: true, recursive: true });
		}

		return this.refresh();
	}

	async commit(message: string, all: boolean): Promise<Snapshot> {
		const info = this.#requireInfo();
		if (!message.trim()) throw new Error("Il messaggio di commit è vuoto.");

		const args = ["commit", "-F", "-"];
		if (all) args.splice(1, 0, "-a");
		await runGit(info.root, args, { input: message });
		return this.refresh();
	}

	async checkout(branch: string): Promise<Snapshot> {
		const info = this.#requireInfo();
		await runGit(info.root, ["switch", branch]);
		return this.refresh();
	}

	async createBranch(name: string): Promise<Snapshot> {
		const info = this.#requireInfo();
		if (!/^\S(.*\S)?$/.test(name))
			throw new Error(`Nome branch non valido: ${name}`);
		await runGit(info.root, ["switch", "-c", name]);
		return this.refresh();
	}

	async fetch(): Promise<Snapshot> {
		const info = this.#requireInfo();
		await runGit(info.root, ["fetch", "--all", "--prune"], {
			timeoutMs: 120_000,
		});
		return this.refresh();
	}

	#requireInfo(): RepoInfo {
		if (!this.#info) throw new Error("Nessun repository aperto.");
		return this.#info;
	}
}
