import {
	access,
	mkdir,
	mkdtemp,
	open,
	readFile,
	rename,
	rm,
	writeFile,
} from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { basename, dirname, isAbsolute, join, resolve } from "node:path";

import { blameArgs, parseBlame, type BlameFile } from "../core/blame.ts";
import {
	contentSearchArgs,
	parseContentMatches,
	type ContentQuery,
	type ContentSearchResult,
} from "../core/content.ts";
import {
	commitDiffArgs,
	commitFilesArgs,
	commitStatArgs,
	parseDiff,
	parseNameStatus,
	parseNumstat,
	worktreeDiffArgs,
} from "../core/diff.ts";
import { layoutGraph } from "../core/graph.ts";
import {
	attachRefs,
	commitDetailsArgs,
	logArgs,
	LOG_FORMAT,
	parseCommitDetails,
	parseLog,
	parseRefs,
	refsArgs,
} from "../core/log.ts";
import { assessHealth, type HealthReport } from "../core/health.ts";
import {
	summarizeRemoteCheck,
	type RemoteCheck,
} from "../core/remotes.ts";
import {
	assertPlanCovers,
	parseRebaseCandidates,
	rebasePlanArgs,
	rebaseTodo,
	type RebaseCandidate,
	type RebaseStep,
} from "../core/rebase.ts";
import {
	parseTreeEntries,
	sortTreeEntries,
	type TreeEntry,
} from "../core/tree.ts";
import {
	parseWorktrees,
	type WorktreeInfo,
} from "../core/worktrees.ts";
import {
	COMMIT_TEMPLATE_LIMIT,
	commitArgs,
	limitCommitTemplate,
	resolveCommitTemplatePath,
} from "../core/commit.ts";
import { hostFromUrl } from "../core/providers.ts";
import type { NetworkProgress } from "../core/network.ts";
import { parseStatus, statusArgs } from "../core/status.ts";
import { patchTargetsOnly, type PatchMode } from "../core/patch.ts";
import { reflogArgs, parseReflog, type ReflogEntry } from "../core/reflog.ts";
import { historyArgs, type HistoryQuery } from "../core/search.ts";
import {
	assertRefName,
	cherryPickArgs,
	checkoutTrackingArgs,
	createBranchAtArgs,
	deleteBranchArgs,
	mergeArgs,
	parseStashList,
	parseSubmodules,
	pullArgs,
	pushArgs,
	rebaseArgs,
	renameBranchArgs,
	resetArgs,
	stashApplyArgs,
	assertSha,
	stashDropArgs,
	stashListArgs,
	stashSaveArgs,
	type ResetMode,
} from "../core/ops.ts";
import {
	defaultSettings,
	type Settings,
	type TrashUsage,
} from "../core/settings.ts";
import {
	parseUndoLog,
	snapshotRef,
	UNDO_LIMIT,
	undoId,
	type UndoEntry,
	type UndoKind,
} from "../core/undo.ts";
import type {
	Commit,
	CommitDetails,
	CommitFile,
	CommitPage,
	CommitStat,
	CommitTemplate,
	ConflictDetail,
	ConflictFile,
	DiffFile,
	RefInfo,
	RepoInfo,
	RepoOperation,
	Snapshot,
	StashEntry,
	SubmoduleInfo,
} from "../core/types.ts";
import { GitError, runGit, runGitStreaming } from "./git.ts";
import {
	pruneTrash,
	removeTrash,
	restoreFromTrash,
	storeTrash,
	TrashLimitError,
} from "./trash.ts";

/** La prima pagina di storia: oltre si carica su richiesta del renderer. */
export const HISTORY_PAGE_SIZE = 2000;

export interface BackendOptions {
	/** Impostazioni correnti, rilette quando servono: UI e MCP vedono la stessa policy. */
	settings?: () => Promise<Settings>;
	/**
	 * Credenziali per un host, quando l'utente ha collegato un account: finiscono nell'ambiente del
	 * processo git (`GIT_ASKPASS`), mai negli argomenti o su disco.
	 */
	credentials?: (
		host: string | null
	) => Promise<Record<string, string> | null>;
}

/**
 * Unico punto in cui l'applicazione tocca il disco.
 *
 * Oggi l'implementazione è il binario `git`: compatibilità totale per costruzione (hooks, LFS,
 * credential helper, filtri, `skip-worktree`). Se un giorno le letture calde misurate lo
 * richiederanno, arriverà una `Libgit2Backend` dietro questa stessa interfaccia — non un refactor
 * dell'app.
 */
/** Callback opzionale per l'avanzamento di rete: la UI non deve aspettare la fine del comando. */
export type ProgressListener = (progress: NetworkProgress) => void;

