/**
 * Ricerca nel contenuto dei file tracciati (`git grep`).
 *
 * Il testo libero è letterale, come nella ricerca della storia: per un'espressione regolare si
 * sceglie `regex:`. L'output è letto con `-z`, così i due punti in un nome di file non confondono
 * percorso e numero di riga. Il limite è applicato qui, non lasciando che un repository enorme
 * riempia la finestra.
 */
export interface ContentQuery {
	text: string;
	/** `-E` invece di `-F`. */
	regex: boolean;
	/** per default la ricerca ignora le maiuscole (`-i`). */
	caseSensitive: boolean;
}

export interface ContentMatch {
	path: string;
	line: number;
	text: string;
}

export interface ContentSearchResult {
	matches: ContentMatch[];
	/** c'erano altre corrispondenze oltre il limite. */
	truncated: boolean;
}

/** Abbastanza per vedere il contesto, non abbastanza per bloccare la UI. */
export const CONTENT_MATCH_LIMIT = 1000;
const MAX_QUERY_LENGTH = 500;

export function contentSearchArgs(query: ContentQuery): string[] {
	const text = query.text.trim();
	if (!text) throw new Error("Scrivi un testo da cercare.");
	if (text.length > MAX_QUERY_LENGTH)
		throw new Error("Testo di ricerca troppo lungo.");
	if (text.includes("\u0000"))
		throw new Error("Il testo di ricerca non può contenere NUL.");
	return [
		"grep",
		"-n",
		"-I",
		"-z",
		query.regex ? "-E" : "-F",
		...(query.caseSensitive ? [] : ["-i"]),
		"-e",
		text,
		"--",
	];
}

/**
 * Righe `path\0line\0text`, separate da `\n` (`git grep -z -n`). Un record malformato si scarta:
 * l'output non è una fonte attendibile al punto da fare fallire tutta la ricerca.
 */
export function parseContentMatches(
	stdout: string,
	limit = CONTENT_MATCH_LIMIT
): ContentSearchResult {
	const matches: ContentMatch[] = [];
	let truncated = false;
	for (const line of stdout.split("\n")) {
		if (!line) continue;
		const [path, lineNumber, ...rest] = line.split("\u0000");
		if (!path || !lineNumber || rest.length === 0) continue;
		const number = Number.parseInt(lineNumber, 10);
		if (!Number.isInteger(number) || number < 1) continue;
		if (matches.length >= limit) {
			truncated = true;
			break;
		}
		matches.push({ path, line: number, text: rest.join("\u0000") });
	}
	return { matches, truncated };
}
