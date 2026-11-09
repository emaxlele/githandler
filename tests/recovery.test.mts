import assert from "node:assert/strict";
import { test } from "node:test";

import { summarizeRecovery } from "../src/core/recovery.ts";
import type { UndoEntry } from "../src/core/undo.ts";

const trash = { bytes: 2048, files: 3, entries: 2 };

test("senza niente da recuperare il riassunto è vuoto", () => {
	const summary = summarizeRecovery({ undo: null, stashes: 0, trash });
	assert.deepEqual(summary, {
		undoable: false,
		undoDescription: null,
		stashes: 0,
		trashFiles: 3,
		trashBytes: 2048,
		trashEntries: 2,
		anything: true,
	});

	const empty = summarizeRecovery({
		undo: null,
		stashes: 0,
		trash: { bytes: 0, files: 0, entries: 0 },
	});
	assert.equal(empty.anything, false);
});

test("l'ultima operazione porta la sua descrizione", () => {
	const undo: UndoEntry = {
		id: "1-checkout",
		kind: "checkout",
		at: 1,
		head: "a".repeat(40),
		branch: "main",
		label: "Checkout di feature (prima: main)",
	};
	const summary = summarizeRecovery({ undo, stashes: 2, trash });
	assert.equal(summary.undoable, true);
	assert.equal(summary.undoDescription, "Torna al ramo main");
	assert.equal(summary.stashes, 2);
	assert.equal(summary.anything, true);
});

test("conteggi negativi o non finiti non diventano numeri strani", () => {
	const summary = summarizeRecovery({
		undo: null,
		stashes: -2,
		trash: { bytes: Number.NaN, files: -1, entries: 0 },
	});
	assert.equal(summary.stashes, 0);
	assert.equal(summary.trashFiles, 0);
	assert.equal(summary.trashBytes, 0);
	assert.equal(summary.anything, false);
});