export interface GitBackend {
	open(dir: string): Promise<Snapshot>;
	refresh(): Promise<Snapshot>;
	commitFiles(sha: string): Promise<CommitFile[]>;
	/** Righe aggiunte/rimosse e file binari del commit (`--numstat`). */
	commitStat(sha: string): Promise<CommitStat>;
	commitPatch(sha: string, path: string): Promise<DiffFile>;
	worktreePatch(path: string, staged: boolean): Promise<DiffFile>;
	stage(paths: string[]): Promise<Snapshot>;
	/** Applica all'indice una patch parziale (hunk o righe) costruita dal core. */
	applyPatch(path: string, patch: string, mode: PatchMode): Promise<Snapshot>;
	unstage(paths: string[]): Promise<Snapshot>;
	discard(paths: string[]): Promise<Snapshot>;
	commit(message: string, all: boolean, sign?: boolean): Promise<Snapshot>;
	checkout(branch: string): Promise<Snapshot>;
	createBranch(name: string): Promise<Snapshot>;
	fetch(onProgress?: ProgressListener): Promise<Snapshot>;
	/** `git pull --ff-only`: un ramo divergente si ferma con il messaggio di Git. */
	pull(onProgress?: ProgressListener): Promise<Snapshot>;
	/** Push senza forza; senza upstream crea il tracking su `origin`. */
	push(onProgress?: ProgressListener): Promise<Snapshot>;
	stashList(): Promise<StashEntry[]>;
	/** Con `paths` salva solo quei file e lascia gli altri nel working tree. */
	stashSave(message: string, paths?: string[]): Promise<Snapshot>;
	/** Applica (`pop` falso) o applica ed elimina (`pop` vero) lo stash indicato. */
	stashApply(index: number, drop: boolean): Promise<Snapshot>;
	stashDrop(index: number): Promise<Snapshot>;
	submodules(): Promise<SubmoduleInfo[]>;
	updateSubmodules(): Promise<Snapshot>;
	merge(branch: string): Promise<Snapshot>;
	rebase(onto: string): Promise<Snapshot>;
	cherryPick(sha: string): Promise<Snapshot>;
	/** Ramo nuovo che punta a un commit, senza spostare HEAD. */
	createBranchAt(name: string, sha: string): Promise<Snapshot>;
	/** Porta HEAD su un commit, staccato da ogni ramo. */
	checkoutCommit(sha: string): Promise<Snapshot>;
	/** Reset del ramo attuale a un commit, con voce di undo sul puntatore. */
	reset(sha: string, mode: ResetMode): Promise<Snapshot>;
	renameBranch(from: string, to: string): Promise<Snapshot>;
	deleteBranch(name: string, force: boolean): Promise<Snapshot>;
	checkoutTracking(remoteRef: string, local: string): Promise<Snapshot>;
	/** Ricerca nella storia: testo libero, `author:`, `file:`. */
	search(query: HistoryQuery, limit?: number): Promise<Commit[]>;
	/** Spostamenti di HEAD, dal più recente. */
	reflog(limit?: number): Promise<ReflogEntry[]>;
	/** Pagina successiva della storia, a partire da `skip`. */
	historyPage(skip: number, limit?: number): Promise<CommitPage>;
	/** Metadati di un commit qualsiasi, anche fuori dalla pagina di storia caricata. */
	commitInfo(sha: string): Promise<Commit>;
	/** Attribuzione riga per riga di un file. */
	/** Ricerca nel contenuto dei file tracciati (`git grep`). */
	searchContent(query: ContentQuery): Promise<ContentSearchResult>;
	blame(path: string, start?: number, end?: number): Promise<BlameFile>;
	/** Annulla l'ultima operazione registrata (commit, checkout, scarto). */
	undo(): Promise<Snapshot>;
	/** Modello del messaggio di commit (`commit.template`). */
	commitTemplate(): Promise<CommitTemplate>;
	/** Segnali da guardare: rami divergenti, stash vecchi, submodule non puliti, HEAD staccato. */
	health(): Promise<HealthReport>;
	/** Spazio occupato dalle copie di sicurezza ancora annullabili. */
	trashUsage(): Promise<TrashUsage>;
}

/** Impronta stabile dei ref: dice se la pagina di storia letta è ancora valida. */
function refFingerprint(refs: RefInfo[]): string {
	return refs
		.map((ref) => `${ref.kind}\u0000${ref.name}\u0000${ref.sha}`)
		.join("\u0001");
}

interface Stages {
	base: boolean;
	ours: boolean;
	theirs: boolean;
}

/**
 * `git ls-files -u -z` scrive un record per ogni stage di ogni file in conflitto:
 * `<mode> <sha> <stage>\t<path>\0`. L'assenza di uno stage dice che quel lato ha cancellato il file.
 */
function parseUnmergedStages(raw: string): Map<string, Stages> {
	const out = new Map<string, Stages>();
	for (const record of raw.split("\u0000")) {
		const tab = record.indexOf("\t");
		if (tab < 0) continue;
		const fields = record.slice(0, tab).split(" ");
		const stage = Number(fields[2]);
		const path = record.slice(tab + 1);
		if (!path || (stage !== 1 && stage !== 2 && stage !== 3)) continue;
		const entry = out.get(path) ?? {
			base: false,
			ours: false,
			theirs: false,
		};
		if (stage === 1) entry.base = true;
		if (stage === 2) entry.ours = true;
		if (stage === 3) entry.theirs = true;
		out.set(path, entry);
	}
	return out;
}

