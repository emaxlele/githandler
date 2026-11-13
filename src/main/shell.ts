import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { chmod, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { bashCandidates, POSIX_BASH, shellPlatform } from "../core/shell.ts";

/**
 * L'unica differenza fra Linux e Windows nel resto del programma: **come si esegue uno script sh**.
 *
 * Il programma scrive tre script in `sh` — l'askpass delle credenziali, l'editor del rebase e il
 * terminale dell'utente — e su Linux li esegue perché hanno il permesso di esecuzione. Su Windows
 * non esiste il bit di esecuzione: Git per Windows porta con sé `bash.exe`, quindi lo script resta
 * lo stesso e cambia solo il modo di lanciarlo, con un `.bat` di una riga accanto.
 */

let cached: string | null = null;
let execPathCache: string | null | undefined;

/** `git --exec-path`, una volta sola: serve a trovare `bash` accanto a `git`. */
async function gitExecPath(): Promise<string | null> {
	if (execPathCache !== undefined) return execPathCache;
	execPathCache = await new Promise<string | null>((resolve) => {
		execFile(
			"git",
			["--exec-path"],
			{ timeout: 10_000 },
			(error, stdout) => {
				resolve(error ? null : stdout.trim() || null);
			}
		);
	});
	return execPathCache;
}

/**
 * Percorso di `bash`. Su Windows lo cerca accanto a `git`; se non c'è, lo dice invece di lasciare
 * un terminale che non parte.
 */
export async function resolveBash(): Promise<string> {
	if (cached) return cached;
	if (shellPlatform(process.platform) === "posix") {
		cached = POSIX_BASH;
		return cached;
	}
	const candidates = bashCandidates(
		process.platform,
		await gitExecPath(),
		process.env
	);
	const found = candidates.find((candidate) => existsSync(candidate));
	if (!found)
		throw new Error(
			"bash non trovato: GitHandler usa bash per il terminale e per le credenziali, e Git per Windows lo installa insieme a git."
		);
	cached = found;
	return cached;
}

/**
 * Una cartella che non è un repository, per i comandi che non devono leggere la configurazione
 * locale di un progetto (`git credential fill`, per esempio). Su Windows `/` sarebbe la radice
 * dell'unità corrente: la home è più prevedibile.
 */
export function neutralCwd(): string {
	return shellPlatform(process.platform) === "posix" ? "/" : homedir();
}

/**
 * Scrive uno script `sh` e restituisce il percorso da usare come programma: lo script stesso su
 * Linux, un `.bat` che lo lancia con `bash` su Windows. `name` non deve contenere separatori.
 */
export async function writeExecutableScript(
	directory: string,
	name: string,
	body: string
): Promise<string> {
	if (name.includes("/") || name.includes("\\"))
		throw new Error(`Nome di script non valido: ${name}`);

	const script = join(directory, `${name}.sh`);
	const windows = shellPlatform(process.platform) === "windows";
	await writeFile(script, body, { encoding: "utf8", mode: 0o700 });
	// `writeFile` non cambia i permessi di un file che esiste già; su Windows il bit non esiste
	if (!windows) await chmod(script, 0o700);
	if (!windows) return script;

	const bash = await resolveBash();
	const wrapper = join(directory, `${name}.bat`);
	const content = `@echo off\r\n"${bash}" "%~dp0${name}.sh" %*\r\n`;
	await writeFile(wrapper, content, { encoding: "utf8" });
	return wrapper;
}
