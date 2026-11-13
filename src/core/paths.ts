/**
 * Riconoscere un percorso assoluto senza sapere su che piattaforma girerà il codice.
 *
 * `path.isAbsolute` risponde secondo la piattaforma corrente, quindi su Linux direbbe che
 * `C:\repo` è relativo: qui servono entrambe le forme, perché la validazione di un percorso
 * scritto dall'utente deve accettare la sintassi di Windows anche quando i test girano altrove.
 */
export function isAbsolutePath(value: string): boolean {
	if (!value) return false;
	if (value.startsWith("/")) return true;
	if (/^[A-Za-z]:[\\/]/.test(value)) return true;
	if (value.startsWith("\\\\")) return true;
	return false;
}

/** Toglie le barre finali senza ridurre `C:\` o `/` a una stringa vuota. */
export function trimTrailingSeparators(value: string): string {
	const trimmed = value.replace(/[\\/]+$/, "");
	if (/^[A-Za-z]:$/.test(trimmed)) return `${trimmed}\\`;
	if (trimmed) return trimmed;
	return "/";
}
