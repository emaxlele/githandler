import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";

import { parseUndoLog, serializeUndoLog, snapshotRef } from "../src/core/undo.ts";
import { CliGitBackend } from "../src/main/backend.ts";

/**
 * L'undo si prova sul binario vero: si controlla dove punta HEAD, cosa c'è nell'indice e qual è
 * il contenuto del file, non solo che il comando sia andato a buon fine.
 */

const root = await mkdtemp(join(tmpdir(), "gitcraft-undo-"));

function git(...args: string[]): string {
	return execFileSync("git", args, { cwd: root, encoding: "utf8" });
}

git("init", "-b", "main");
git("config", "user.name", "Test");
git("config", "user.email", "test@example.com");
await writeFile(join(root, "a.txt"), "prima\nseconda\n");
git("add", "a.txt");
git("commit", "-m", "primo commit");

const backend = new CliGitBackend();
await backend.open(root);

after(async () => {
	await rm(root, { recursive: true, force: true });
});

test("il journal scarta le voci malformate", () => {
	const raw = JSON.stringify([
		{ id: "1", kind: "commit", at: 1, head: "abcdef1", branch: "main", label: "ok" },
		{ id: "2", kind: "delete", at: 1, head: null, branch: null, label: "kind ignoto" },
		{ id: "3", kind: "commit", at: 1, head: "non-un-sha", branch: null, label: "sha rotto" },
		{ id: "4", kind: "discard", at: 1, head: null, branch: null, label: "path pericoloso", paths: ["../etc/passwd"] },
		{ id: "5", kind: "discard", at: 1, head: null, branch: null, label: "path misti", paths: ["src/a.ts", "/etc/passwd"] },
	]);
	const entries = parseUndoLog(raw);
	assert.deepEqual(
		entries.map((entry) => entry.id),
		["1", "5"],
	);
	assert.deepEqual(entries[1]!.paths, ["src/a.ts"]);
	assert.deepEqual(parseUndoLog("non json"), []);
});

test("il journal si riscrive in modo stabile", () => {
	const entries = parseUndoLog(
		serializeUndoLog([
			{
				id: "10-commit",
				kind: "commit",
				at: 10,
				head: "abcdef1",
				branch: "main",
				label: "Commit: prova",
			},
		]),
	);
	assert.equal(entries.length, 1);
	assert.equal(entries[0]!.label, "Commit: prova");
	assert.equal(snapshotRef("10-commit"), "refs/gitcraft/snapshots/10-commit");
});

test("il commit si annulla con un soft reset", async () => {
	await writeFile(join(root, "a.txt"), "prima\nterza\n");
	await backend.stage(["a.txt"]);

	const afterCommit = await backend.commit("secondo commit", false);
	assert.ok(afterCommit.undo);
	assert.equal(afterCommit.undo!.kind, "commit");
	assert.match(
		git("for-each-ref", "refs/gitcraft/snapshots"),
		/refs\/gitcraft\/snapshots\//,
	);

	const undone = await backend.undo();
	assert.equal(undone.commits.length, 1);
	assert.equal(undone.commits[0]!.subject, "primo commit");
	assert.equal(undone.undo, null);

	// il contenuto è tornato nell'indice, non perso
	const entry = undone.status.entries.find((item) => item.path === "a.txt");
	assert.ok(entry);
	assert.equal(entry!.index, "M");
	assert.equal(entry!.worktree, ".");
	assert.equal(await readFile(join(root, "a.txt"), "utf8"), "prima\nterza\n");

	await assert.rejects(() => backend.undo(), /Niente da annullare/);
});

test("lo scarto si annulla ripristinando il contenuto", async () => {
	await writeFile(join(root, "a.txt"), "prima\nDIVERSO\n");

	const discarded = await backend.discard(["a.txt"]);
	assert.equal(await readFile(join(root, "a.txt"), "utf8"), "prima\nterza\n");
	assert.ok(discarded.undo);
	assert.equal(discarded.undo!.kind, "discard");

	const undone = await backend.undo();
	assert.equal(undone.undo, null);
	assert.equal(await readFile(join(root, "a.txt"), "utf8"), "prima\nDIVERSO\n");
});

test("il checkout si annulla tornando al ramo precedente", async () => {
	git("switch", "-c", "altra");
	await backend.refresh();

	const switched = await backend.checkout("main");
	assert.equal(switched.info.branch, "main");
	assert.equal(switched.undo!.kind, "checkout");

	const undone = await backend.undo();
	assert.equal(undone.info.branch, "altra");

	// resta una sola voce: si torna a main senza accumulare voci di servizio
	git("switch", "main");
	assert.equal((await backend.refresh()).info.branch, "main");
});

test("un commit fallito non lascia voci da annullare", async () => {
	const clean = await mkdtemp(join(tmpdir(), "gitcraft-undo-fail-"));
	execFileSync("git", ["init", "-b", "main"], { cwd: clean });
	execFileSync("git", ["config", "user.name", "Test"], { cwd: clean });
	execFileSync("git", ["config", "user.email", "test@example.com"], {
		cwd: clean,
	});
	await writeFile(join(clean, "f.txt"), "contenuto\n");
	execFileSync("git", ["add", "f.txt"], { cwd: clean });
	execFileSync("git", ["commit", "-m", "base"], { cwd: clean });

	const other = new CliGitBackend();
	await other.open(clean);

	// niente da committare: Git esce con errore dopo che la voce era stata registrata
	await assert.rejects(() => other.commit("vuoto", false), /nothing to commit/);
	assert.equal((await other.refresh()).undo, null);
	await rm(clean, { recursive: true, force: true });
});

test("il repository senza commit non registra nulla", async () => {
	const empty = await mkdtemp(join(tmpdir(), "gitcraft-undo-empty-"));
	execFileSync("git", ["init", "-b", "main"], { cwd: empty });
	const other = new CliGitBackend();
	await other.open(empty);
	const snapshot = await other.refresh();
	assert.equal(snapshot.undo, null);
	await assert.rejects(() => other.undo(), /Niente da annullare/);
	await rm(empty, { recursive: true, force: true });
});
