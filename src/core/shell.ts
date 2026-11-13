/**
 * Dove sta `bash`.
 *
 * Su Linux e macOS è nel `PATH` e vale la pena cercarlo lì. Su Windows non c'è nel sistema, ma
 * **Git per Windows lo installa sempre** insieme a `git`: cercarlo accanto a `git` evita di
 * riscrivere il terminale, l'askpass e l'editor del rebase per PowerShell. Le variabili qui non
 * vengono lette dal processo: le passa il chiamante, così la funzione resta pura e testabile.
 */

export type ShellPlatform = "windows" | "posix";

export function shellPlatform(platform: string): ShellPlatform {
	return platform === "win32" ? "windows" : "posix";
}

/** Nomi del programma cercati nel `PATH` quando la piattaforma non è Windows. */
export const POSIX_BASH = "bash";

/**
 * Percorsi candidati di `bash.exe`, dal più probabile al meno. Il primo che esiste vince.
 *
 * `gitExecPath` è quello che stampa `git --exec-path`, per esempio
 * `C:\Program Files\Git\mingw64\libexec\git-core`: la radice dell'installazione si ottiene
 * togliendo `\libexec\…` e l'eventuale `\mingw64`.
 */
export function bashCandidates(
	platform: string,
	gitExecPath: string | null,
	env: Record<string, string | undefined>
): string[] {
	const override = env.GITHANDLER_BASH?.trim();
	if (override) return [override];

	if (shellPlatform(platform) === "posix") return [POSIX_BASH];

	const roots: string[] = [];
	const push = (value: string | undefined): void => {
		const trimmed = value?.trim();
		if (trimmed && !roots.includes(trimmed)) roots.push(trimmed);
	};

	const installRoot = gitInstallationRoot(gitExecPath);
	if (installRoot) push(installRoot);
	if (env.ProgramFiles)
		push(`${env.ProgramFiles.replace(/[\\/]+$/, "")}\\Git`);
	if (env["ProgramFiles(x86)"])
		push(`${env["ProgramFiles(x86)"]!.replace(/[\\/]+$/, "")}\\Git`);
	if (env.LOCALAPPDATA)
		push(`${env.LOCALAPPDATA.replace(/[\\/]+$/, "")}\\Programs\\Git`);

	return roots.flatMap((root) => [
		`${root}\\bin\\bash.exe`,
		`${root}\\usr\\bin\\bash.exe`,
	]);
}

/** Radice di un'installazione di Git per Windows ricavata da `git --exec-path`. */
export function gitInstallationRoot(gitExecPath: string | null): string | null {
	if (!gitExecPath) return null;
	const normalized = gitExecPath
		.trim()
		.replace(/\//g, "\\")
		.replace(/\\+$/, "");
	const marker = "\\libexec\\";
	const at = normalized.toLowerCase().lastIndexOf(marker.toLowerCase());
	if (at < 0) return null;
	const root = normalized.slice(0, at).replace(/\\(mingw64|mingw32)$/i, "");
	return root.endsWith(":") ? `${root}\\` : root;
}
