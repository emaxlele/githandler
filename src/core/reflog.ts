/**
 * Reflog: la storia di HEAD, non dei commit.
 *
 * `git reflog` elenca ogni spostamento del riferimento (commit, checkout, reset, rebase…), dal più
 * recente. Serve a rispondere a «dov'ero prima» senza aprire un terminale: qui si legge l'output,
 * si ricava l'indice della voce e la data, che Git mette insieme nel selettore `HEAD@{…}`.
 */

/** Una voce del reflog, già nella forma che la finestra disegna. */
export interface ReflogEntry {
	/** SHA completo del commit a cui puntava HEAD dopo lo spostamento */
	sha: string;
	/** SHA abbreviato, come lo mostra Git */
	short: string;
	/** posizione nella coda: 0 è la voce più recente */
	index: number;
	/** selettore leggibile: `HEAD@{3}` */
	selector: string;
	/** cosa è successo: `commit: messaggio`, `checkout: moving from …` */
	action: string;
	/** data ISO dell'aggiornamento, vuota se Git non la fornisce */
	date: string;
}

/** `git reflog show`, con un limite: la coda può essere lunga e la finestra non serve tutta. */
export function reflogArgs(limit = 200): string[] {
	return [
		"reflog",
		"show",
		"--date=iso-strict",
		`-n${Math.max(1, Math.min(1000, Math.round(limit)))}`,
		"--format=%H%x1f%h%x1f%gd%x1f%gs",
	];
}

/**
 * Legge l'output di `reflogArgs`.
 *
 * Il selettore arriva come `HEAD@{2026-11-09T10:00:00+01:00}` perché `--date` cambia `%gd`:
 * l'indice non c'è più, quindi si ricava dall'ordine (la prima riga è `HEAD@{0}`). Una riga che non
 * si riconosce si scarta; una coda vuota è un elenco vuoto, non un errore.
 */
export function parseReflog(stdout: string): ReflogEntry[] {
	const entries: ReflogEntry[] = [];
	for (const line of stdout.split("\n")) {
		if (!line.trim()) continue;
		const [sha, short, selector, action] = line.split("\x1f");
		if (!sha || !short || !selector) continue;
		if (!/^[0-9a-f]{40,64}$/i.test(sha)) continue;
		const match = /^(.*)@\{([^}]*)\}$/.exec(selector.trim());
		const ref = match?.[1] ?? "HEAD";
		const date = match?.[2] ?? "";
		entries.push({
			sha,
			short,
			index: entries.length,
			selector: `${ref}@{${entries.length}}`,
			action: (action ?? "").trim(),
			date: /^\d{4}-\d{2}-\d{2}T/.test(date) ? date : "",
		});
	}
	return entries;
}
