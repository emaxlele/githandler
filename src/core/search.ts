import { LOG_FORMAT } from "./log.ts";

/**
 * Ricerca nella storia: un linguaggio minimo e prevedibile.
 *
 *   testo libero            → messaggi che contengono quel testo (letterale, senza maiuscole)
 *   author: Mario Rossi     → autore (Git accetta anche una parte del nome o l'email)
 *   file: src/main/x.ts     → commit che hanno toccato quel path
 *   regex: ^fix\(           → messaggio come espressione regolare estesa
 *   change: motivo          → commit in cui cambia il numero di occorrenze del testo (`-S`)
 *   diff: ^TODO             → commit il cui diff contiene una riga che corrisponde (`-G`)
 *   lines: 10,40: src/x.ts  → storia di quell'intervallo di righe (`-L`), sul ramo corrente
 *
 * Il testo libero finisce in `--grep` con `--fixed-strings`: un messaggio con `(` o `[` non deve
 * diventare una regex rotta o lentissima. La regex si chiede apposta, con `regex:`.
 */

/** Intervallo di righe di un file: `git log -L<start>,<end>:<path>`. */
export interface LineRange {
	start: number;
	end: number;
	path: string;
}

export interface HistoryQuery {
	text: string | null;
	author: string | null;
	file: string | null;
	/** messaggio come espressione regolare */
	regex: string | null;
	/** `-S`: commit in cui cambia il numero di occorrenze di questo testo */
	pickaxe: string | null;
	/** `-G`: commit il cui diff contiene una riga che corrisponde a questa regex */
	diff: string | null;
	/** `-L`: storia di un intervallo di righe di un file */
	lines: LineRange | null;
}

/** Divide rispettando le virgolette: `author:"Mario Rossi"`. */
export function tokenizeQuery(raw: string): string[] {
	const tokens: string[] = [];
	let current = "";
	let quoted = false;

	for (const char of raw) {
		if (char === '"') {
			quoted = !quoted;
			continue;
		}
		if (!quoted && /\s/.test(char)) {
			if (current) tokens.push(current);
			current = "";
			continue;
		}
		current += char;
	}
	if (current) tokens.push(current);
	return tokens;
}

/** `start,end:path`: l'intervallo deve stare in un file e non essere enorme. */
export function parseLineRange(value: string): LineRange {
	const match = /^(\d+)\s*,\s*(\d+)\s*:\s*(.+)$/.exec(value);
	if (!match) throw new Error(`Intervallo di righe non valido: ${value}`);
	const start = Number.parseInt(match[1]!, 10);
	const end = Number.parseInt(match[2]!, 10);
	const path = match[3]!.trim();
	if (start < 1 || end < start)
		throw new Error(`Intervallo di righe non valido: ${value}`);
	if (end - start > 1000)
		throw new Error(
			"Intervallo di righe troppo largo: al massimo 1000 righe."
		);
	if (!path || /[\x00-\x1f]/.test(path))
		throw new Error(`Percorso non valido: ${path}`);
	return { start, end, path };
}

export function parseHistoryQuery(raw: string): HistoryQuery {
	const words: string[] = [];
	let author: string | null = null;
	let file: string | null = null;
	let regex: string | null = null;
	let pickaxe: string | null = null;
	let diff: string | null = null;
	let lines: LineRange | null = null;

	for (const token of tokenizeQuery(raw)) {
		const match = /^(author|file|grep|regex|change|diff|lines):(.*)$/i.exec(
			token
		);
		if (!match) {
			words.push(token);
			continue;
		}
		const value = match[2]!.trim();
		if (!value) continue;
		switch (match[1]!.toLowerCase()) {
			case "author":
				author = value;
				break;
			case "file":
			case "grep":
				file = value;
				break;
			case "regex":
				regex = value;
				break;
			case "change":
				pickaxe = value;
				break;
			case "diff":
				diff = value;
				break;
			case "lines":
				lines = parseLineRange(value);
				break;
		}
	}

	const text = words.join(" ").trim();
	if (text && regex)
		throw new Error("Usa il testo libero oppure regex:, non entrambi.");
	return { text: text || null, author, file, regex, pickaxe, diff, lines };
}

export function isEmptyQuery(query: HistoryQuery): boolean {
	return (
		!query.text &&
		!query.author &&
		!query.file &&
		!query.regex &&
		!query.pickaxe &&
		!query.diff &&
		!query.lines
	);
}

export function historyArgs(query: HistoryQuery, limit = 500): string[] {
	const args = [
		"log",
		// I ref di servizio (snapshot di undo, trash) non sono storia del progetto.
		"--exclude=refs/githandler/*",
	];
	if (query.lines) {
		// `-L` vuole un solo punto di partenza e il suo percorso, e non convive con `--all`.
		args.push(
			"--date-order",
			`-n${limit}`,
			`--pretty=format:${LOG_FORMAT}`,
			// `-L` implica il diff: senza questo il formato si romperebbe con le righe del patch
			"--no-patch",
			`-L${query.lines.start},${query.lines.end}:${query.lines.path}`
		);
	} else {
		args.push(
			"--all",
			"--date-order",
			`-n${limit}`,
			`--pretty=format:${LOG_FORMAT}`
		);
	}
	if (query.author) args.push(`--author=${query.author}`);
	if (query.text) args.push("-i", "--fixed-strings", `--grep=${query.text}`);
	if (query.regex) args.push("--extended-regexp", `--grep=${query.regex}`);
	if (query.pickaxe) args.push(`-S${query.pickaxe}`);
	if (query.diff) args.push(`-G${query.diff}`);
	if (query.file) args.push("--", query.file);
	return args;
}
