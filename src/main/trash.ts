import { cp, lstat, mkdir, readdir, rm, stat } from "node:fs/promises";
import { dirname, join } from "node:path";

/**
 * Copia di sicurezza dei file non tracciati scartati.
 *
 * Git non può conservare ciò che non ha mai tracciato: uno stash commit lo ignora. Prima della
 * cancellazione l'app copia il file (o la cartella) dentro `.git/gitcraft/trash/<id>/`, nella stessa
 * posizione relativa; l'annullamento ricopia indietro e poi elimina la copia.
 *
 * Il tetto di dimensione e numero di file esiste per non riempire il disco con una cartella di
 * build. Superarlo non è un errore di Git: chi scarta decide, e la conferma lo spiega.
 */

export const TRASH_MAX_BYTES = 25 * 1024 * 1024;
export const TRASH_MAX_FILES = 2000;

export interface TrashLimits {
	maxBytes?: number;
	maxFiles?: number;
}

export class TrashLimitError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "TrashLimitError";
	}
}

interface TreeSize {
	bytes: number;
	files: number;
}

/** Misura senza seguire i link simbolici e senza leggere il contenuto. */
async function measureTree(path: string): Promise<TreeSize> {
	const info = await lstat(path);
	if (info.isSymbolicLink()) return { bytes: 0, files: 1 };
	if (!info.isDirectory()) return { bytes: info.size, files: 1 };

	let bytes = 0;
	let files = 0;
	for (const entry of await readdir(path)) {
		const child = await measureTree(join(path, entry));
		bytes += child.bytes;
		files += child.files;
	}
	return { bytes, files };
}

export function trashDirectory(gitDir: string, id: string): string {
	return join(gitDir, "gitcraft", "trash", id);
}

/**
 * Copia i path dentro la cartella di servizio. I path sono relativi alla radice del repository.
 * Se un path non esiste più (cancellato mentre l'operazione era in corso) viene saltato.
 */
export async function copyToTrash(options: {
	gitDir: string;
	root: string;
	id: string;
	paths: string[];
	limits?: TrashLimits;
}): Promise<void> {
	const maxBytes = options.limits?.maxBytes ?? TRASH_MAX_BYTES;
	const maxFiles = options.limits?.maxFiles ?? TRASH_MAX_FILES;

	let bytes = 0;
	let files = 0;
	for (const path of options.paths) {
		try {
			const size = await measureTree(join(options.root, path));
			bytes += size.bytes;
			files += size.files;
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code === "ENOENT") continue;
			throw error;
		}
	}

	if (bytes > maxBytes || files > maxFiles) {
		throw new TrashLimitError(
			`La copia di sicurezza supera il limite (${Math.round(
				maxBytes / 1024 / 1024
			)} MB, ${maxFiles} file). Il file non è stato toccato.`
		);
	}

	const destination = trashDirectory(options.gitDir, options.id);
	await mkdir(destination, { recursive: true });

	for (const path of options.paths) {
		const source = join(options.root, path);
		try {
			await lstat(source);
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code === "ENOENT") continue;
			throw error;
		}
		const target = join(destination, path);
		await mkdir(dirname(target), { recursive: true });
		await cp(source, target, {
			recursive: true,
			force: true,
			errorOnExist: false,
			preserveTimestamps: true,
		});
	}
}

/**
 * Ripristina dal trash. Se nel repository esiste già qualcosa con lo stesso nome non sovrascrive:
 * il lavoro fatto dopo lo scarto vale più della copia, quindi si ferma e lo dice.
 */
export async function restoreFromTrash(options: {
	gitDir: string;
	root: string;
	id: string;
	paths: string[];
}): Promise<void> {
	const source = trashDirectory(options.gitDir, options.id);

	for (const path of options.paths) {
		const destination = join(options.root, path);
		try {
			await stat(destination);
			throw new Error(
				`${path} esiste già: spostalo o cancellalo, poi annulla di nuovo.`
			);
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
		}
	}

	for (const path of options.paths) {
		const from = join(source, path);
		try {
			await lstat(from);
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code === "ENOENT") continue;
			throw error;
		}
		const to = join(options.root, path);
		await mkdir(dirname(to), { recursive: true });
		await cp(from, to, {
			recursive: true,
			force: false,
			errorOnExist: true,
		});
	}

	await removeTrash(options.gitDir, options.id);
}

export async function removeTrash(gitDir: string, id: string): Promise<void> {
	await rm(trashDirectory(gitDir, id), { recursive: true, force: true });
}

/** Elimina le copie che non servono più al journal (voci scartate per limite o annullate). */
export async function pruneTrash(
	gitDir: string,
	keep: Set<string>
): Promise<void> {
	const base = join(gitDir, "gitcraft", "trash");
	let entries: string[];
	try {
		entries = await readdir(base);
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
		throw error;
	}
	await Promise.all(
		entries
			.filter((entry) => !keep.has(entry))
			.map((entry) =>
				rm(join(base, entry), { recursive: true, force: true })
			)
	);
}
