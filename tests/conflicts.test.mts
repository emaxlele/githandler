import assert from "node:assert/strict";
import { test } from "node:test";

import {
	countConflicts,
	parseConflicts,
	resolveConflicts,
} from "../src/core/conflicts.ts";

const WITH_BASE = `prima
<<<<<<< HEAD
mia
||||||| base
originale
=======
loro
>>>>>>> branch
dopo
`;

const WITHOUT_BASE = `prima
<<<<<<< HEAD
mia
=======
loro
>>>>>>> branch
dopo
`;

test("conflitto diff3: tre sezioni e testo intorno", () => {
	const parts = parseConflicts(WITH_BASE);
	assert.equal(countConflicts(parts), 1);
	const conflict = parts.find((part) => part.kind === "conflict");
	assert.ok(conflict && conflict.kind === "conflict");
	assert.equal(conflict.hunk.ours, "mia\n");
	assert.equal(conflict.hunk.base, "originale\n");
	assert.equal(conflict.hunk.theirs, "loro\n");
	assert.equal(parts[0]!.kind, "text");
	assert.equal(parts.at(-1)!.kind, "text");
});

test("conflitto senza base: la sezione base resta assente", () => {
	const parts = parseConflicts(WITHOUT_BASE);
	const conflict = parts.find((part) => part.kind === "conflict");
	assert.ok(conflict && conflict.kind === "conflict");
	assert.equal(conflict.hunk.base, null);
	assert.equal(conflict.hunk.ours, "mia\n");
	assert.equal(conflict.hunk.theirs, "loro\n");
});

test("risoluzione per hunk: mio, loro, entrambi, base", () => {
	assert.equal(resolveConflicts(WITH_BASE, ["ours"]).text, "prima\nmia\ndopo\n");
	assert.equal(resolveConflicts(WITH_BASE, ["theirs"]).text, "prima\nloro\ndopo\n");
	assert.equal(
		resolveConflicts(WITH_BASE, ["both"]).text,
		"prima\nmia\nloro\ndopo\n"
	);
	assert.equal(
		resolveConflicts(WITH_BASE, ["base"]).text,
		"prima\noriginale\ndopo\n"
	);
	// senza base, «base» non inventa contenuto
	assert.equal(resolveConflicts(WITHOUT_BASE, ["base"]).text, "prima\ndopo\n");
});

test("più conflitti nello stesso file, scelte indipendenti", () => {
	const text = `A
<<<<<<< HEAD
uno
=======
1
>>>>>>> main
B
<<<<<<< HEAD
due
=======
2
>>>>>>> main
C
`;
	const parts = parseConflicts(text);
	assert.equal(countConflicts(parts), 2);
	const result = resolveConflicts(text, ["theirs", "ours"]);
	assert.equal(result.text, "A\n1\nB\ndue\nC\n");
	assert.equal(result.remaining, 0);
});

test("una scelta mancante lascia il conflitto e lo conta", () => {
	const result = resolveConflicts(WITH_BASE, []);
	assert.equal(result.remaining, 1);
	assert.match(result.text, /<<<<<<<\nmia\n/);
});

test("marcatori incompleti restano testo, non si perde niente", () => {
	const broken = "a\n<<<<<<< HEAD\nsenza fine\n";
	const parts = parseConflicts(broken);
	assert.equal(countConflicts(parts), 0);
	const result = resolveConflicts(broken, []);
	assert.equal(result.text, broken);
});

test("il file senza newline finale resta senza", () => {
	const text = "<<<<<<< HEAD\nx\n=======\ny\n>>>>>>> z";
	const result = resolveConflicts(text, ["theirs"]);
	// la riga «y» finiva con un newline; il marcatore finale era l'ultima riga del file
	assert.equal(result.text, "y\n");
});
