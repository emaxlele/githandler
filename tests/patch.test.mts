import assert from "node:assert/strict";
import { test } from "node:test";

import { parseDiff } from "../src/core/diff.ts";
import {
	buildPatch,
	canStagePartially,
	patchTargetsOnly,
} from "../src/core/patch.ts";

const unified = [
	"diff --git a/src/app.ts b/src/app.ts",
	"index 1111111..2222222 100644",
	"--- a/src/app.ts",
	"+++ b/src/app.ts",
	"@@ -10,4 +10,5 @@ function main()",
	" const a = 1;",
	"-const b = 2;",
	"-const c = 3;",
	"+const b = 20;",
	"+const c = 30;",
	"+const d = 40;",
	" return a;",
	"",
].join("\n");

function fixture() {
	return parseDiff(unified, "src/app.ts");
}

test("la patch completa riproduce l'hunk originale", () => {
	const patch = buildPatch(fixture(), [{ hunk: 0 }], "stage");
	assert.ok(patch);

	const lines = patch!.split("\n");
	assert.equal(lines[0], "diff --git a/src/app.ts b/src/app.ts");
	assert.equal(lines[1], "--- a/src/app.ts");
	assert.equal(lines[2], "+++ b/src/app.ts");
	// 2 contesto + 2 rimosse = 4 sul lato vecchio, 2 + 3 = 5 sul nuovo
	assert.equal(lines[3], "@@ -10,4 +10,5 @@ function main()");
	assert.deepEqual(lines.slice(4, 9), [
		" const a = 1;",
		"-const b = 2;",
		"-const c = 3;",
		"+const b = 20;",
		"+const c = 30;",
	]);
	assert.ok(patch!.endsWith("\n"));
});

test("stage parziale: le rimozioni non scelte diventano contesto, le aggiunte non scelte spariscono", () => {
	const file = fixture();
	// righe dell'hunk: 0 contesto, 1 -b, 2 -c, 3 +b, 4 +c, 5 +d, 6 contesto
	const patch = buildPatch(file, [{ hunk: 0, lines: [2, 4] }], "stage");
	assert.ok(patch);

	const lines = patch!.split("\n");
	// lato vecchio: 2 contesto originali + `-c` selezionata + `-b` diventata contesto = 4
	// lato nuovo: 2 contesto + `-b` diventata contesto + `+c` = 4
	assert.equal(lines[3], "@@ -10,4 +10,4 @@ function main()");
	assert.deepEqual(lines.slice(4, 8), [
		" const a = 1;",
		" const b = 2;",
		"-const c = 3;",
		"+const c = 30;",
	]);
});

test("stage parziale di una sola aggiunta", () => {
	const patch = buildPatch(fixture(), [{ hunk: 0, lines: [5] }], "stage");
	const lines = patch!.split("\n");
	// vecchio: 2 contesto + 2 rimosse diventate contesto = 4; nuovo: 4 + 1 aggiunta = 5
	assert.equal(lines[3], "@@ -10,4 +10,5 @@ function main()");
	assert.deepEqual(lines.slice(4), [
		" const a = 1;",
		" const b = 2;",
		" const c = 3;",
		"+const d = 40;",
		" return a;",
		"",
	]);
});

test("unstage parziale: le aggiunte non scelte diventano contesto, le rimozioni non scelte spariscono", () => {
	const file = fixture();
	const patch = buildPatch(file, [{ hunk: 0, lines: [1, 3] }], "unstage");
	assert.ok(patch);

	const lines = patch!.split("\n");
	// vecchio: 2 contesto + `-b` = 3; nuovo: 2 contesto + `+b` + `+c`/`+d` diventate contesto? no:
	// in unstage le aggiunte non scelte restano nell'indice, quindi `+c` e `+d` sono contesto
	assert.equal(lines[3], "@@ -10,5 +10,5 @@ function main()");
	assert.deepEqual(lines.slice(4, 9), [
		" const a = 1;",
		"-const b = 2;",
		"+const b = 20;",
		" const c = 30;",
		" const d = 40;",
	]);
});

test("una selezione senza modifiche reali non produce patch", () => {
	assert.equal(buildPatch(fixture(), [{ hunk: 0, lines: [] }], "stage"), null);
	assert.equal(buildPatch(fixture(), [], "stage"), null);
	assert.equal(buildPatch(fixture(), [{ hunk: 9 }], "stage"), null);
});

test("file nuovo, eliminato e binario non ammettono staging parziale", () => {
	const added = parseDiff(
		[
			"diff --git a/n.txt b/n.txt",
			"new file mode 100644",
			"--- /dev/null",
			"+++ b/n.txt",
			"@@ -0,0 +1,1 @@",
			"+ciao",
		].join("\n"),
		"n.txt",
	);
	assert.equal(canStagePartially(added), false);
	assert.equal(buildPatch(added, [{ hunk: 0 }], "stage"), null);

	const binary = parseDiff(
		["diff --git a/a.png b/a.png", "Binary files a/a.png and b/a.png differ"].join(
			"\n",
		),
		"a.png",
	);
	assert.equal(canStagePartially(binary), false);
});

test("la patch può toccare solo il file dichiarato", () => {
	const patch = buildPatch(fixture(), [{ hunk: 0 }], "stage")!;
	assert.equal(patchTargetsOnly(patch, "src/app.ts"), true);
	assert.equal(patchTargetsOnly(patch, "src/other.ts"), false);

	const injected = patch.replace("+++ b/src/app.ts", "+++ b/src/evil.sh");
	assert.equal(patchTargetsOnly(injected, "src/app.ts"), false);
});
