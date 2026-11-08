import { execFile } from "node:child_process";

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
				env: {
					...process.env,
					LC_ALL: "C",
					GIT_TERMINAL_PROMPT: "0",
					GIT_OPTIONAL_LOCKS: "0",
					GIT_PAGER: "cat",
					PAGER: "cat",
				},
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
