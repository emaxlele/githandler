import { createHash } from "node:crypto";
import {
	cp,
	lstat,
	mkdir,
	readdir,
	readlink,
	rename,
	rm,
} from "node:fs/promises";
import { basename, dirname, isAbsolute, join, normalize } from "node:path";

import { runGit } from "./git.ts";

/**
 * Copia di sicurezza dei file non tracciati scartati, **dentro Git**.
 *
 * Git non può conservare ciò che non ha mai tracciato, ma può conservare i byte: prima della
 * cancellazione ogni file viene scritto come blob (`hash-object -w`), l'insieme diventa un albero e
 * un commit, e il commit resta raggiungibile tramite `refs/gitlattice/trash/<scope>/<id>`.
 *
 * Perché così e non con una copia di cartelle:
 * - compressione e deduplica: due scarti identici costano una volta sola;
 * - scrittura atomica e integrità: gli oggetti sono content-addressed;
 * - `git show <ref>:<path>` e `git diff` funzionano senza codice nostro;
 * - `git gc` rispetta il ref, quindi il contenuto non sparisce finché la voce è annullabile.
 *
 * Gli oggetti **non entrano nella storia del progetto**: il ref è in un namespace nostro e il log
 * dell'app lo esclude. Quando una voce esce dal journal, il ref viene eliminato e gli oggetti
 * diventano irraggiungibili; lo spazio lo recupera il `git gc` dell'utente, con le sue regole.
 *
 * I limiti (byte e file per operazione) sono misurati prima di scrivere: oltre soglia lo scarto si
 * rifiuta, non si cancella senza rete.
 */

export interface TrashLimits {
	maxBytes: number;
	maxFiles: number;
}

export class TrashLimitError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "TrashLimitError";
	}
}

export class TrashUnsupportedError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "TrashUnsupportedError";
	}
}

export interface StoredTrash {
	bytes: number;
	files: number;
}

type Mode = "100644" | "100755" | "120000";

interface StoredEntry {
	path: string;
	mode: Mode;
	bytes: number;
}

/**
 * Namespace dei ref. In un worktree collegato la cartella `gitDir` è per-worktree, quindi due
 * worktree aperti insieme avrebbero journal diversi ma ref condivisi: l'id del worktree nel nome
 * evita che uno sfalci le voci dell'altro. Nome ripulito + hash breve: stabile e valido come ref.
 */
export function trashRefPrefix(gitDir: string): string {
	return `refs/gitlattice/trash/${trashScope(gitDir)}/`;
}

export function trashRef(gitDir: string, id: string): string {
	return `${trashRefPrefix(gitDir)}${id}`;
}

function trashScope(gitDir: string): string {
	if (basename(dirname(gitDir)) !== "worktrees") return "main";
	const hash = createHash("sha1").update(gitDir).digest("hex").slice(0, 8);
	const name = basename(gitDir)
		.replace(/[^A-Za-z0-9_-]/g, "_")
		.slice(0, 24);
	return `${name || "worktree"}-${hash}`;
}

/** Cartella delle copie create dalla v0.4, prima degli oggetti Git. Serve solo a ripristinarle. */
export function trashDirectory(gitDir: string, id: string): string {
	return join(gitDir, "gitlattice", "trash", id);
}

function tempIndex(gitDir: string, id: string, suffix: string): string {
	return join(gitDir, "gitlattice", "tmp", `${id}-${suffix}.index`);
}

