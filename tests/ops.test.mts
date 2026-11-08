import assert from "node:assert/strict";
import { test } from "node:test";

import {
	assertRefName,
	checkoutTrackingArgs,
	cherryPickArgs,
	deleteBranchArgs,
	localNameForRemote,
	mergeArgs,
	parseStashList,
	parseSubmodules,
	pullArgs,
	pushArgs,
	rebaseArgs,
	renameBranchArgs,
	stashApplyArgs,
	stashDropArgs,
	stashListArgs,
	stashSaveArgs,
} from "../src/core/ops.ts";

test("assertRefName rifiuta opzioni, spazi e sequenze riservate", () => {
	for (const bad of [
		"",
		"--upload-pack=evil",
		"ramo con spazi",
		"a..b",
		"a@{1}",
		"a~b",
		"a:b",
		"a?b",
		"a*b",
		"a[b",
		"a\\b",
		"fine/",
		"fine.lock",
	]) {
		assert.throws(() => assertRefName(bad), /Nome di ref non valido/, bad);
	}
	for (const good of ["main", "feature/grafo", "v1.0.0", "fix-123"])
		assert.doesNotThrow(() => assertRefName(good), good);
});

test("pull è solo fast-forward", () => {
	assert.deepEqual(pullArgs(), ["pull", "--ff-only"]);
});

test("push senza upstream crea il tracking su origin", () => {
	assert.deepEqual(pushArgs("main", false), [
		"push",
		"--set-upstream",
		"origin",
		"main",
	]);
	assert.deepEqual(pushArgs("main", true), ["push"]);
	assert.throws(() => pushArgs(null, false), /HEAD staccato/);
});

test("merge, rebase e cherry-pick non trattano i nomi come opzioni", () => {
	assert.deepEqual(mergeArgs("feature/grafo"), [
		"merge",
		"--no-edit",
		"--",
		"feature/grafo",
	]);
	assert.deepEqual(rebaseArgs("main"), ["rebase", "--", "main"]);
	assert.deepEqual(cherryPickArgs("abc1234"), [
		"cherry-pick",
		"--",
		"abc1234",
	]);
	assert.throws(() => cherryPickArgs("HEAD~1"), /SHA non valido/);
});

test("rinomina, elimina e tracking checkout", () => {
	assert.deepEqual(renameBranchArgs("vecchio", "nuovo"), [
		"branch",
		"-m",
		"vecchio",
		"nuovo",
	]);
	assert.deepEqual(deleteBranchArgs("vecchio", false), [
		"branch",
		"-d",
		"vecchio",
	]);
	assert.deepEqual(deleteBranchArgs("vecchio", true), [
		"branch",
		"-D",
		"vecchio",
	]);
	assert.deepEqual(checkoutTrackingArgs("origin/feature/x", "feature/x"), [
		"switch",
		"--track",
		"-c",
		"feature/x",
		"origin/feature/x",
	]);
});

test("localNameForRemote toglie il remoto dal nome", () => {
	assert.equal(localNameForRemote("origin/feature/x"), "feature/x");
	assert.equal(localNameForRemote("origin/main"), "main");
	assert.equal(localNameForRemote("main"), "main");
});

test("parseStashList legge posizione, sha, data, ramo e messaggio", () => {
	const raw = [
		"stash@{0}\x001111\x001700000100\x00WIP on main: abc123 messaggio\x1e",
		"stash@{1}\x002222\x001700000000\x00On feature: mio stash\x1e",
	].join("\n");
	const entries = parseStashList(raw);

	assert.equal(entries.length, 2);
	assert.deepEqual(entries[0], {
		index: 0,
		sha: "1111",
		message: "WIP on main: abc123 messaggio",
		branch: "main",
		timestamp: 1700000100,
	});
	assert.equal(entries[1]!.index, 1);
	assert.equal(entries[1]!.branch, "feature");
	assert.equal(entries[1]!.message, "On feature: mio stash");
});

test("stash: salvataggio con messaggio, applica e scarta", () => {
	assert.deepEqual(stashSaveArgs("  "), [
		"stash",
		"push",
		"--include-untracked",
	]);
	assert.deepEqual(stashSaveArgs("lavoro"), [
		"stash",
		"push",
		"--include-untracked",
		"-m",
		"lavoro",
	]);
	assert.deepEqual(stashApplyArgs(0, false), [
		"stash",
		"apply",
		"stash@{0}",
	]);
	assert.deepEqual(stashApplyArgs(2, true), ["stash", "pop", "stash@{2}"]);
	assert.deepEqual(stashDropArgs(1), ["stash", "drop", "stash@{1}"]);
	assert.throws(() => stashApplyArgs(-1, false), /Indice dello stash/);
	assert.deepEqual(stashListArgs(), [
		"stash",
		"list",
		"--format=%gd%x00%H%x00%ct%x00%gs%x1e",
	]);
});

test("parseSubmodules distingue pulito, modificato, non inizializzato e conflitto", () => {
	const raw = [
		" 1111111111111111111111111111111111111111 libs/a (heads/main)",
		"+2222222222222222222222222222222222222222 libs/b",
		"-3333333333333333333333333333333333333333 libs/c",
		"U4444444444444444444444444444444444444444 libs/d",
	].join("\n");

	const modules = parseSubmodules(raw);
	assert.equal(modules.length, 4);
	assert.deepEqual(modules[0], {
		path: "libs/a",
		sha: "1111111111111111111111111111111111111111",
		state: "clean",
		description: "heads/main",
	});
	assert.equal(modules[1]!.state, "modified");
	assert.equal(modules[2]!.state, "uninitialized");
	assert.equal(modules[3]!.state, "conflict");
});
