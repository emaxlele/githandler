/**
 * Raggiungibilità dei remoti: l'esito di `git ls-remote` ridotto a una riga.
 *
 * La regola è pura — riceve codice, output ed errore — mentre il comando e la rete restano nel
 * main. Un remoto irraggiungibile non è un errore dell'app: è un fatto da mostrare.
 */

export interface RemoteCheck {
	/** nome del remoto (`origin`, `upstream`) */
	name: string;
	url: string;
	reachable: boolean;
	/** rami letti dal remoto: 0 è valido (repository vuoto) */
	heads: number;
	/** prima riga dell'errore, quando non è raggiungibile */
	error: string | null;
}

export function summarizeRemoteCheck(
	name: string,
	url: string,
	code: number,
	stdout: string,
	stderr: string
): RemoteCheck {
	const heads = stdout
		.split("\n")
		.map((line) => line.trim())
		.filter(Boolean).length;
	if (code === 0) {
		return { name, url, reachable: true, heads, error: null };
	}
	const detail = stderr.trim() || stdout.trim();
	return {
		name,
		url,
		reachable: false,
		heads: 0,
		error: detail.split("\n")[0] || `git ls-remote: uscita ${code}`,
	};
}
