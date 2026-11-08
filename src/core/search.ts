import { LOG_FORMAT } from "./log.ts";

/**
 * Ricerca nella storia: un linguaggio minimo e prevedibile.
 *
 *   testo libero          → messaggi che contengono quel testo (letterale, senza distinzione di caso)
 *   author: Mario Rossi   → autore (Git accetta anche una parte del nome o l'email)
 *   file: src/main/x.ts   → commit che hanno toccato quel path
 *
 * Il testo libero finisce in `--grep` con `--fixed-strings`: un messaggio con `(` o `[` non deve
 * diventare una regex rotta o lentissima.
 */

export interface HistoryQuery {
	text: string | null;
	author: string | null;
	file: string | null;
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

export function parseHistoryQuery(raw: string): HistoryQuery {
	const words: string[] = [];
	let author: string | null = null;
	let file: string | null = null;

	for (const token of tokenizeQuery(raw)) {
		const match = /^(author|file|grep):(.*)$/i.exec(token);
		if (!match) {
			words.push(token);
			continue;
		}
		const value = match[2]!.trim();
		if (!value) continue;
		if (match[1]!.toLowerCase() === "author") author = value;
		else file = value;
	}

	const text = words.join(" ").trim();
	return { text: text || null, author, file };
}

export function isEmptyQuery(query: HistoryQuery): boolean {
	return !query.text && !query.author && !query.file;
}

/** Ricompone la query nella forma accettata da `parseHistoryQuery` (per API e test). */
export function formatHistoryQuery(query: HistoryQuery): string {
	const quote = (value: string): string =>
		/\s/.test(value) ? `"${value}"` : value;
	const parts: string[] = [];
	if (query.author) parts.push(`author:${quote(query.author)}`);
	if (query.file) parts.push(`file:${quote(query.file)}`);
	if (query.text) parts.push(query.text);
	return parts.join(" ");
}

export function historyArgs(query: HistoryQuery, limit = 500): string[] {
	const args = [
		"log",
		"--all",
		"--date-order",
		`-n${limit}`,
		`--pretty=format:${LOG_FORMAT}`,
	];
	if (query.author) args.push(`--author=${query.author}`);
	if (query.text) args.push("-i", "--fixed-strings", `--grep=${query.text}`);
	if (query.file) args.push("--", query.file);
	return args;
}