/** Un blob binario: NUL nei primi 8000 byte, la stessa soglia che usa Git. */
function isBinary(text: string): boolean {
	return text.slice(0, 8000).includes("\u0000");
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

/** Oltre questa soglia la finestra diventa illeggibile e il rebase difficile da controllare. */
const REBASE_MAX_COMMITS = 50;

export class CliGitBackend implements GitBackend {
	#info: RepoInfo | null = null;
	/**
	 * Pagina di storia già letta, con l'impronta di HEAD e dei ref.
	 * `git log --date-order` percorre tutta la storia per ordinarla: rileggerla a ogni
	 * `fs.watch` (un salvataggio, un `git add`) sarebbe il costo più alto del refresh.
	 */
	#history: {
		head: string | null;
		refs: string;
		commits: Commit[];
	} | null = null;
	readonly #settings: () => Promise<Settings>;
	readonly #credentials: BackendOptions["credentials"];

	constructor(options: BackendOptions = {}) {
		this.#settings = options.settings ?? (async () => defaultSettings());
		this.#credentials = options.credentials;
	}

	/** Ambiente con le credenziali dell'account che corrisponde all'host di `origin`. */
	async #networkEnv(info: RepoInfo): Promise<Record<string, string>> {
		if (!this.#credentials) return {};
		const remote = await runGit(
			info.root,
			["remote", "get-url", "origin"],
			{
				allowFailure: true,
			}
		);
		if (remote.code !== 0) return {};
		const env = await this.#credentials(hostFromUrl(remote.stdout.trim()));
		return env ?? {};
	}

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
			operation: await this.#operation(gitDir),
		};
		this.#history = null;
		return this.refresh();
	}

	async refresh(): Promise<Snapshot> {
		const info = this.#requireInfo();

		// `git status --branch` porta già ramo e SHA di HEAD: la `symbolic-ref` separata
		// sarebbe un processo in più per un dato che arriva qui.
		const [refs, status, undoLog] = await Promise.all([
			runGit(info.root, refsArgs(), { allowFailure: true }),
			runGit(info.root, statusArgs(), { allowFailure: true }),
			this.#readUndo(),
		]);

		const statusTree = parseStatus(status.stdout);
		const refList = parseRefs(refs.stdout);
		const fingerprint = refFingerprint(refList);

		let commits =
			this.#history?.head === statusTree.oid &&
			this.#history.refs === fingerprint
				? this.#history.commits
				: null;

		if (commits) {
			// le decorazioni cambiano con i ref: si ricalcolano sulla pagina riusata
			for (const commit of commits) commit.refs = [];
		} else {
			const log = await runGit(
				info.root,
				logArgs({ limit: HISTORY_PAGE_SIZE }),
				{ allowFailure: true }
			);
			commits = parseLog(log.stdout);
			this.#history = {
				head: statusTree.oid,
				refs: fingerprint,
				commits,
			};
		}
		attachRefs(commits, refList);

		this.#info = {
			...info,
			branch: statusTree.branch,
			detached: statusTree.branch === null,
			operation: await this.#operation(info.gitDir),
		};

		return {
			info: this.#info,
			commits,
			graph: layoutGraph(commits),
			refs: refList,
			status: statusTree,
			undo: undoLog[0] ?? null,
			hasMore: commits.length === HISTORY_PAGE_SIZE,
		};
	}

	async commitDetails(sha: string): Promise<CommitDetails | null> {
		const info = this.#requireInfo();
		const result = await runGit(info.root, commitDetailsArgs(sha), {
			allowFailure: true,
		});
		return result.code === 0 ? parseCommitDetails(result.stdout) : null;
	}

	async commitFiles(sha: string): Promise<CommitFile[]> {
		const info = this.#requireInfo();
		const result = await runGit(info.root, commitFilesArgs(sha));
		return parseNameStatus(result.stdout);
	}

	async commitStat(sha: string): Promise<CommitStat> {
		const info = this.#requireInfo();
		const result = await runGit(info.root, commitStatArgs(sha));
		return parseNumstat(result.stdout);
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
		// `--untracked-files=all` elenca i file, non le cartelle: un path che contiene file non
		// tracciati (es. `cartella/`) va trattato come non tracciato, non passato a `restore`.
		const untrackedPaths = status.status.entries
			.filter((entry) => entry.kind === "untracked")
			.map((entry) => entry.path);
		const isUntracked = (path: string): boolean => {
			const prefix = path.endsWith("/") ? path : `${path}/`;
			return untrackedPaths.some(
				(candidate) =>
					candidate === path || candidate.startsWith(prefix)
			);
		};
		const toDelete = paths.filter(isUntracked);
		const toRestore = paths.filter((path) => !isUntracked(path));

		// Il contenuto tracciato si conserva in uno stash commit. I file non tracciati diventano
		// oggetti Git sotto `refs/githandler/trash/...`: se qualcosa va storto non si cancella nulla.
		let stashSha = "";
		if (toRestore.length > 0) {
			const stash = await runGit(info.root, ["stash", "create"], {
				allowFailure: true,
			});
			stashSha = stash.code === 0 ? stash.stdout.trim() : "";
		}

		const { trash } = await this.#settings();
		let stored: { bytes: number; files: number } | null = null;
		let trashId: string | null = null;

		if (toDelete.length > 0 && trash.enabled) {
			const id = await this.#nextUndoId("discard");
			try {
				stored = await storeTrash({
					root: info.root,
					gitDir: info.gitDir,
					id,
					paths: toDelete,
					limits: trash,
				});
				trashId = stored ? id : null;
			} catch (error) {
				// niente cancellazione se la copia non è riuscita: il journal non deve mentire
				await removeTrash(info.root, info.gitDir, id);
				if (error instanceof TrashLimitError)
					throw new Error(
						`${error.message} I limiti si cambiano in Impostazioni → File non tracciati.`
					);
				throw error;
			}
		}

		const needsUndo =
			(toRestore.length > 0 && stashSha !== "") || trashId !== null;
		if (needsUndo) {
			try {
				await this.#record(
					"discard",
					`Scarta ${paths.join(", ")}`,
					{
						paths:
							toRestore.length > 0 && stashSha
								? toRestore
								: undefined,
						stash: stashSha || null,
						trash: trashId,
						untrackedPaths: trashId ? toDelete : undefined,
						trashBytes: stored?.bytes,
						trashFiles: stored?.files,
					},
					{ allowNoHead: true, id: trashId ?? undefined }
				);
			} catch (error) {
				// la voce non è stata scritta: il ref appena creato sarebbe orfano
				if (trashId) await removeTrash(info.root, info.gitDir, trashId);
				throw error;
			}
		}

		if (toRestore.length > 0)
			await runGit(info.root, ["restore", "--", ...toRestore]);
		for (const path of toDelete) {
			await rm(join(info.root, path), { force: true, recursive: true });
		}

		return this.refresh();
	}

	/** Contenuto di `commit.template`, se configurato e leggibile: vuoto altrimenti. */
	async commitTemplate(): Promise<CommitTemplate> {
		const info = this.#requireInfo();
		const configured = await runGit(
			info.root,
			["config", "--get", "commit.template"],
			{ allowFailure: true }
		);
		if (configured.code !== 0) return limitCommitTemplate("");
		const path = resolveCommitTemplatePath(
			info.root,
			configured.stdout,
			homedir()
		);
		if (!path) return limitCommitTemplate("");
		let handle: Awaited<ReturnType<typeof open>> | null = null;
		try {
			handle = await open(path, "r");
			const buffer = Buffer.alloc(COMMIT_TEMPLATE_LIMIT + 1);
			const { bytesRead } = await handle.read(
				buffer,
				0,
				buffer.length,
				0
			);
			return limitCommitTemplate(
				buffer.subarray(0, bytesRead).toString("utf8")
			);
		} catch (error) {
			// un modello mancante non deve impedire di scrivere il messaggio a mano
			if ((error as NodeJS.ErrnoException).code === "ENOENT")
				return limitCommitTemplate("");
			throw new Error(
				`Modello di commit non leggibile: ${
					error instanceof Error ? error.message : String(error)
				}`
			);
		} finally {
			await handle?.close();
		}
	}

	async commit(
		message: string,
		all: boolean,
		sign = false
	): Promise<Snapshot> {
		const info = this.#requireInfo();
		if (!message.trim()) throw new Error("Il messaggio di commit è vuoto.");

		const subject = message.split("\n")[0]!.trim();
		const entry = await this.#record("commit", `Commit: ${subject}`);

		const args = commitArgs(all, sign);
		try {
			await runGit(info.root, args, { input: message });
		} catch (error) {
			// Il commit non è avvenuto: la voce di annullamento non deve restare.
			if (entry) await this.#dropUndo(entry.id);
			throw error;
		}
		await this.#finalizeUndo(entry);
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

	async fetch(onProgress?: ProgressListener): Promise<Snapshot> {
		const info = this.#requireInfo();
		await runGitStreaming(
			info.root,
			["fetch", "--all", "--prune", "--progress"],
			{
				timeoutMs: 120_000,
				env: await this.#networkEnv(info),
			},
			onProgress
		);
		return this.refresh();
	}

	async pull(onProgress?: ProgressListener): Promise<Snapshot> {
		const info = this.#requireInfo();
		await runGitStreaming(
			info.root,
			pullArgs(),
			{
				timeoutMs: 180_000,
				env: await this.#networkEnv(info),
			},
			onProgress
		);
		return this.refresh();
	}

	async push(onProgress?: ProgressListener): Promise<Snapshot> {
		const info = this.#requireInfo();
		// `@{u}` esiste solo con il tracking: senza, il primo push lo crea su origin.
		const upstream = await runGit(
			info.root,
			["rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{u}"],
			{ allowFailure: true }
		);
		const hasUpstream =
			upstream.code === 0 && upstream.stdout.trim() !== "";
		await runGitStreaming(
			info.root,
			pushArgs(info.branch, hasUpstream),
			{
				timeoutMs: 180_000,
				env: await this.#networkEnv(info),
			},
			onProgress
		);
		return this.refresh();
	}

	async stashList(): Promise<StashEntry[]> {
		const info = this.#requireInfo();
		const result = await runGit(info.root, stashListArgs(), {
			allowFailure: true,
		});
		return parseStashList(result.stdout);
	}

	async stashSave(message: string, paths?: string[]): Promise<Snapshot> {
		const info = this.#requireInfo();
		if ((await this.refresh()).status.entries.length === 0)
			throw new Error("Niente da salvare: il working tree è pulito.");
		if (paths) {
			const unique = [...new Set(paths)];
			if (unique.length === 0)
				throw new Error(
					"Scegli almeno un file da mettere nello stash."
				);
			for (const path of unique) assertSafePath(path);
			paths = unique;
		}
		await runGit(info.root, stashSaveArgs(message, paths), {
			timeoutMs: 120_000,
		});
		return this.refresh();
	}

	async stashApply(index: number, drop: boolean): Promise<Snapshot> {
		const info = this.#requireInfo();
		await runGit(info.root, stashApplyArgs(index, drop), {
			timeoutMs: 120_000,
		});
		return this.refresh();
	}

	async stashDrop(index: number): Promise<Snapshot> {
		const info = this.#requireInfo();
		await runGit(info.root, stashDropArgs(index));
		return this.refresh();
	}

	async submodules(): Promise<SubmoduleInfo[]> {
		const info = this.#requireInfo();
		const result = await runGit(info.root, ["submodule", "status"], {
			allowFailure: true,
		});
		return parseSubmodules(result.stdout);
	}

	async updateSubmodules(): Promise<Snapshot> {
		const info = this.#requireInfo();
		await runGit(
			info.root,
			["submodule", "update", "--init", "--recursive"],
			{
				timeoutMs: 600_000,
			}
		);
		return this.refresh();
	}

	async merge(branch: string): Promise<Snapshot> {
		const info = this.#requireInfo();
		const entry = await this.#record("commit", `Merge di ${branch}`);
		try {
			await runGit(info.root, mergeArgs(branch), { timeoutMs: 180_000 });
		} catch (error) {
			if (entry) await this.#dropUndo(entry.id);
			throw error;
		}
		await this.#finalizeUndo(entry);
		return this.refresh();
	}

	async rebase(onto: string): Promise<Snapshot> {
		const info = this.#requireInfo();
		const entry = await this.#record("commit", `Rebase su ${onto}`);
		try {
			await runGit(info.root, rebaseArgs(onto), { timeoutMs: 300_000 });
		} catch (error) {
			if (entry) await this.#dropUndo(entry.id);
			throw error;
		}
		await this.#finalizeUndo(entry);
		return this.refresh();
	}

	async cherryPick(sha: string): Promise<Snapshot> {
		const info = this.#requireInfo();
		const entry = await this.#record(
			"commit",
			`Cherry-pick di ${sha.slice(0, 8)}`
		);
		try {
			await runGit(info.root, cherryPickArgs(sha), {
				timeoutMs: 180_000,
			});
		} catch (error) {
			if (entry) await this.#dropUndo(entry.id);
			throw error;
		}
		await this.#finalizeUndo(entry);
		return this.refresh();
	}

	async createBranchAt(name: string, sha: string): Promise<Snapshot> {
		const info = this.#requireInfo();
		await runGit(info.root, createBranchAtArgs(name, sha));
		return this.refresh();
	}

	async checkoutCommit(sha: string): Promise<Snapshot> {
		const info = this.#requireInfo();
		assertSha(sha);
		const entry = await this.#record(
			"checkout",
			`Checkout di ${sha.slice(0, 8)} (HEAD staccato)`
		);
		try {
			await runGit(info.root, ["switch", "--detach", sha]);
		} catch (error) {
			if (entry) await this.#dropUndo(entry.id);
			throw error;
		}
		return this.refresh();
	}

	async reset(sha: string, mode: ResetMode): Promise<Snapshot> {
		const info = this.#requireInfo();
		// l'undo riporta il puntatore con reset --soft: le modifiche restano da rivedere
		const entry = await this.#record(
			"commit",
			`Reset (${mode}) a ${sha.slice(0, 8)}`
		);
		try {
			await runGit(info.root, resetArgs(sha, mode));
		} catch (error) {
			if (entry) await this.#dropUndo(entry.id);
			throw error;
		}
		await this.#finalizeUndo(entry);
		return this.refresh();
	}

	async renameBranch(from: string, to: string): Promise<Snapshot> {
		const info = this.#requireInfo();
		await runGit(info.root, renameBranchArgs(from, to));
		return this.refresh();
	}

	async deleteBranch(name: string, force: boolean): Promise<Snapshot> {
		const info = this.#requireInfo();
		await runGit(info.root, deleteBranchArgs(name, force));
		return this.refresh();
	}

	async checkoutTracking(
		remoteRef: string,
		local: string
	): Promise<Snapshot> {
		const info = this.#requireInfo();
		await runGit(info.root, checkoutTrackingArgs(remoteRef, local));
		return this.refresh();
	}

	/** File in conflitto dell'operazione sospesa, con gli stage presenti nell'indice. */
	async conflicts(): Promise<ConflictFile[]> {
		const info = this.#requireInfo();
		const [status, staged] = await Promise.all([
			runGit(info.root, statusArgs(), { allowFailure: true }),
			runGit(info.root, ["ls-files", "-u", "-z"], { allowFailure: true }),
		]);
		const codes = new Map<string, { index: string; worktree: string }>();
		for (const entry of parseStatus(status.stdout).entries) {
			if (entry.kind === "unmerged")
				codes.set(entry.path, {
					index: entry.index,
					worktree: entry.worktree,
				});
		}
		const stages = parseUnmergedStages(staged.stdout);
		return [...stages].map(([path, present]) => ({
			path,
			index: codes.get(path)?.index ?? "U",
			worktree: codes.get(path)?.worktree ?? "U",
			stages: present,
		}));
	}

	/** Le tre versioni di un conflitto, più il testo che sta su disco adesso. */
	async conflictDetail(path: string): Promise<ConflictDetail> {
		const info = this.#requireInfo();
		assertSafePath(path);
		const [tree, present] = await Promise.all([
			runGit(info.root, ["ls-files", "-u", "-z"], { allowFailure: true }),
			this.conflicts(),
		]);
		const stages = parseUnmergedStages(tree.stdout).get(path) ?? {
			base: false,
			ours: false,
			theirs: false,
		};
		const [base, ours, theirs, working] = await Promise.all([
			this.#stageText(path, 1),
			this.#stageText(path, 2),
			this.#stageText(path, 3),
			readFile(join(info.root, path), "utf8").catch(() => ""),
		]);
		return {
			path,
			index: present.find((file) => file.path === path)?.index ?? "U",
			worktree:
				present.find((file) => file.path === path)?.worktree ?? "U",
			stages,
			working,
			base,
			ours,
			theirs,
			binary: isBinary(base) || isBinary(ours) || isBinary(theirs),
		};
	}

	/**
	 * Tiene la versione di uno dei due lati per un intero file. Se quello stage non esiste il file
	 * era stato cancellato da quel lato: la scelta diventa una cancellazione, non un contenuto vuoto.
	 */
	async resolveConflictFile(
		path: string,
		side: "ours" | "theirs"
	): Promise<Snapshot> {
		const info = this.#requireInfo();
		assertSafePath(path);
		const tree = await runGit(info.root, ["ls-files", "-u", "-z"], {
			allowFailure: true,
		});
		const stages = parseUnmergedStages(tree.stdout).get(path);
		if (!stages) throw new Error(`Nessun conflitto per ${path}.`);
		const present = side === "ours" ? stages.ours : stages.theirs;
		if (present) {
			await runGit(info.root, ["checkout", `--${side}`, "--", path]);
			await runGit(info.root, ["add", "--", path]);
		} else {
			await runGit(info.root, ["rm", "-f", "--", path]);
		}
		return this.refresh();
	}

	/** Scrive il risultato scelto dall'utente: il file resta da segnare come risolto. */
	async writeResolvedFile(path: string, text: string): Promise<void> {
		const info = this.#requireInfo();
		assertSafePath(path);
		await writeFile(join(info.root, path), text, "utf8");
	}

	/** `git add`: il file esce dall'elenco dei conflitti. */
	async markResolved(paths: string[]): Promise<Snapshot> {
		const info = this.#requireInfo();
		for (const path of paths) assertSafePath(path);
		if (paths.length > 0) await runGit(info.root, ["add", "--", ...paths]);
		return this.refresh();
	}

	/** Riprende l'operazione sospesa (`--continue`) senza aprire un editor. */
	async continueOperation(): Promise<Snapshot> {
		const info = this.#requireInfo();
		const operation = await this.#operation(info.gitDir);
		if (!operation) throw new Error("Nessuna operazione da continuare.");
		await runGit(info.root, [operation, "--continue"], {
			timeoutMs: 300_000,
			env: { GIT_EDITOR: "true" },
		});
		return this.refresh();
	}

	/** Contenuto di uno stage (`:1:`, `:2:`, `:3:`); vuoto quando lo stage non esiste. */
	async #stageText(path: string, stage: 1 | 2 | 3): Promise<string> {
		const info = this.#requireInfo();
		const result = await runGit(info.root, ["show", `:${stage}:${path}`], {
			allowFailure: true,
		});
		return result.code === 0 ? result.stdout : "";
	}

	/** Operazione interrotta a metà (merge, rebase, cherry-pick), se c'è. */
	async abortOperation(): Promise<Snapshot> {
		const info = this.#requireInfo();
		const operation = await this.#operation(info.gitDir);
		if (!operation) throw new Error("Nessuna operazione da annullare.");
		const args =
			operation === "merge"
				? ["merge", "--abort"]
				: operation === "rebase"
				? ["rebase", "--abort"]
				: ["cherry-pick", "--abort"];
		await runGit(info.root, args);
		return this.refresh();
	}

	async search(query: HistoryQuery, limit = 500): Promise<Commit[]> {
		const info = this.#requireInfo();
		const result = await runGit(info.root, historyArgs(query, limit), {
			allowFailure: true,
		});
		return parseLog(result.stdout);
	}

	async searchContent(query: ContentQuery): Promise<ContentSearchResult> {
		const info = this.#requireInfo();
		const result = await runGit(info.root, contentSearchArgs(query), {
			// `git grep` esce con 1 quando non trova niente: non è un errore
			allowFailure: true,
			timeoutMs: 60_000,
		});
		if (result.code > 1) {
			throw new GitError(
				`git grep: ${result.stderr.trim() || "ricerca fallita"}`,
				["grep"],
				result.code,
				result.stderr
			);
		}
		return parseContentMatches(result.stdout);
	}

	async reflog(limit = 200): Promise<ReflogEntry[]> {
		const info = this.#requireInfo();
		const result = await runGit(info.root, reflogArgs(limit), {
			allowFailure: true,
		});
		return parseReflog(result.stdout);
	}

	async historyPage(
		skip: number,
		limit = HISTORY_PAGE_SIZE
	): Promise<CommitPage> {
		const info = this.#requireInfo();
		if (!Number.isInteger(skip) || skip < 0)
			throw new Error(`Paginazione non valida: ${skip}`);
		if (!Number.isInteger(limit) || limit < 1 || limit > 5000)
			throw new Error(`Dimensione pagina non valida: ${limit}`);

		const [log, refs] = await Promise.all([
			runGit(info.root, logArgs({ limit, skip }), {
				allowFailure: true,
			}),
			runGit(info.root, refsArgs(), { allowFailure: true }),
		]);
		const commits = parseLog(log.stdout);
		attachRefs(commits, parseRefs(refs.stdout));
		return { commits, hasMore: commits.length === limit };
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

	async health(): Promise<HealthReport> {
		const info = this.#requireInfo();
		const [snapshot, stashes, submodules] = await Promise.all([
			this.refresh(),
			this.stashList(),
			this.submodules(),
		]);
		return assessHealth({
			refs: snapshot.refs,
			stashes,
			submodules,
			detached: snapshot.info.detached || !info.branch,
			now: Date.now(),
		});
	}

	async remoteChecks(): Promise<RemoteCheck[]> {
		const info = this.#requireInfo();
		const names = await runGit(info.root, ["remote"], { allowFailure: true });
		const remotes = names.stdout
			.split("\n")
			.map((line) => line.trim())
			.filter(Boolean);
		if (remotes.length === 0) return [];
		return Promise.all(
			remotes.map(async (name) => {
				const url = (
					await runGit(info.root, ["remote", "get-url", name], {
						allowFailure: true,
					})
				).stdout.trim();
				const result = await runGit(
					info.root,
					["ls-remote", "--heads", name],
					{ allowFailure: true, timeoutMs: 8_000 }
				);
				return summarizeRemoteCheck(
					name,
					url,
					result.code,
					result.stdout,
					result.stderr
				);
			})
		);
	}

	async worktrees(): Promise<WorktreeInfo[]> {
		const info = this.#requireInfo();
		const result = await runGit(info.root, [
			"worktree",
			"list",
			"--porcelain",
		]);
		return parseWorktrees(result.stdout);
	}

	async createWorktree(
		path: string,
		branch: string
	): Promise<WorktreeInfo[]> {
		const info = this.#requireInfo();
		const target = path.trim();
		if (!target || target.includes("\u0000") || !isAbsolute(target))
			throw new Error("Il percorso di un worktree deve essere assoluto.");
		assertRefName(branch);
		const exists = await runGit(
			info.root,
			["rev-parse", "--verify", "--quiet", `refs/heads/${branch}`],
			{ allowFailure: true }
		);
		const args =
			exists.code === 0
				? ["worktree", "add", resolve(target), branch]
				: ["worktree", "add", "-b", branch, resolve(target), "HEAD"];
		await runGit(info.root, args, { timeoutMs: 120_000 });
		return this.worktrees();
	}

	async removeWorktree(path: string): Promise<WorktreeInfo[]> {
		const info = this.#requireInfo();
		const target = resolve(path.trim());
		const found = (await this.worktrees()).find(
			(entry) => resolve(entry.path) === target
		);
		if (!found) throw new Error("Worktree non trovato: non è stato rimosso.");
		if (found.main)
			throw new Error(
				"Il worktree principale non si rimuove: è la cartella del repository."
			);
		await runGit(info.root, ["worktree", "remove", found.path], {
			timeoutMs: 120_000,
		});
		return this.worktrees();
	}

	async treeEntries(
		ref: string | null,
		path: string
	): Promise<TreeEntry[]> {
		const info = this.#requireInfo();
		const commit = ref ?? "HEAD";
		if (!/^[0-9a-f]{7,64}$/.test(commit) && commit !== "HEAD")
			throw new Error(`Riferimento non valido: ${commit}`);
		const target = path.trim();
		if (target) assertSafePath(target);
		const args = ["ls-tree", "-z", commit];
		if (target) args.push("--", `${target.replace(/\/+$/, "")}/`);
		const result = await runGit(info.root, args, { allowFailure: true });
		// un repository senza commit non ha un albero: vuoto, non un errore
		if (result.code !== 0) return [];
		return sortTreeEntries(parseTreeEntries(result.stdout));
	}

	async rebaseCandidates(
		from: string
	): Promise<{ base: string; head: string; candidates: RebaseCandidate[] }> {
		const info = this.#requireInfo();
		assertSha(from);
		const headResult = await runGit(
			info.root,
			["rev-parse", "--verify", "-q", "HEAD"],
			{ allowFailure: true }
		);
		if (headResult.code !== 0)
			throw new Error("Il repository non ha ancora commit da riscrivere.");
		const head = headResult.stdout.trim();

		const target = await runGit(
			info.root,
			["rev-parse", "--verify", "-q", `${from}^{commit}`],
			{ allowFailure: true }
		);
		if (target.code !== 0)
			throw new Error(`Commit non trovato: ${from}`);
		const sha = target.stdout.trim();
		if (sha === head)
			throw new Error(
				"Scegli un commit più vecchio di HEAD: da solo non c'è niente da riscrivere."
			);

		const ancestor = await runGit(
			info.root,
			["merge-base", "--is-ancestor", sha, head],
			{ allowFailure: true }
		);
		if (ancestor.code !== 0)
			throw new Error(
				"Il commit non è nella storia del ramo attuale: niente da riscrivere."
			);

		const parentResult = await runGit(
			info.root,
			["rev-parse", "--verify", "-q", `${sha}^`],
			{ allowFailure: true }
		);
		if (parentResult.code !== 0)
			throw new Error(
				"Il primo commit della storia non si riscrive con il rebase interattivo."
			);
		const base = parentResult.stdout.trim();

		// un merge nel mezzo verrebbe appiattito: meglio dirlo che sorprendere
		const merges = await runGit(
			info.root,
			["rev-list", "--merges", `${base}..${head}`],
			{ allowFailure: true }
		);
		if (merges.stdout.trim())
			throw new Error(
				"L'intervallo contiene un merge: il rebase interattivo non è disponibile qui."
			);

		const count = await runGit(
			info.root,
			["rev-list", "--count", `${base}..${head}`],
			{ allowFailure: true }
		);
		if ((Number.parseInt(count.stdout.trim(), 10) || 0) > REBASE_MAX_COMMITS)
			throw new Error(
				`Il rebase interattivo copre al massimo ${REBASE_MAX_COMMITS} commit: parti da uno più recente.`
			);

		const log = await runGit(info.root, rebasePlanArgs(base));
		return {
			base,
			head,
			candidates: parseRebaseCandidates(log.stdout),
		};
	}

	async rebaseInteractive(
		base: string,
		steps: RebaseStep[],
		head: string
	): Promise<Snapshot> {
		const info = this.#requireInfo();
		assertSha(base);
		assertSha(head);
		const current = await runGit(
			info.root,
			["rev-parse", "--verify", "-q", "HEAD"],
			{ allowFailure: true }
		);
		if (current.code !== 0 || current.stdout.trim() !== head)
			throw new Error(
				"La storia è cambiata: riapri il rebase interattivo e ricontrolla il piano."
			);

		// gli SHA del piano possono essere abbreviati: si confrontano sempre quelli completi
		const expectedResult = await runGit(
			info.root,
			["rev-list", "--reverse", `${base}..${head}`]
		);
		const expected = expectedResult.stdout
			.split("\n")
			.map((line) => line.trim())
			.filter(Boolean);
		const normalized: RebaseStep[] = [];
		for (const step of steps) {
			const resolved = await runGit(
				info.root,
				["rev-parse", "--verify", "-q", `${step.sha}^{commit}`],
				{ allowFailure: true }
			);
			if (resolved.code !== 0)
				throw new Error(`Commit non trovato: ${step.sha}`);
			normalized.push({ ...step, sha: resolved.stdout.trim() });
		}
		assertPlanCovers(normalized, expected);

		const entry = await this.#record(
			"commit",
			`Rebase interattivo di ${normalized.length} commit`
		);
		const directory = await mkdtemp(join(tmpdir(), "githandler-rebase-"));
		try {
			const todoPath = join(directory, "todo");
			const messages = join(directory, "messages");
			await mkdir(messages, { recursive: true });
			const todo = rebaseTodo(normalized, (index) =>
				join(messages, `${index}.txt`)
			);
			for (const [index, step] of normalized.entries()) {
				if (step.action !== "reword") continue;
				await writeFile(
					join(messages, `${index}.txt`),
					`${step.message!.trim()}\n`,
					"utf8"
				);
			}
			await writeFile(todoPath, todo, "utf8");

			// il piccolo editor copia il piano preparato: nessun input dell'utente passa per la shell
			const editor = join(directory, "sequence-editor.sh");
			await writeFile(
				editor,
				'#!/bin/sh\ncat "$GITHANDLER_REBASE_TODO" > "$1"\n',
				{ mode: 0o700 }
			);

			await runGit(info.root, ["rebase", "-i", base], {
				timeoutMs: 600_000,
				env: {
					GIT_SEQUENCE_EDITOR: editor,
					GIT_EDITOR: "true",
					GITHANDLER_REBASE_TODO: todoPath,
					GITHANDLER_REBASE_MESSAGES: messages,
				},
			});
		} catch (error) {
			if (entry) await this.#dropUndo(entry.id);
			throw error;
		} finally {
			await rm(directory, { recursive: true, force: true });
		}
		await this.#finalizeUndo(entry);
		return this.refresh();
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
			if (entry.target) {
				// reset e rebase spostano HEAD dove il pre-HEAD non è un progenitore: si controlla
				// il punto di arrivo, non la discendenza
				if (head !== entry.target)
					throw new Error(
						"La storia è cambiata: annullare perderebbe altri commit."
					);
			} else {
				const ancestor = await runGit(
					info.root,
					["merge-base", "--is-ancestor", entry.head, head],
					{ allowFailure: true }
				);
				if (ancestor.code !== 0)
					throw new Error(
						"La storia è cambiata: annullare perderebbe altri commit."
					);
			}
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
			if (!entry.stash && !entry.trash)
				throw new Error("Nessun contenuto salvato per questo scarto.");
			for (const path of entry.paths ?? []) {
				assertSafePath(path);
				if (!entry.stash) continue;
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
			if (entry.trash && entry.untrackedPaths) {
				// se qualcosa occupa già quel nome, `restoreFromTrash` si ferma prima di toccare
				// il repository: la voce resta annullabile.
				await restoreFromTrash({
					root: info.root,
					gitDir: info.gitDir,
					id: entry.trash,
					paths: entry.untrackedPaths,
				});
			}
		}

		await runGit(info.root, ["update-ref", "-d", snapshotRef(entry.id)], {
			allowFailure: true,
		});
		const remaining = entries.slice(1);
		await this.#writeUndo(remaining);
		await pruneTrash(
			info.root,
			info.gitDir,
			new Set(
				remaining
					.map((item) => item.trash)
					.filter((value): value is string => Boolean(value))
			)
		);
		return this.refresh();
	}

	async trashUsage(): Promise<TrashUsage> {
		// la finestra delle impostazioni si apre anche senza repository: zero, non un errore
		if (!this.#info) return { bytes: 0, files: 0, entries: 0 };
		const entries = await this.#readUndo();
		let bytes = 0;
		let files = 0;
		let count = 0;
		for (const entry of entries) {
			if (!entry.trash) continue;
			bytes += entry.trashBytes ?? 0;
			files += entry.trashFiles ?? 0;
			count++;
		}
		return { bytes, files, entries: count };
	}

	#undoPath(info: RepoInfo): string {
		return join(info.gitDir, "githandler", "undo.json");
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
		await this.#writeUndoRaw(entries);
	}

	async #writeUndoRaw(entries: unknown[]): Promise<void> {
		const path = this.#undoPath(this.#requireInfo());
		await mkdir(dirname(path), { recursive: true });
		const temporary = `${path}.tmp`;
		await writeFile(
			temporary,
			`${JSON.stringify(entries, null, "\t")}\n`,
			"utf8"
		);
		await rename(temporary, path);
	}

	/**
	 * Registra lo stato corrente prima di un'operazione distruttiva.
	 * Senza HEAD (repository senza commit) non c'è uno snapshot da conservare, ma per lo scarto dei
	 * file non tracciati la copia di sicurezza basta: `allowNoHead` lo consente.
	 *
	 * Il journal viene scritto **prima** di eliminare i ref delle voci uscite: un crash nel mezzo
	 * lascia al massimo un ref orfano (innocuo, e la potatura successiva lo toglie), mai una voce
	 * che promette un ripristino impossibile.
	 */
	async #record(
		kind: UndoKind,
		label: string,
		extra: {
			paths?: string[];
			stash?: string | null;
			trash?: string | null;
			untrackedPaths?: string[];
			trashBytes?: number;
			trashFiles?: number;
		} = {},
		options: { allowNoHead?: boolean; id?: string } = {}
	): Promise<UndoEntry | null> {
		const info = this.#requireInfo();
		const headResult = await runGit(
			info.root,
			["rev-parse", "--verify", "-q", "HEAD"],
			{ allowFailure: true }
		);
		const head = headResult.code === 0 ? headResult.stdout.trim() : "";
		if (!head && !options.allowNoHead) return null;

		const existing = await this.#readUndo();
		const id = options.id ?? (await this.#nextUndoId(kind, existing));

		const entry: UndoEntry = {
			id,
			kind,
			at: Date.now(),
			head: head || null,
			branch: info.branch,
			label,
			...extra,
		};

		if (head)
			await runGit(info.root, ["update-ref", snapshotRef(id), head]);

		let kept = [entry, ...existing].slice(0, UNDO_LIMIT);
		const dropped = [entry, ...existing].slice(UNDO_LIMIT);

		// Quota totale: si eliminano le voci più vecchie con una copia, mai quella appena creata.
		// La somma è dei byte logici conservati; la deduplica reale può solo migliorarla.
		const { quotaBytes } = (await this.#settings()).trash;
		let total = kept.reduce(
			(sum, item) => sum + (item.trash ? item.trashBytes ?? 0 : 0),
			0
		);
		while (total > quotaBytes) {
			let index = -1;
			for (let position = kept.length - 1; position >= 0; position--) {
				if (kept[position]!.trash) {
					index = position;
					break;
				}
			}
			if (index < 0 || kept[index]!.id === entry.id) break;
			const evicted = kept[index]!;
			dropped.push(evicted);
			total -= evicted.trashBytes ?? 0;
			kept = kept.filter((_, position) => position !== index);
		}

		await this.#writeUndo(kept);
		for (const item of dropped) await this.#discardEntry(item);
		await pruneTrash(
			info.root,
			info.gitDir,
			new Set(
				kept
					.map((item) => item.trash)
					.filter((value): value is string => Boolean(value))
			)
		);
		return entry;
	}

	/**
	 * Scrive nell'entry il HEAD prodotto dall'operazione. Senza, l'annullamento di reset e rebase
	 * non saprebbe riconoscere che HEAD è cambiato proprio per effetto dell'operazione.
	 */
	async #finalizeUndo(entry: UndoEntry | null): Promise<void> {
		if (!entry) return;
		const info = this.#requireInfo();
		const head = await runGit(
			info.root,
			["rev-parse", "--verify", "-q", "HEAD"],
			{ allowFailure: true }
		);
		if (head.code !== 0) return;
		const entries = await this.#readUndo();
		const found = entries.find((item) => item.id === entry.id);
		if (!found) return;
		found.target = head.stdout.trim();
		await this.#writeUndo(entries);
	}

	/** Cancella ref e snapshot di una voce che non è più annullabile. */
	async #discardEntry(entry: UndoEntry): Promise<void> {
		const info = this.#requireInfo();
		if (entry.trash) await removeTrash(info.root, info.gitDir, entry.trash);
		await runGit(info.root, ["update-ref", "-d", snapshotRef(entry.id)], {
			allowFailure: true,
		});
	}

	/** Toglie una voce registrata per un'operazione poi fallita. */
	async #dropUndo(id: string): Promise<void> {
		const entries = await this.#readUndo();
		const dropped = entries.find((entry) => entry.id === id);
		await this.#writeUndo(entries.filter((entry) => entry.id !== id));
		if (dropped) await this.#discardEntry(dropped);
	}

	/** Id libero per una nuova voce, senza leggere due volte il journal. */
	async #nextUndoId(kind: UndoKind, existing?: UndoEntry[]): Promise<string> {
		const entries = existing ?? (await this.#readUndo());
		let id = undoId(kind);
		if (entries.some((entry) => entry.id === id))
			id = `${id}-${entries.length + 1}`;
		return id;
	}

	/** Il repository aperto, per chi deve sapere dove girare (terminale, watcher). */
	get info(): RepoInfo | null {
		return this.#info;
	}

	/** File di stato che Git lascia quando merge, rebase o cherry-pick sono sospesi. */
	async #operation(gitDir: string): Promise<RepoOperation | null> {
		const exists = async (name: string): Promise<boolean> => {
			try {
				await access(join(gitDir, name));
				return true;
			} catch {
				return false;
			}
		};
		if (await exists("MERGE_HEAD")) return "merge";
		if (await exists("CHERRY_PICK_HEAD")) return "cherry-pick";
		if ((await exists("rebase-merge")) || (await exists("rebase-apply")))
			return "rebase";
		return null;
	}

	#requireInfo(): RepoInfo {
		if (!this.#info) throw new Error("Nessun repository aperto.");
		return this.#info;
	}
}
