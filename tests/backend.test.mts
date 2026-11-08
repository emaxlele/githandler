import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";

import { CliGitBackend } from "../src/main/backend.ts";

/**
 * Test di integrazione: nessun mock di Git. Il backend esegue il binario `git` vero su un
 * repository temporaneo, quindi verifica insieme il parser e i comandi effettivamente invocati.
 */

const root = await mkdtemp(join(tmpdir(), "gitcraft-test-"));

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

after(async () => {
	await rm(root, { recursive: true, force: true });
});

test("open legge radice, ramo e storia", async () => {
	const snapshot = await backend.open(root);

	assert.equal(snapshot.info.root, root);
	assert.equal(snapshot.info.name, root.split("/").pop());
	assert.equal(snapshot.info.branch, "main");
	assert.equal(snapshot.info.detached, false);
	assert.equal(snapshot.commits.length, 1);
	assert.equal(snapshot.commits[0]!.subject, "primo commit");
	assert.equal(snapshot.commits[0]!.parents.length, 0);
	assert.equal(snapshot.graph.length, 1);
	assert.ok(snapshot.refs.some((ref) => ref.kind === "local" && ref.current));
	assert.equal(snapshot.status.entries.length, 0);
});

test("status vede le modifiche e il diff le riporta", async () => {
	await writeFile(join(root, "a.txt"), "prima\nMODIFICATA\n");

	let snapshot = await backend.refresh();
	assert.equal(snapshot.status.entries.length, 1);
	const entry = snapshot.status.entries[0]!;
	assert.equal(entry.path, "a.txt");
	assert.equal(entry.index, ".");
	assert.equal(entry.worktree, "M");

	const diff = await backend.worktreePatch("a.txt", false);
	assert.equal(diff.path, "a.txt");
	assert.equal(diff.additions, 1);
	assert.equal(diff.deletions, 1);
	assert.equal(diff.hunks.length, 1);
});

test("stage e unstage spostano l'entry fra i due lati", async () => {
	let snapshot = await backend.stage(["a.txt"]);
	assert.equal(snapshot.status.entries[0]!.index, "M");
	assert.equal(snapshot.status.entries[0]!.worktree, ".");

	const staged = await backend.worktreePatch("a.txt", true);
	assert.equal(staged.additions, 1);

	snapshot = await backend.unstage(["a.txt"]);
	assert.equal(snapshot.status.entries[0]!.index, ".");
	assert.equal(snapshot.status.entries[0]!.worktree, "M");
});

test("file non tracciati: la patch arriva da --no-index", async () => {
	await writeFile(join(root, "nuovo.txt"), "riga uno\nriga due\n");
	const snapshot = await backend.refresh();
	const entry = snapshot.status.entries.find((item) => item.path === "nuovo.txt");
	assert.ok(entry);
	assert.equal(entry!.kind, "untracked");

	const diff = await backend.worktreePatch("nuovo.txt", false);
	assert.equal(diff.status, "added");
	assert.equal(diff.additions, 2);
});

test("discard ripristina i file tracciati e cancella i non tracciati", async () => {
	const snapshot = await backend.discard(["a.txt", "nuovo.txt"]);
	assert.equal(snapshot.status.entries.length, 0);
	assert.equal(await readFile(join(root, "a.txt"), "utf8"), "prima\nseconda\n");
});

test("commit con messaggio da stdin e dettagli del commit", async () => {
	await writeFile(join(root, "a.txt"), "prima\nterza\n");
	await backend.stage(["a.txt"]);

	const snapshot = await backend.commit("secondo commit\n\ncorpo del messaggio", false);
	assert.equal(snapshot.commits.length, 2);
	assert.equal(snapshot.commits[0]!.subject, "secondo commit");
	assert.equal(snapshot.status.entries.length, 0);

	const files = await backend.commitFiles(snapshot.commits[0]!.sha);
	assert.deepEqual(
		files.map((file) => [file.path, file.status]),
		[["a.txt", "M"]],
	);

	const patch = await backend.commitPatch(snapshot.commits[0]!.sha, "a.txt");
	assert.equal(patch.additions, 1);
	assert.equal(patch.deletions, 1);
});

test("ramo nuovo e checkout", async () => {
	let snapshot = await backend.createBranch("feature/prova");
	assert.equal(snapshot.info.branch, "feature/prova");

	snapshot = await backend.checkout("main");
	assert.equal(snapshot.info.branch, "main");
});

test("il commit radice si legge senza parent", async () => {
	const snapshot = await backend.refresh();
	const rootCommit = snapshot.commits.at(-1)!;
	assert.equal(rootCommit.parents.length, 0);

	const files = await backend.commitFiles(rootCommit.sha);
	assert.deepEqual(
		files.map((file) => [file.path, file.status]),
		[["a.txt", "A"]],
	);

	const patch = await backend.commitPatch(rootCommit.sha, "a.txt");
	assert.equal(patch.status, "added");
	assert.equal(patch.additions, 2);
});

test("un ramo con file in una sottocartella", async () => {
	await mkdir(join(root, "src"), { recursive: true });
	await writeFile(join(root, "src", "con spazio.ts"), "export const x = 1;\n");
	await backend.stage(["src/con spazio.ts"]);
	const snapshot = await backend.commit("file con spazio", false);
	assert.equal(snapshot.status.entries.length, 0);

	const files = await backend.commitFiles(snapshot.commits[0]!.sha);
	assert.ok(files.some((file) => file.path === "src/con spazio.ts"));
});
