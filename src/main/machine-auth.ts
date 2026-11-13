import { execFile } from "node:child_process";

import { parseCredentialOutput } from "../core/providers.ts";
import { runGit } from "./git.ts";
import { neutralCwd } from "./shell.ts";

/**
 * Il token che l'utente ha **già** su questa macchina.
 *
 * Il device flow OAuth richiede un Client ID registrato, e chiederlo a chi vuole solo fare la login
 * è un ostacolo inutile quando l'accesso esiste già: GitHub CLI (`gh auth login`) e i credential
 * helper di Git conservano token validi. Qui si leggono quelli, senza chiedere altro all'utente.
 *
 * Non si scrive niente: il token resta in memoria come tutti gli altri. Se non c'è nulla, si
 * restituisce `null` e l'interfaccia propone la pagina dei token.
 */

export type MachineTokenSource = "github-cli" | "git";

export interface MachineToken {
	token: string;
	/** utente secondo la fonte; può essere vuoto (alcuni helper lo omettono) */
	username: string;
	source: MachineTokenSource;
}

const TOKEN_RE = /^[\x21-\x7e]+$/;

function usable(token: string): boolean {
	return TOKEN_RE.test(token);
}

/** `git` esiste di sicuro, `gh` no: un comando assente è «niente token», non un errore. */
function run(
	command: string,
	args: string[],
	timeoutMs: number
): Promise<{ code: number; stdout: string; stderr: string }> {
	return new Promise((resolve) => {
		execFile(
			command,
			args,
			{ encoding: "utf8", timeout: timeoutMs, maxBuffer: 1024 * 1024 },
			(error, stdout, stderr) => {
				const code = error ? (error as { code?: number }).code ?? 1 : 0;
				resolve({
					code: typeof code === "number" ? code : 1,
					stdout: stdout ?? "",
					stderr: stderr ?? "",
				});
			}
		);
	});
}

/** Token di GitHub CLI per quell'host, se `gh` è installato e ha una sessione attiva. */
async function fromGithubCli(host: string): Promise<MachineToken | null> {
	const result = await run(
		"gh",
		["auth", "token", "--hostname", host],
		10_000
	);
	if (result.code !== 0) return null;
	const token = result.stdout.trim();
	if (!token || !usable(token)) return null;
	return { token, username: "", source: "github-cli" };
}

/**
 * Credenziali dal credential helper di Git.
 *
 * `GIT_TERMINAL_PROMPT=0` (lo mette `runGit`) impedisce la domanda sul terminale: se il helper non
 * ha niente in archivio, il comando fallisce e si torna `null`. Un helper grafico può aprire la sua
 * finestra: è il suo comportamento, non una scorciatoia dell'app.
 */
async function fromGitCredential(host: string): Promise<MachineToken | null> {
	const result = await runGit(neutralCwd(), ["credential", "fill"], {
		allowFailure: true,
		timeoutMs: 25_000,
		input: `protocol=https\nhost=${host}\n\n`,
	});
	if (result.code !== 0) return null;
	const parsed = parseCredentialOutput(result.stdout);
	if (!parsed) return null;
	return { token: parsed.password, username: parsed.username, source: "git" };
}

/**
 * Solo GitHub CLI: risponde subito e non apre nessun helper grafico. Serve a chi deve decidere se
 * il token di `gh` è abbastanza sicuro da usare (GitHub CLI ne tiene uno per host, non per utente).
 */
export async function githubCliToken(host: string): Promise<MachineToken | null> {
	return fromGithubCli(host);
}

/** Cerca un token già presente: prima quello di `gh`, poi quello del credential helper. */
export async function machineToken(host: string): Promise<MachineToken | null> {
	const gh = await fromGithubCli(host);
	if (gh) return gh;
	return fromGitCredential(host);
}
