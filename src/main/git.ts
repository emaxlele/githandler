import { execFile, spawn } from "node:child_process";

import { ProgressReader, type NetworkProgress } from "../core/network.ts";

export interface GitResult {
	code: number;
	stdout: string;
	stderr: string;
}

export interface RunOptions {
	/** Testo scritto su stdin (messaggi di commit: niente quoting, niente limiti di argv). */
	input?: string;
	timeoutMs?: number;
	/** Un exit code diverso da 0 non è un errore (es. `rev-parse` su repo vuoto). */
	allowFailure?: boolean;
	/** Variabili aggiuntive (per esempio `GIT_INDEX_FILE` per un indice temporaneo). */
	env?: Record<string, string>;
}

export class GitError extends Error {
	readonly argv: string[];
	readonly code: number | null;
	readonly stderr: string;

	constructor(
		message: string,
		argv: string[],
		code: number | null,
		stderr: string
	) {
		super(message);
		this.name = "GitError";
		this.argv = argv;
		this.code = code;
		this.stderr = stderr;
	}
}

/**
 * Esegue `git` **senza shell**: gli argomenti sono un array, quindi un path con spazi, apici,
 * `$` o newline non può mai diventare parte di un comando.
 *
 * L'ambiente è fissato per avere output stabile e nessun prompt interattivo:
 * - `LC_ALL=C`            messaggi in inglese, parsing prevedibile
 * - `GIT_TERMINAL_PROMPT` nessuna richiesta di credenziali su un processo senza TTY
 * - `GIT_OPTIONAL_LOCKS=0` nessun lock preso dalle letture (status, log)
 * - `core.quotepath=false` path non ASCII scritti verbatim
 */
function gitEnv(extra?: Record<string, string>): NodeJS.ProcessEnv {
	return {
		...process.env,
		LC_ALL: "C",
		GIT_TERMINAL_PROMPT: "0",
		GIT_OPTIONAL_LOCKS: "0",
		GIT_PAGER: "cat",
		PAGER: "cat",
		...extra,
	};
}

export function runGit(
	cwd: string,
	args: string[],
	options: RunOptions = {}
): Promise<GitResult> {
	const argv = ["-c", "core.quotepath=false", ...args];

	return new Promise((resolve, reject) => {
		const child = execFile(
			"git",
			argv,
			{
				cwd,
				encoding: "utf8",
				maxBuffer: 64 * 1024 * 1024,
				timeout: options.timeoutMs ?? 30_000,
				env: gitEnv(options.env),
			},
			(error, stdout, stderr) => {
				const code = error ? (error as { code?: number }).code ?? 1 : 0;
				if (code !== 0 && !options.allowFailure) {
					const detail =
						stderr.trim() ||
						stdout.trim() ||
						(error?.message ?? "errore sconosciuto");
					reject(
						new GitError(
							`git ${args[0] ?? ""}: ${detail}`,
							args,
							code,
							stderr
						)
					);
					return;
				}
				resolve({ code, stdout, stderr });
			}
		);

		if (options.input !== undefined) child.stdin?.end(options.input);
	});
}

/**
 * Come `runGit`, ma legge `stderr` man mano che arriva e ne ricava l'avanzamento.
 *
 * `execFile` restituisce `stderr` solo alla fine: per una rete lenta sarebbe una barra che compare
 * quando il lavoro è già finito. Qui il processo è avviato con le pipe, l'output è accumulato per
 * l'errore finale e le righe di avanzamento vengono passate a `onProgress` senza attendere l'uscita.
 */
export function runGitStreaming(
	cwd: string,
	args: string[],
	options: RunOptions = {},
	onProgress?: (progress: NetworkProgress) => void
): Promise<GitResult> {
	const argv = ["-c", "core.quotepath=false", ...args];
	const limit = 64 * 1024 * 1024;

	return new Promise((resolve, reject) => {
		const child = spawn("git", argv, {
			cwd,
			env: gitEnv(options.env),
			stdio: ["pipe", "pipe", "pipe"],
		});
		const reader = onProgress ? new ProgressReader(onProgress) : null;
		let stdout = "";
		let stderr = "";
		let bytes = 0;
		let settled = false;

		const timer = setTimeout(() => {
			if (settled) return;
			child.kill("SIGTERM");
			finish(
				new GitError(
					`git ${args[0] ?? ""}: tempo scaduto`,
					args,
					null,
					stderr
				)
			);
		}, options.timeoutMs ?? 30_000);

		const finish = (error: Error | null, result?: GitResult): void => {
			if (settled) return;
			settled = true;
			clearTimeout(timer);
			reader?.end();
			if (error) reject(error);
			else resolve(result!);
		};

		const overflow = (): void => {
			child.kill("SIGTERM");
			finish(
				new GitError(
					`git ${args[0] ?? ""}: output troppo grande`,
					args,
					null,
					stderr
				)
			);
		};

		child.stdout?.setEncoding("utf8");
		child.stdout?.on("data", (chunk: string) => {
			stdout += chunk;
			bytes += chunk.length;
			if (bytes > limit) overflow();
		});
		child.stderr?.setEncoding("utf8");
		child.stderr?.on("data", (chunk: string) => {
			stderr += chunk;
			bytes += chunk.length;
			reader?.push(chunk);
			if (bytes > limit) overflow();
		});
		child.on("error", (error) => {
			finish(
				new GitError(
					`git ${args[0] ?? ""}: ${error.message}`,
					args,
					null,
					stderr
				)
			);
		});
		child.on("close", (code) => {
			if (code !== 0 && !options.allowFailure) {
				const detail =
					stderr.trim() || stdout.trim() || "errore sconosciuto";
				finish(
					new GitError(
						`git ${args[0] ?? ""}: ${detail}`,
						args,
						code,
						stderr
					)
				);
				return;
			}
			finish(null, { code: code ?? 1, stdout, stderr });
		});

		if (options.input !== undefined) child.stdin?.end(options.input);
		else child.stdin?.end();
	});
}

/**
 * Come `runGit`, ma restituisce i byte: serve a leggere un file da un commit senza passare dal testo
 * (immagini, archivi, qualunque cosa non sia UTF-8). Il limite è lo stesso di `runGit`.
 */
export function runGitBytes(
	cwd: string,
	args: string[],
	options: RunOptions = {}
): Promise<{ code: number; stdout: Buffer; stderr: string }> {
	const argv = ["-c", "core.quotepath=false", ...args];

	return new Promise((resolve, reject) => {
		const child = execFile(
			"git",
			argv,
			{
				cwd,
				encoding: "buffer",
				maxBuffer: 64 * 1024 * 1024,
				timeout: options.timeoutMs ?? 30_000,
				env: gitEnv(options.env),
			},
			(error, stdout, stderr) => {
				const bytes = Buffer.isBuffer(stdout)
					? stdout
					: Buffer.from(stdout ?? "");
				const err = Buffer.isBuffer(stderr)
					? stderr.toString("utf8")
					: String(stderr ?? "");
				const code = error ? (error as { code?: number }).code ?? 1 : 0;
				if (code !== 0 && !options.allowFailure) {
					reject(
						new GitError(
							`git ${args[0] ?? ""}: ${
								err.trim() ||
								error?.message ||
								"errore sconosciuto"
							}`,
							args,
							code,
							err
						)
					);
					return;
				}
				resolve({ code, stdout: bytes, stderr: err });
			}
		);

		if (options.input !== undefined) child.stdin?.end(options.input);
	});
}
