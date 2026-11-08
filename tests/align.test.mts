import assert from "node:assert/strict";
import { test } from "node:test";

import { alignHunk, changedRanges } from "../src/core/align.ts";
import { parseDiff } from "../src/core/diff.ts";
import type { DiffHunk, DiffLine } from "../src/core/types.ts";

function line(
	type: DiffLine["type"],
	text: string,
	oldNo: number | null,
	newNo: number | null,
): DiffLine {
	return { type, text, oldNo, newNo };
}

function hunk(lines: DiffLine[]): DiffHunk {
	return { header: "", oldStart: 1, oldLines: 0, newStart: 1, newLines: 0, lines };
}

test("contesto e modifiche pari si accoppiano uno a uno", () => {
	const rows = alignHunk(
		hunk([
			line("context", "uguale", 1, 1),
			line("del", "prima", 2, null),
			line("add", "dopo", null, 2),
			line("context", "coda", 3, 3),
		]),
	);

	assert.equal(rows.length, 3);
	assert.deepEqual(
		rows.map((row) => row.kind === "pair" ? [row.left?.text ?? null, row.right?.text ?? null] : row.line.text),
		[
			["uguale", "uguale"],
			["prima", "dopo"],
			["coda", "coda"],
		],
	);
});

test("modifiche sbilanciate: le righe in eccesso restano da sole sul loro lato", () => {
	const rows = alignHunk(
		hunk([
			line("del", "a", 1, null),
			line("del", "b", 2, null),
			line("del", "c", 3, null),
			line("add", "A", null, 1),
			line("add", "B", null, 2),
		]),
	);

	assert.equal(rows.length, 3);
	assert.deepEqual(
		rows.map((row) =>
			row.kind === "pair"
				? [row.left?.text ?? null, row.right?.text ?? null]
				: ["nota", row.line.text],
		),
		[
			["a", "A"],
			["b", "B"],
			["c", null],
		],
	);
});

test("solo aggiunte: ogni riga occupa il lato destro", () => {
	const file = parseDiff(
		[
			"diff --git a/n.txt b/n.txt",
			"new file mode 100644",
			"--- /dev/null",
			"+++ b/n.txt",
			"@@ -0,0 +1,2 @@",
			"+uno",
			"+due",
		].join("\n"),
		"n.txt",
	);

	const rows = alignHunk(file.hunks[0]!);
	assert.equal(rows.length, 2);
	for (const row of rows) {
		assert.equal(row.kind, "pair");
		if (row.kind === "pair") {
			assert.equal(row.left, null);
			assert.equal(row.right?.type, "add");
		}
	}
});

test("il marcatore 'no newline' diventa una riga a parte", () => {
	const rows = alignHunk(
		hunk([
			line("del", "x", 1, null),
			line("add", "y", null, 1),
			line("nonewline", "\\ No newline at end of file", null, null),
		]),
	);

	assert.equal(rows.length, 2);
	assert.equal(rows[1]!.kind, "note");
});

test("changedRanges mette in evidenza solo il mezzo diverso", () => {
	const slice = (text: string, range: [number, number]): string =>
		text.slice(range[0], range[1]);

	const primo = changedRanges("const b = 2;", "const b = 20;")!;
	assert.equal(slice("const b = 2;", primo.left), "");
	assert.equal(slice("const b = 20;", primo.right), "0");

	const secondo = changedRanges("valore = 2", "valore = 3")!;
	assert.equal(slice("valore = 2", secondo.left), "2");
	assert.equal(slice("valore = 3", secondo.right), "3");

	const terzo = changedRanges("tre", "tre più")!;
	assert.equal(slice("tre", terzo.left), "");
	assert.equal(slice("tre più", terzo.right), " più");

	// niente prefisso né suffisso comune: meglio non evidenziare nulla
	assert.equal(changedRanges("abc", "xyz"), null);
	assert.equal(changedRanges("uguale", "uguale"), null);
});
