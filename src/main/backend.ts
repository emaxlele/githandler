import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { basename, dirname, join } from "node:path";

import { blameArgs, parseBlame, type BlameFile } from "../core/blame.ts";
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
	LOG_FORMAT,
	parseLog,
	parseRefs,
	refsArgs,
} from "../core/log.ts";
import { parseStatus, statusArgs } from "../core/status.ts";
import { patchTargetsOnly, type PatchMode } from "../core/patch.ts";
import { historyArgs, parseHistoryQuery } from "../core/search.ts";
import {
	parseUndoLog,
	serializeUndoLog,
	snapshotRef,
	UNDO_LIMIT,
	undoId,
	type UndoEntry,
	type UndoKind,
} from "../core/undo.ts";
import type {
	Commit,
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
	/** Applica all'indice una patch parziale (hunk o righe) costruita dal core. */
	applyPatch(path: string, patch: string, mode: PatchMode): Promise<Snapshot>;
	unstage(paths: string[]): Promise<Snapshot>;
	discard(paths: string[]): Promise<Snapshot>;
	commit(message: string, all: boolean): Promise<Snapshot>;
	checkout(branch: string): Promise<Snapshot>;
	createBranch(name: string): Promise<Snapshot>;
	fetch(): Promise<Snapshot>;
	/** Ricerca nella storia: testo libero, `author:`, `file:`. */
	search(query: string, limit?: number): Promise<Commit[]>;
	/** Metadati di un commit qualsiasi, anche fuori dalla pagina di storia caricata. */
	commitInfo(sha: string): Promise<Commit>;
	/** Attribuzione riga per riga di un file. */
	blame(path: string, start?: number, end?: number): Promise<BlameFile>;
	/** Annulla l'ultima operazione registrata (commit, checkout, scarto). */
	undo(): Promise<Snapshot>;
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

		const [log, refs, status, undoLog] = await Promise.all([
			runGit(info.root, logArgs(), { allowFailure: true }),
			runGit(info.root, refsArgs(), { allowFailure: true }),
			runGit(info.root, statusArgs(), { allowFailure: true }),
			this.#readUndo(),
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
			undo: undoLog[0] ?? null,
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

	async applyPatch(
		path: string,
		patch: string,
		mode: PatchMode
	): Promise<Snapshot> {
		const info = this.#requireInfo();
		assertSafePath(path);

		if (!patch.trim()) throw new Error("Patch vuota.");
		if (!patchTargetsOnly(patch, path)) {
			throw new Error(`La patch non riguarda solo ${path}.`);
		}

		// `--cached` applica all'indice; in unstage si applica al contrario per togliere
		// dall'indice solo le righe scelte, lasciando il resto invariato.
		const args = ["apply", "--cached", "--whitespace=nowarn"];
		if (mode === "unstage") args.push("--reverse");
		args.push("-");

		await runGit(info.root, args, { input: patch });
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

		if (toRestore.length > 0) {
			// Prima di toccare il working tree: uno stash commit conserva il contenuto scartato.
			// Senza stash (indice in conflitto, nulla da salvare) l'operazione resta irreversibile.
			const stash = await runGit(info.root, ["stash", "create"], {
				allowFailure: true,
			});
			const stashSha = stash.code === 0 ? stash.stdout.trim() : "";
			if (stashSha) {
				await this.#record(
					"discard",
					`Scarta ${toRestore.join(", ")}`,
					{
						paths: toRestore,
						stash: stashSha,
					}
				);
			}
			await runGit(info.root, ["restore", "--", ...toRestore]);
		}
		for (const path of toDelete) {
			await rm(join(info.root, path), { force: true, recursive: true });
		}

		return this.refresh();
	}

	async commit(message: string, all: boolean): Promise<Snapshot> {
		const info = this.#requireInfo();
		if (!message.trim()) throw new Error("Il messaggio di commit è vuoto.");

		const subject = message.split("\n")[0]!.trim();
		const entry = await this.#record("commit", `Commit: ${subject}`);

		const args = ["commit", "-F", "-"];
		if (all) args.splice(1, 0, "-a");
		try {
			await runGit(info.root, args, { input: message });
		} catch (error) {
			// Il commit non è avvenuto: la voce di annullamento non deve restare.
			if (entry) await this.#dropUndo(entry.id);
			throw error;
		}
		return this.refresh();
	}

	async checkout(branch: string): Promise<Snapshot> {
		const info = this.#requireInfo();
		const entry = await this.#record(
			"checkout",
			`Checkout di ${branch} (prima: ${info.branch ?? "HEAD staccato"})`
		);
		try {
			await runGit(info.root, ["switch", branch]);
		} catch (error) {
			if (entry) await this.#dropUndo(entry.id);
			throw error;
		}
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

	async search(query: string, limit = 500): Promise<Commit[]> {
		const info = this.#requireInfo();
		const result = await runGit(
			info.root,
			historyArgs(parseHistoryQuery(query), limit),
			{ allowFailure: true }
		);
		return parseLog(result.stdout);
	}

	async commitInfo(sha: string): Promise<Commit> {
		const info = this.#requireInfo();
		if (!/^[0-9a-f]{7,64}$/.test(sha))
			throw new Error(`SHA non valido: ${sha}`);
		const result = await runGit(info.root, [
			"show",
			"-s",
			`--format=${LOG_FORMAT}`,
			sha,
		]);
		const commit = parseLog(result.stdout)[0];
		if (!commit) throw new Error(`Commit non trovato: ${sha}`);
		return commit;
	}

	async blame(
		path: string,
		start?: number,
		end?: number
	): Promise<BlameFile> {
		const info = this.#requireInfo();
		assertSafePath(path);
		const result = await runGit(info.root, blameArgs(path, start, end));
		return parseBlame(result.stdout, path);
	}

	async undo(): Promise<Snapshot> {
		const info = this.#requireInfo();
		const entries = await this.#readUndo();
		const entry = entries[0];
		if (!entry) throw new Error("Niente da annullare.");

		if (entry.kind === "commit") {
			if (!entry.head)
				throw new Error("Commit da annullare sconosciuto.");
			const head = (
				await runGit(info.root, ["rev-parse", "HEAD"])
			).stdout.trim();
			if (head === entry.head)
				throw new Error("Il commit è già stato annullato.");
			const ancestor = await runGit(
				info.root,
				["merge-base", "--is-ancestor", entry.head, head],
				{ allowFailure: true }
			);
			if (ancestor.code !== 0)
				throw new Error(
					"La storia è cambiata: annullare perderebbe altri commit."
				);
			// `--soft` riporta il ramo indietro e lascia il contenuto in stage: niente va perso.
			await runGit(info.root, ["reset", "--soft", entry.head]);
		} else if (entry.kind === "checkout") {
			if (entry.branch) {
				const current = await runGit(
					info.root,
					["symbolic-ref", "--short", "-q", "HEAD"],
					{ allowFailure: true }
				);
				if (current.stdout.trim() === entry.branch)
					throw new Error(`Sei già sul ramo ${entry.branch}.`);
				await runGit(info.root, ["switch", "--", entry.branch]);
			} else if (entry.head) {
				await runGit(info.root, ["switch", "--detach", entry.head]);
			}
		} else {
			if (!entry.stash)
				throw new Error("Nessun contenuto salvato per questo scarto.");
			for (const path of entry.paths ?? []) {
				assertSafePath(path);
				const present = await runGit(
					info.root,
					["cat-file", "-e", `${entry.stash}:${path}`],
					{ allowFailure: true }
				);
				if (present.code === 0) {
					await runGit(info.root, [
						"restore",
						"--source",
						entry.stash,
						"--worktree",
						"--",
						path,
					]);
				} else {
					// il file era stato cancellato: ripristinare significa cancellarlo di nuovo
					await rm(join(info.root, path), { force: true });
				}
			}
		}

		await runGit(info.root, ["update-ref", "-d", snapshotRef(entry.id)], {
			allowFailure: true,
		});
		await this.#writeUndo(entries.slice(1));
		return this.refresh();
	}

	#undoPath(info: RepoInfo): string {
		return join(info.gitDir, "gitcraft", "undo.json");
	}

	async #readUndo(): Promise<UndoEntry[]> {
		const path = this.#undoPath(this.#requireInfo());
		try {
			return parseUndoLog(await readFile(path, "utf8"));
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
			throw error;
		}
	}

	async #writeUndo(entries: UndoEntry[]): Promise<void> {
		const path = this.#undoPath(this.#requireInfo());
		await mkdir(dirname(path), { recursive: true });
		const temporary = `${path}.tmp`;
		await writeFile(temporary, serializeUndoLog(entries), "utf8");
		await rename(temporary, path);
	}

	/**
	 * Registra lo stato corrente prima di un'operazione distruttiva.
	 * Senza HEAD (repository senza commit) non c'è nulla da annullare e non si scrive niente.
	 */
	async #record(
		kind: UndoKind,
		label: string,
		extra: { paths?: string[]; stash?: string | null } = {}
	): Promise<UndoEntry | null> {
		const info = this.#requireInfo();
		const headResult = await runGit(
			info.root,
			["rev-parse", "--verify", "-q", "HEAD"],
			{ allowFailure: true }
		);
		const head = headResult.code === 0 ? headResult.stdout.trim() : "";
		if (!head) return null;

		const existing = await this.#readUndo();
		let id = undoId(kind);
		if (existing.some((entry) => entry.id === id))
			id = `${id}-${existing.length + 1}`;

		const entry: UndoEntry = {
			id,
			kind,
			at: Date.now(),
			head,
			branch: info.branch,
			label,
			...extra,
		};

		await runGit(info.root, ["update-ref", snapshotRef(id), head]);

		const all = [entry, ...existing];
		for (const dropped of all.slice(UNDO_LIMIT)) {
			await runGit(
				info.root,
				["update-ref", "-d", snapshotRef(dropped.id)],
				{ allowFailure: true }
			);
		}
		await this.#writeUndo(all.slice(0, UNDO_LIMIT));
		return entry;
	}

	/** Toglie una voce registrata per un'operazione poi fallita. */
	async #dropUndo(id: string): Promise<void> {
		const info = this.#requireInfo();
		const entries = await this.#readUndo();
		await this.#writeUndo(entries.filter((entry) => entry.id !== id));
		await runGit(info.root, ["update-ref", "-d", snapshotRef(id)], {
			allowFailure: true,
		});
	}

	#requireInfo(): RepoInfo {
		if (!this.#info) throw new Error("Nessun repository aperto.");
		return this.#info;
	}
}
