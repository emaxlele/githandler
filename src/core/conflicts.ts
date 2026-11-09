/**
 * Conflict markers, as Git writes them into a file when a merge, rebase or cherry-pick stops.
 *
 * ```
 * <<<<<<< HEAD
 * ours
 * ||||||| merged common ancestors
 * base
 * =======
 * theirs
 * >>>>>>> other
 * ```
 *
 * The base section exists only with `merge.conflictStyle=diff3` (or `zdiff3`); with the default
 * style the hunk has ours and theirs only. Parsing does not rewrite anything: callers decide.
 */

export type ConflictChoice = "ours" | "theirs" | "both" | "base";

export interface ConflictHunk {
	ours: string;
	/** `null` when the file was written with the default conflict style. */
	base: string | null;
	theirs: string;
}

export type ConflictPart =
	| { kind: "text"; text: string }
	| { kind: "conflict"; hunk: ConflictHunk };

const START = "<<<<<<<";
const BASE = "|||||||";
const MIDDLE = "=======";
const END = ">>>>>>>";

/** Splits a file into plain text and conflict hunks. Unterminated markers stay plain text. */
export function parseConflicts(text: string): ConflictPart[] {
	const lines = splitLines(text);
	const parts: ConflictPart[] = [];
	let plain: string[] = [];

	const flush = (): void => {
		if (plain.length === 0) return;
		parts.push({ kind: "text", text: plain.join("") });
		plain = [];
	};

	for (let i = 0; i < lines.length; i++) {
		const line = lines[i]!;
		const marker = markerOf(line);
		if (marker !== "start") {
			plain.push(line);
			continue;
		}

		// Find the matching markers; anything malformed stays as text.
		let oursEnd = -1;
		let baseStart = -1;
		let end = -1;
		for (let j = i + 1; j < lines.length; j++) {
			const kind = markerOf(lines[j]!);
			if (kind === "base" && baseStart < 0 && oursEnd < 0) {
				baseStart = j;
			} else if (kind === "middle" && oursEnd < 0) {
				oursEnd = j;
			} else if (kind === "end") {
				end = j;
				break;
			}
		}
		if (oursEnd < 0 || end < 0) {
			plain.push(line);
			continue;
		}

		flush();
		const oursFrom = i + 1;
		const oursTo = baseStart >= 0 ? baseStart : oursEnd;
		const ours = lines.slice(oursFrom, oursTo).join("");
		const baseText =
			baseStart >= 0
				? lines.slice(baseStart + 1, oursEnd).join("")
				: null;
		const theirs = lines.slice(oursEnd + 1, end).join("");
		parts.push({
			kind: "conflict",
			hunk: { ours, base: baseText, theirs },
		});
		i = end;
	}

	flush();
	return parts;
}

/** How many conflicts a text carries; the caller uses it to size the choices array. */
export function countConflicts(parts: ConflictPart[]): number {
	return parts.filter((part) => part.kind === "conflict").length;
}

/**
 * Rebuilds the file with one choice per hunk, in order. A missing choice keeps the hunk as it was,
 * so a partial resolution is never a silent deletion.
 */
export function resolveConflicts(
	text: string,
	choices: ConflictChoice[]
): { text: string; remaining: number } {
	const parts = parseConflicts(text);
	let index = 0;
	let remaining = 0;
	const out: string[] = [];
	for (const part of parts) {
		if (part.kind === "text") {
			out.push(part.text);
			continue;
		}
		const choice = choices[index++];
		const hunk = part.hunk;
		switch (choice) {
			case "ours":
				out.push(hunk.ours);
				break;
			case "theirs":
				out.push(hunk.theirs);
				break;
			case "base":
				out.push(hunk.base ?? "");
				break;
			case "both":
				out.push(hunk.ours + hunk.theirs);
				break;
			default:
				remaining++;
				out.push(renderHunk(hunk));
				break;
		}
	}
	return { text: out.join(""), remaining };
}

/** A hunk back in marker form: used for the preview and for an unresolved hunk. */
export function renderHunk(hunk: ConflictHunk): string {
	const lines = [START, hunk.ours.replace(/\n$/, "")];
	if (hunk.base !== null) {
		lines.push(BASE, hunk.base.replace(/\n$/, ""));
	}
	lines.push(MIDDLE, hunk.theirs.replace(/\n$/, ""), END);
	return `${lines.join("\n")}\n`;
}

type Marker = "start" | "base" | "middle" | "end";

function markerOf(line: string): Marker | null {
	if (line.startsWith(START)) return "start";
	if (line.startsWith(BASE)) return "base";
	if (line.startsWith(MIDDLE)) return "middle";
	if (line.startsWith(END)) return "end";
	return null;
}

/** Keeps the final newline: a file without one must stay without one. */
function splitLines(text: string): string[] {
	const lines = text.split("\n");
	const out: string[] = [];
	for (let i = 0; i < lines.length; i++) {
		out.push(i === lines.length - 1 ? lines[i]! : `${lines[i]}\n`);
	}
	return out;
}
