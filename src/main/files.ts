import { readFile } from "node:fs/promises";
import { isAbsolute, relative, resolve } from "node:path";

import { assertRefName } from "../core/ops.ts";
import type { RepoFileList } from "../shared/api.ts";
import { runGit, runGitBytes } from "./git.ts";

/**
 * Byte di un file, dal working tree o da un commit.
 *
 * Il renderer manda un percorso relativo e non è una fonte attendibile: qui si controlla che resti
 * dentro il repository (`resolveInside`) e che un commit sia uno SHA. Niente shell: `git show`
 * riceve i due pezzi come un solo argomento, `sha:path`.
 */

/** Oltre questo limite si ferma con un messaggio: meglio un errore che una copia troncata. */
export const MAX_FILE_BYTES = 64 * 1024 * 1024;

const SHA_RE = /^[0-9a-f]{7,64}$/;

/** Percorso relativo al repository, risolto e verificato: nessun `..`, nessun `-`, nessun assoluto. */
export function resolveInside(root: string, path: string): string {
	const value = path.trim();
	if (!value) throw new Error("Percorso mancante.");
	if (
		value.startsWith("/") ||
		value.startsWith("-") ||
		value.includes("\u0000")
	)
		throw new Error(`Percorso non valido: ${path}`);
	const resolved = resolve(root, value);
	const rel = relative(root, resolved);
	if (!rel || rel.startsWith("..") || isAbsolute(rel))
		throw new Error(`Percorso fuori dal repository: ${path}`);
	return resolved;
}

function assertBlobPath(path: string): string {
	const value = path.trim();
	if (
		!value ||
		value.startsWith("/") ||
		value.startsWith("-") ||
		value.split("/").includes("..") ||
		value.includes("\u0000")
	)
		throw new Error(`Percorso non valido: ${path}`);
	return value;
}

function checkSize(bytes: Buffer): Buffer {
	if (bytes.length > MAX_FILE_BYTES)
		throw new Error(
			`Il file supera ${
				MAX_FILE_BYTES / (1024 * 1024)
			} MiB: usa il gestore file.`
		);
	return bytes;
}

/** Contenuto attuale di un file del repository. */
export async function readWorkingFile(
	root: string,
	path: string
): Promise<Buffer> {
	const absolute = resolveInside(root, path);
	return checkSize(await readFile(absolute));
}

/** Contenuto di un file così com'era in un commit (`git show <sha>:<path>`), byte per byte. */
export async function readCommitFile(
	root: string,
	sha: string,
	path: string
): Promise<Buffer> {
	if (!SHA_RE.test(sha)) throw new Error(`SHA non valido: ${sha}`);
	const safe = assertBlobPath(path);
	const result = await runGitBytes(root, ["show", `${sha}:${safe}`], {
		timeoutMs: 60_000,
	});
	return checkSize(result.stdout);
}

/** Oltre questo numero la lista si tronca: il dialogo non deve ricevere un elenco infinito. */
export const MAX_LISTED_FILES = 20_000;

/**
 * I file tracciati, per il selettore «Apri un file del repository».
 *
 * Con un ref si legge quell'albero; senza, HEAD. Su un repository senza commit HEAD non esiste e
 * si legge l'indice, che è quello che l'utente sta per committare. `-z` separa i nomi con NUL, così
 * un nome con spazi o a capo non diventa due righe.
 */
export async function listRepoFiles(
	root: string,
	ref: string | null = null
): Promise<RepoFileList> {
	const read = async (args: string[]): Promise<string[] | null> => {
		const result = await runGit(root, args, {
			allowFailure: true,
			timeoutMs: 60_000,
		});
		if (result.code !== 0) return null;
		return result.stdout.split("\0").filter(Boolean);
	};

	let files: string[] | null;
	if (ref) {
		assertRefName(ref);
		files = await read(["ls-tree", "-r", "-z", "--name-only", ref]);
		if (!files) throw new Error(`Nessun file nel ref «${ref}».`);
	} else {
		files = await read(["ls-tree", "-r", "-z", "--name-only", "HEAD"]);
		// il primo commit non c'è ancora: l'indice è la risposta giusta
		if (!files) files = (await read(["ls-files", "-z"])) ?? [];
	}

	const truncated = files.length > MAX_LISTED_FILES;
	return {
		files: truncated ? files.slice(0, MAX_LISTED_FILES) : files,
		truncated,
	};
}