/** Path relativi, senza risalite: il chiamante ha già validato, ma qui non ci si fida comunque. */
function assertRelative(path: string): string {
	const cleaned = normalize(path).replace(/\/+$/, "").replace(/^\.\//, "");
	if (
		!cleaned ||
		cleaned === "." ||
		isAbsolute(cleaned) ||
		cleaned.split("/").includes("..")
	)
		throw new Error(
			`Percorso non valido per la copia di sicurezza: ${path}`
		);
	return cleaned;
}

async function lstatOptional(
	path: string
): Promise<Awaited<ReturnType<typeof lstat>> | null> {
	try {
		return await lstat(path);
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
		throw error;
	}
}

/** Il limite in una forma leggibile anche quando è più piccolo di un MB (test, chiamate dirette). */
function formatLimit(bytes: number): string {
	if (bytes >= 1024 * 1024) return `${Math.round(bytes / 1024 / 1024)} MB`;
	return `${Math.max(1, Math.round(bytes / 1024))} kB`;
}

/**
 * Git rifiuta — **in silenzio** — i path con una componente `.git` (o una variante NTFS tipo
 * `git~1`): è la protezione contro i sotto-repository annidati. Un `update-index` che li salta
 * perderebbe proprio i metadati del sotto-repo, quindi quelle componenti vengono marcate con
 * `%00` solo dentro l'albero; al ripristino tornano col nome originale.
 *
 * La codifica è reversibile: ogni `%` diventa `%25`, quindi un nome che inizia davvero con `%00`
 * non può collidere con una componente marcata. Le altre componenti restano leggibili in
 * `git show`.
 */
function encodeComponent(name: string): string {
	const escaped = name.replaceAll("%", "%25");
	const risky =
		/^\.git([. ]|$)/i.test(name) || /^(git|\.git)~[0-9]+/i.test(name);
	return risky ? `%00${escaped}` : escaped;
}

function encodePath(path: string): string {
	return path.split("/").map(encodeComponent).join("/");
}

function decodeComponent(name: string): string {
	const marked = name.startsWith("%00");
	return (marked ? name.slice(3) : name).replaceAll("%25", "%");
}

function decodePath(path: string): string {
	return path.split("/").map(decodeComponent).join("/");
}

/**
 * Elenca file e link sotto i path richiesti, senza seguirli e senza leggere il contenuto.
 * Si ferma appena supera un limite: non serve misurare una cartella da 10 GB per dire che è troppo.
 */
async function collectEntries(
	root: string,
	paths: string[],
	limits: TrashLimits
): Promise<{ entries: StoredEntry[]; bytes: number }> {
	const entries = new Map<string, StoredEntry>();
	let bytes = 0;

	const check = (): void => {
		if (bytes > limits.maxBytes)
			throw new TrashLimitError(
				`La copia di sicurezza supera il limite di ${formatLimit(
					limits.maxBytes
				)} per operazione. Non è stato cancellato nulla.`
			);
		if (entries.size > limits.maxFiles)
			throw new TrashLimitError(
				`La copia di sicurezza supera il limite di ${limits.maxFiles} file per operazione. Non è stato cancellato nulla.`
			);
	};

	const add = (entry: StoredEntry): void => {
		// due path che si sovrappongono (es. `cartella/` e `cartella/file`) non devono contare due
		// volte né comparire due volte nell'indice
		if (entries.has(entry.path)) return;
		entries.set(entry.path, entry);
		bytes += entry.bytes;
		check();
	};

	const walk = async (relative: string): Promise<void> => {
		const absolute = join(root, relative);
		const info = await lstatOptional(absolute);
		if (!info) return; // sparito mentre si misurava: niente da salvare

		if (info.isSymbolicLink()) {
			const target = await readlink(absolute);
			add({
				path: relative,
				mode: "120000",
				bytes: Buffer.byteLength(target),
			});
			return;
		}

		if (info.isDirectory()) {
			const names = (await readdir(absolute)).sort();
			for (const name of names) await walk(`${relative}/${name}`);
			return;
		}

		if (!info.isFile())
			throw new TrashUnsupportedError(
				`Impossibile conservare «${relative}»: non è un file, una cartella o un link. Lo scarto è stato annullato.`
			);

		add({
			path: relative,
			mode: Number(info.mode) & 0o111 ? "100755" : "100644",
			bytes: Number(info.size),
		});
	};

	for (const path of paths) await walk(assertRelative(path));
	return { entries: [...entries.values()], bytes };
}

/**
 * Scrive i blob e restituisce path → sha. `hash-object` senza `--path` non applica filtri né
 * `core.autocrlf`, quindi i byte salvati sono esattamente quelli su disco (niente puntatori LFS).
 */
async function hashFiles(
	root: string,
	gitDir: string,
	paths: string[]
): Promise<Map<string, string>> {
	const hashes = new Map<string, string>();
	const simple: string[] = [];
	const odd: string[] = [];
	for (const path of paths)
		(path.includes("\n") || path.includes("\r") ? odd : simple).push(path);

	const BATCH = 500;
	for (let index = 0; index < simple.length; index += BATCH) {
		const batch = simple.slice(index, index + BATCH);
		const result = await runGit(
			root,
			["--git-dir", gitDir, "hash-object", "-w", "--stdin-paths"],
			{ input: `${batch.join("\n")}\n`, timeoutMs: 120_000 }
		);
		const lines = result.stdout.split("\n").map((line) => line.trim());
		if (lines.filter(Boolean).length !== batch.length)
			throw new Error(
				"Git non ha restituito un hash per ogni file della copia di sicurezza."
			);
		batch.forEach((path, position) => {
			hashes.set(path, lines[position]!);
		});
	}

	// Un path con newline non può stare nel formato a righe: lo si passa come argomento.
	for (const path of odd) {
		const result = await runGit(root, [
			"--git-dir",
			gitDir,
			"hash-object",
			"-w",
			"--",
			path,
		]);
		hashes.set(path, result.stdout.trim());
	}
	return hashes;
}

async function hashSymlink(
	root: string,
	gitDir: string,
	relative: string
): Promise<string> {
	const target = await readlink(join(root, relative));
	const result = await runGit(
		root,
		["--git-dir", gitDir, "hash-object", "-w", "--stdin"],
		{ input: target }
	);
	return result.stdout.trim();
}

/**
 * Salva i path come un commit raggiungibile da `refs/gitlattice/trash/...`.
 * Restituisce `null` se non c'era più niente da salvare (file spariti nel frattempo).
 */
export async function storeTrash(options: {
	root: string;
	gitDir: string;
	id: string;
	paths: string[];
	limits: TrashLimits;
}): Promise<StoredTrash | null> {
	const { entries, bytes } = await collectEntries(
		options.root,
		options.paths,
		options.limits
	);
	if (entries.length === 0) return null;

	const files = entries.filter((entry) => entry.mode !== "120000");
	const hashes = await hashFiles(
		options.root,
		options.gitDir,
		files.map((entry) => entry.path)
	);
	for (const entry of files) {
		const sha = hashes.get(entry.path);
		if (!sha)
			throw new Error(
				`Hash mancante per ${entry.path}: copia di sicurezza annullata.`
			);
	}
	const shas = new Map<string, string>(hashes);
	for (const entry of entries) {
		if (entry.mode !== "120000") continue;
		shas.set(
			entry.path,
			await hashSymlink(options.root, options.gitDir, entry.path)
		);
	}

	const indexFile = tempIndex(options.gitDir, options.id, "store");
	await mkdir(dirname(indexFile), { recursive: true });
	await rm(indexFile, { force: true });
	const env = { GIT_INDEX_FILE: indexFile };

	try {
		const indexInfo = entries
			.map(
				(entry) =>
					`${entry.mode} ${shas.get(entry.path)}\t${encodePath(
						entry.path
					)}\0`
			)
			.join("");
		await runGit(
			options.root,
			["--git-dir", options.gitDir, "update-index", "-z", "--index-info"],
			{ input: indexInfo, env, timeoutMs: 120_000 }
		);

		const tree = (
			await runGit(
				options.root,
				["--git-dir", options.gitDir, "write-tree"],
				{ env, timeoutMs: 120_000 }
			)
		).stdout.trim();
		if (!tree)
			throw new Error("Albero della copia di sicurezza non creato.");

		// `update-index` ignora in silenzio i path che non accetta (altri nomi NTFS, caratteri di
		// controllo): senza questo confronto si cancellerebbe credendo di avere una copia completa.
		const listed = await runGit(
			options.root,
			[
				"--git-dir",
				options.gitDir,
				"ls-tree",
				"-r",
				"-z",
				"--name-only",
				tree,
			],
			{ timeoutMs: 120_000 }
		);
		const stored = new Set(listed.stdout.split("\0").filter(Boolean));
		const missing = entries
			.map((entry) => encodePath(entry.path))
			.filter((path) => !stored.has(path));
		if (missing.length > 0)
			throw new TrashUnsupportedError(
				`Git non può conservare ${missing
					.slice(0, 3)
					.map((path) => `«${decodePath(path)}»`)
					.join(", ")}${
					missing.length > 3 ? ` e altri ${missing.length - 3}` : ""
				}: nomi non validi per un albero Git. Lo scarto è stato annullato.`
			);

		const commit = (
			await runGit(
				options.root,
				[
					"--git-dir",
					options.gitDir,
					"commit-tree",
					tree,
					"-m",
					`gitlattice: discarded ${entries.length} path(s)`,
				],
				{ env: identityEnv() }
			)
		).stdout.trim();
		if (!commit)
			throw new Error("Commit della copia di sicurezza non creato.");

		await runGit(options.root, [
			"--git-dir",
			options.gitDir,
			"update-ref",
			trashRef(options.gitDir, options.id),
			commit,
		]);
	} finally {
		await rm(indexFile, { force: true });
	}

	return { bytes, files: entries.length };
}

/** Identità fissa: il commit del trash non deve dipendere dalla config dell'utente. */
function identityEnv(): Record<string, string> {
	return {
		GIT_AUTHOR_NAME: "gitlattice",
		GIT_AUTHOR_EMAIL: "gitlattice@localhost",
		GIT_COMMITTER_NAME: "gitlattice",
		GIT_COMMITTER_EMAIL: "gitlattice@localhost",
	};
}

/**
 * Ripristina lo scarto. Se nel repository esiste già qualcosa con lo stesso nome non sovrascrive:
 * il lavoro fatto dopo vale più della copia, quindi si ferma e lo dice. La voce resta annullabile.
 *
 * Le copie della v0.4 (cartelle sotto `.git/gitlattice/trash/`) sono ancora ripristinabili: chi
 * aggiorna l'app non perde la rete di sicurezza già creata.
 */
export async function restoreFromTrash(options: {
	root: string;
	gitDir: string;
	id: string;
	paths: string[];
}): Promise<void> {
	const ref = trashRef(options.gitDir, options.id);
	const exists = await runGit(
		options.root,
		["--git-dir", options.gitDir, "rev-parse", "--verify", "--quiet", ref],
		{ allowFailure: true }
	);
	if (exists.code === 0) return restoreRef({ ...options, ref });
	return restoreLegacy(options);
}

async function restoreRef(options: {
	root: string;
	gitDir: string;
	id: string;
	ref: string;
}): Promise<void> {
	const listing = await runGit(options.root, [
		"--git-dir",
		options.gitDir,
		"ls-tree",
		"-r",
		"-z",
		"--name-only",
		options.ref,
	]);
	const stored = listing.stdout.split("\0").filter(Boolean);
	if (stored.length === 0)
		throw new Error(
			"La copia di sicurezza è vuota: niente da ripristinare."
		);

	// L'albero ha i nomi codificati (`.git` non è rappresentabile): sul disco tornano originali.
	const paths = stored.map(decodePath);
	for (const path of paths) await assertRestorable(options.root, path);

	const staging = join(options.gitDir, "gitlattice", "restore", options.id);
	await rm(staging, { recursive: true, force: true });
	await mkdir(staging, { recursive: true });
	const indexFile = tempIndex(options.gitDir, options.id, "restore");
	await mkdir(dirname(indexFile), { recursive: true });
	await rm(indexFile, { force: true });

	try {
		await runGit(
			options.root,
			["--git-dir", options.gitDir, "read-tree", options.ref],
			{ env: { GIT_INDEX_FILE: indexFile } }
		);
		await runGit(
			options.root,
			[
				"--git-dir",
				options.gitDir,
				"checkout-index",
				"-a",
				`--prefix=${staging}/`,
			],
			{ env: { GIT_INDEX_FILE: indexFile }, timeoutMs: 120_000 }
		);

		for (let index = 0; index < paths.length; index++) {
			const from = join(staging, stored[index]!);
			const to = join(options.root, paths[index]!);
			await mkdir(dirname(to), { recursive: true });
			await moveFile(from, to);
		}
	} finally {
		await rm(staging, { recursive: true, force: true });
		await rm(indexFile, { force: true });
	}

	await runGit(
		options.root,
		["--git-dir", options.gitDir, "update-ref", "-d", options.ref],
		{ allowFailure: true }
	);
}

/** Il path finale e ogni suo genitore devono essere liberi (o cartelle). */
async function assertRestorable(root: string, path: string): Promise<void> {
	if (await lstatOptional(join(root, path)))
		throw new Error(
			`${path} esiste già: spostalo o cancellalo, poi annulla di nuovo.`
		);

	const parts = path.split("/");
	for (let index = 1; index < parts.length; index++) {
		const parent = join(root, ...parts.slice(0, index));
		const info = await lstatOptional(parent);
		if (!info) continue;
		if (!info.isDirectory())
			throw new Error(
				`${parts
					.slice(0, index)
					.join(
						"/"
					)} non è una cartella: impossibile ripristinare ${path}.`
			);
	}
}

async function moveFile(from: string, to: string): Promise<void> {
	try {
		await rename(from, to);
	} catch (error) {
		// Staging e working tree stanno di solito sullo stesso filesystem; se non è così si copia.
		if ((error as NodeJS.ErrnoException).code !== "EXDEV") throw error;
		await cp(from, to, { force: false, errorOnExist: true });
		await rm(from, { force: true });
	}
}

async function restoreLegacy(options: {
	root: string;
	gitDir: string;
	id: string;
	paths: string[];
}): Promise<void> {
	const source = trashDirectory(options.gitDir, options.id);
	if (!(await lstatOptional(source)))
		throw new Error(
			"La copia di sicurezza non è più disponibile: è stata eliminata o non è mai stata creata."
		);

	for (const path of options.paths) {
		if (await lstatOptional(join(options.root, path)))
			throw new Error(
				`${path} esiste già: spostalo o cancellalo, poi annulla di nuovo.`
			);
	}

	for (const path of options.paths) {
		const from = join(source, path);
		if (!(await lstatOptional(from))) continue;
		const to = join(options.root, path);
		await mkdir(dirname(to), { recursive: true });
		await cp(from, to, {
			recursive: true,
			force: false,
			errorOnExist: true,
		});
	}

	await rm(source, { recursive: true, force: true });
}

/** Elimina una copia: il ref Git e, se esiste, la cartella del formato v0.4. */
export async function removeTrash(
	root: string,
	gitDir: string,
	id: string
): Promise<void> {
	await runGit(
		root,
		["--git-dir", gitDir, "update-ref", "-d", trashRef(gitDir, id)],
		{ allowFailure: true }
	);
	await rm(trashDirectory(gitDir, id), { recursive: true, force: true });
}

/**
 * Elimina i ref che non servono più al journal. Gli oggetti restano finché `git gc` non li tocca:
 * non lanciamo `prune --expire=now`, che cancellerebbe anche i commit dangling dell'utente.
 */
export async function pruneTrash(
	root: string,
	gitDir: string,
	keep: Set<string>
): Promise<void> {
	const prefix = trashRefPrefix(gitDir);
	const refs = await runGit(
		root,
		["--git-dir", gitDir, "for-each-ref", "--format=%(refname)", prefix],
		{ allowFailure: true }
	);
	for (const ref of refs.stdout.split("\n").map((line) => line.trim())) {
		if (!ref || !ref.startsWith(prefix)) continue;
		if (keep.has(ref.slice(prefix.length))) continue;
		await runGit(root, ["--git-dir", gitDir, "update-ref", "-d", ref], {
			allowFailure: true,
		});
	}

	// Copie del formato v0.4: nessuna è più creata, quindi tutte le cartelle sono orfane se non
	// compaiono nel journal.
	const legacy = join(gitDir, "gitlattice", "trash");
	let entries: string[];
	try {
		entries = await readdir(legacy);
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
		throw error;
	}
	await Promise.all(
		entries
			.filter((entry) => !keep.has(entry))
			.map((entry) =>
				rm(join(legacy, entry), { recursive: true, force: true })
			)
	);
}

