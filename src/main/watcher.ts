import { watch, type FSWatcher } from "node:fs";

/**
 * Sorveglianza del repository: `fs.watch` ricorsivo sulla radice, filtro sui path che non
 * cambiano ciò che l'app mostra, debounce per non rileggere Git a ogni salvataggio.
 *
 * L'evento è un semplice "qualcosa è cambiato": chi lo riceve rilegge lo stato con `refresh()`.
 * Così non esiste una seconda interpretazione del filesystem.
 */

export interface WatcherOptions {
	root: string;
	debounceMs?: number;
	onChange: () => void;
	/** sostituibile nei test; di default `isInterestingPath` */
	ignore?: (relativePath: string) => boolean;
}

const IGNORED_PREFIXES = [".git/objects/", ".git/lfs/", ".git/gitcraft/"];
const IGNORED_SEGMENTS = ["node_modules", ".cache"];

/** Il path è relativo alla radice del repository, con separatori `/`. */
export function isInterestingPath(relativePath: string): boolean {
	const path = relativePath.replace(/\\/g, "/").replace(/^\.\//, "");
	if (!path) return true;
	if (IGNORED_PREFIXES.some((prefix) => path.startsWith(prefix)))
		return false;
	if (IGNORED_SEGMENTS.some((segment) => path.split("/").includes(segment)))
		return false;
	if (path.endsWith(".lock") || path.endsWith(".swp") || path.endsWith("~"))
		return false;
	return true;
}

export class Debouncer {
	#timer: ReturnType<typeof setTimeout> | null = null;
	readonly #ms: number;
	readonly #run: () => void;

	constructor(ms: number, run: () => void) {
		this.#ms = ms;
		this.#run = run;
	}

	trigger(): void {
		if (this.#timer) clearTimeout(this.#timer);
		this.#timer = setTimeout(() => {
			this.#timer = null;
			this.#run();
		}, this.#ms);
	}

	cancel(): void {
		if (this.#timer) clearTimeout(this.#timer);
		this.#timer = null;
	}
}

/** Avvia la sorveglianza e restituisce la funzione che la ferma; `null` se non è possibile. */
export function startWatcher(
	options: WatcherOptions
): (() => void) | null {
	const debounceMs = options.debounceMs ?? 400;
	const ignore = options.ignore ?? ((path) => !isInterestingPath(path));
	const debouncer = new Debouncer(debounceMs, options.onChange);

	let watcher: FSWatcher;
	try {
		watcher = watch(
			options.root,
			{ recursive: true },
			(_event, filename) => {
				const relative = filename ? String(filename) : "";
				if (relative && ignore(relative)) return;
				debouncer.trigger();
			}
		);
	} catch {
		// radice rimossa o permessi negati: l'app resta usabile con l'aggiornamento manuale
		return null;
	}

	watcher.on("error", () => {
		debouncer.cancel();
	});

	return () => {
		debouncer.cancel();
		watcher.close();
	};
}
