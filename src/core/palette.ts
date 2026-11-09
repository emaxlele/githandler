/**
 * Command palette ranking: a query is matched against the text of each entry as a subsequence, so
 * `nuora` finds "Nuovo ramo". Entries are returned best first; an empty query keeps the given order.
 *
 * The matcher lives in the core because it is pure: no DOM, no Electron, tests with plain strings.
 */

export interface PaletteEntry {
	text: string;
}

/** Lowercase without accents, so `perche` finds "perché" and `e` matches "è". */
function normalize(text: string): string {
	return text
		.toLowerCase()
		.normalize("NFD")
		.replace(/[\u0300-\u036f]/g, "");
}

/**
 * Score of a query against one entry: `null` when the characters do not appear in order.
 * A contiguous run near a word start scores highest, single scattered letters lowest.
 */
function score(text: string, query: string): number | null {
	const haystack = normalize(text);
	if (query.length === 0) return 0;
	const at = haystack.indexOf(query);
	if (at >= 0) {
		// substring: prefer the start of the text, then the start of a word
		const wordStart = at === 0 || /[\s\-·/(]/.test(haystack[at - 1]!);
		return 1000 + (at === 0 ? 100 : 0) + (wordStart ? 50 : 0) - at;
	}

	let position = 0;
	let run = 0;
	let total = 0;
	for (const char of query) {
		const found = haystack.indexOf(char, position);
		if (found < 0) return null;
		const wordStart = found === 0 || /[\s\-·/(]/.test(haystack[found - 1]!);
		total += 10 + (wordStart ? 8 : 0) - Math.min(6, found - position);
		run = found === position && position > 0 ? run + 1 : 0;
		total += run;
		position = found + 1;
	}
	return total / query.length;
}

/**
 * Entries matching `query`, best first. Ties keep the original order, which the caller decides:
 * the palette lists commands in the order a person looks for them.
 */
export function rankPalette<T extends PaletteEntry>(
	entries: readonly T[],
	query: string
): T[] {
	const trimmed = normalize(query.trim());
	if (trimmed.length === 0) return [...entries];
	const scored: Array<{ entry: T; index: number; score: number }> = [];
	entries.forEach((entry, index) => {
		const value = score(entry.text, trimmed);
		if (value !== null) scored.push({ entry, index, score: value });
	});
	scored.sort((a, b) => b.score - a.score || a.index - b.index);
	return scored.map((item) => item.entry);
}
