import { readFile } from "node:fs/promises";
import { isAbsolute, relative, resolve } from "node:path";

import { runGitBytes } from "./git.ts";

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
