import assert from "node:assert/strict";
import { test } from "node:test";

import { parseDiff, parseNameStatus } from "../src/core/diff.ts";

const unified = [
	"diff --git a/src/a.ts b/src/a.ts",
	"index 1111111..2222222 100644",
	"--- a/src/a.ts",
	"+++ b/src/a.ts",
	"@@ -1,3 +1,4 @@ export const x",
	" const a = 1;",
	"-const b = 2;",
	"+const b = 3;",
	"+const c = 4;",
	" export { a };",
	"",
].join("\n");

test("parseDiff numera le righe e conta aggiunte/rimozioni", () => {
	const file = parseDiff(unified, "src/a.ts");
	assert.equal(file.status, "modified");
	assert.equal(file.binary, false);
	assert.equal(file.additions, 2);
	assert.equal(file.deletions, 1);
	assert.equal(file.hunks.length, 1);

	const hunk = file.hunks[0]!;
	assert.equal(hunk.header, "export const x");
	assert.equal(hunk.lines.length, 5);
	assert.deepEqual(
		hunk.lines.map((line) => [line.type, line.oldNo, line.newNo]),
		[
			["context", 1, 1],
			["del", 2, null],
			["add", null, 2],
			["add", null, 3],
			["context", 3, 4],
		]
	);
});

test("file nuovo e file eliminato", () => {
	const added = parseDiff(
		[
			"diff --git a/n.txt b/n.txt",
			"new file mode 100644",
			"index 0000000..1111111",
			"--- /dev/null",
			"+++ b/n.txt",
			"@@ -0,0 +1,2 @@",
			"+prima",
			"+seconda",
		].join("\n"),
		"n.txt"
	);

	assert.equal(added.status, "added");
	assert.equal(added.additions, 2);
	assert.equal(added.deletions, 0);
	assert.equal(added.hunks[0]!.newStart, 1);

	const deleted = parseDiff(
		[
			"diff --git a/d.txt b/d.txt",
			"deleted file mode 100644",
			"@@ -1,1 +0,0 @@",
			"-sparito",
		].join("\n"),
		"d.txt"
	);

	assert.equal(deleted.status, "deleted");
	assert.equal(deleted.deletions, 1);
});

test("binari", () => {
	const file = parseDiff(
		[
			"diff --git a/logo.png b/logo.png",
			"index 1111111..2222222 100644",
			"Binary files a/logo.png and b/logo.png differ",
		].join("\n"),
		"logo.png"
	);
	assert.equal(file.binary, true);
	assert.equal(file.status, "binary");
	assert.equal(file.hunks.length, 0);
});

test("una riga rimossa che inizia con -- non confonde il parser", () => {
	const file = parseDiff(
		[
			"diff --git a/x.md b/x.md",
			"--- a/x.md",
			"+++ b/x.md",
			"@@ -1,3 +1,1 @@",
			"--- titolo",
			"-+ nota",
			" resto",
		].join("\n"),
		"x.md"
	);

	assert.equal(file.deletions, 2);
	assert.equal(file.hunks[0]!.lines[0]!.type, "del");
	assert.equal(file.hunks[0]!.lines[0]!.text, "-- titolo");
});

test("rename e no-newline", () => {
	const file = parseDiff(
		[
			"diff --git a/old.ts b/new.ts",
			"similarity index 90%",
			"rename from old.ts",
			"rename to new.ts",
			"--- a/old.ts",
			"+++ b/new.ts",
			"@@ -1 +1 @@",
			"-vecchio",
			"+nuovo",
			"\\ No newline at end of file",
		].join("\n"),
		"new.ts"
	);

	assert.equal(file.status, "renamed");
	assert.equal(file.oldPath, "old.ts");
	assert.equal(file.hunks[0]!.lines.at(-1)!.type, "nonewline");
});

test("parseNameStatus gestisce modifiche, rename e path vuoti", () => {
	const files = parseNameStatus(
		"M\x00src/a.ts\x00R100\x00vecchio.ts\x00nuovo.ts\x00A\x00creato.ts\x00D\x00sparito.ts\x00"
	);

	assert.deepEqual(
		files.map((file) => [file.status, file.path, file.oldPath]),
		[
			["M", "src/a.ts", null],
			["R", "nuovo.ts", "vecchio.ts"],
			["A", "creato.ts", null],
			["D", "sparito.ts", null],
		]
	);
});
