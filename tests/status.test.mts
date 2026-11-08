import assert from "node:assert/strict";
import { test } from "node:test";

import { parseStatus } from "../src/core/status.ts";

test("intestazioni NUL-separate (Git recente)", () => {
	const raw =
		"# branch.oid 1234567\x00" +
		"# branch.head main\x00" +
		"# branch.upstream origin/main\x00" +
		"# branch.ab +2 -1\x00" +
		"1 .M N... 100644 100644 100644 aaaa bbbb src/app.ts\x00" +
		"? note.txt\x00";

	const tree = parseStatus(raw);
	assert.equal(tree.oid, "1234567");
	assert.equal(tree.branch, "main");
	assert.equal(tree.upstream, "origin/main");
	assert.equal(tree.ahead, 2);
	assert.equal(tree.behind, 1);
	assert.equal(tree.entries.length, 2);

	assert.deepEqual(
		tree.entries.map((entry) => [
			entry.path,
			entry.index,
			entry.worktree,
			entry.kind,
		]),
		[
			["src/app.ts", ".", "M", "changed"],
			["note.txt", ".", ".", "untracked"],
		]
	);
	assert.equal(tree.entries[0]!.label, "Modificato");
});

test("intestazioni separate da newline (Git più vecchi)", () => {
	const raw =
		"# branch.oid 1234567\n# branch.head main\n# branch.ab +0 -0\x00" +
		"1 M. N... 100644 100644 100644 aaaa bbbb staged.ts\x001 .D N... 100644 100644 100644 aaaa bbbb gone.ts\x00";

	const tree = parseStatus(raw);
	assert.equal(tree.branch, "main");
	assert.equal(tree.entries.length, 2);
	assert.deepEqual(
		tree.entries.map((entry) => [entry.path, entry.index, entry.worktree]),
		[
			["staged.ts", "M", "."],
			["gone.ts", ".", "D"],
		]
	);
});

test("rinominati: il path originale è il token successivo", () => {
	const raw =
		"# branch.head main\x002 R. N... 100644 100644 100644 aaaa bbbb R100 nuova.ts\x00vecchia.ts\x00" +
		"? dopo.ts\x00";

	const tree = parseStatus(raw);
	assert.equal(tree.entries.length, 2);
	assert.deepEqual(
		[
			tree.entries[0]!.path,
			tree.entries[0]!.origPath,
			tree.entries[0]!.kind,
		],
		["nuova.ts", "vecchia.ts", "renamed"]
	);
	assert.equal(tree.entries[1]!.path, "dopo.ts");
});

test("conflitti e repo iniziale", () => {
	const raw =
		"# branch.oid (initial)\x00# branch.head (detached)\x00" +
		"u UU N... 100644 100644 100644 100644 h1 h2 h3 conflitto.ts\x00";

	const tree = parseStatus(raw);
	assert.equal(tree.oid, null);
	assert.equal(tree.branch, null);
	assert.equal(tree.entries[0]!.kind, "unmerged");
	assert.equal(tree.entries[0]!.label, "Conflitto");
});

test("path con spazi", () => {
	const raw =
		"# branch.head main\x001 .M N... 100644 100644 100644 a b con spazio/file.ts\x00";
	const tree = parseStatus(raw);
	assert.equal(tree.entries[0]!.path, "con spazio/file.ts");
});
