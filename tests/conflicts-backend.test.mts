import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";

import { CliGitBackend } from "../src/main/backend.ts";

/**
 * Un conflitto vero, prodotto da `git merge` su due rami, risolto dal backend come lo farebbe la UI:
 * tre versioni lette dagli stage, risultato scritto a mano o scelto per file, `git add`, `--continue`.
 */

const root = await mkdtemp(join(tmpdir(), "githandler-conflicts-"));

function git(...args: string[]): string {
	return execFileSync("git", args, { cwd: root, encoding: "utf8" });
}

git("init", "-b", "main");
git("config", "user.name", "Test");
git("config", "user.email", "test@example.com");

await writeFile(join(root, "testo.txt"), "prima\nriga condivisa\ndopo\n");
await writeFile(join(root, "intero.txt"), "uno\ndue\ntre\n");
git("add", ".");
git("commit", "-m", "base");

git("switch", "-c", "altro");
await writeFile(join(root, "testo.txt"), "prima\nversione loro\ndopo\n");
await writeFile(join(root, "intero.txt"), "uno\nDUE LORO\ntre\n");
git("commit", "-am", "modifiche loro");

git("switch", "main");
await writeFile(join(root, "testo.txt"), "prima\nversione mia\ndopo\n");
await writeFile(join(root, "intero.txt"), "uno\nDUE MIEI\ntre\n");
git("commit", "-am", "modifiche mie");

const backend = new CliGitBackend();
await backend.open(root);

after(async () => {
	await rm(root, { recursive: true, force: true, maxRetries: 3 });
});

test("il merge in conflitto lascia l'operazione sospesa", async () => {
	await assert.rejects(backend.merge("altro"));
	const snapshot = await backend.refresh();
	assert.equal(snapshot.info.operation, "merge");
	const files = await backend.conflicts();
	assert.deepEqual(
		files.map((file) => file.path).sort(),
		["intero.txt", "testo.txt"]
	);
	for (const file of files) {
		assert.equal(file.index, "U");
		assert.equal(file.worktree, "U");
		assert.deepEqual(file.stages, {
			base: true,
			ours: true,
			theirs: true,
		});
	}
});

test("il dettaglio porta le tre versioni e il testo con i marcatori", async () => {
	const detail = await backend.conflictDetail("testo.txt");
	assert.equal(detail.ours, "prima\nversione mia\ndopo\n");
	assert.equal(detail.theirs, "prima\nversione loro\ndopo\n");
	assert.equal(detail.base, "prima\nriga condivisa\ndopo\n");
	assert.match(detail.working, /<<<<<<< /);
	assert.equal(detail.binary, false);
});

test("scrive il risultato scelto e lo segna risolto", async () => {
	await backend.writeResolvedFile("testo.txt", "prima\nrisolto a mano\ndopo\n");
	assert.equal(
		await readFile(join(root, "testo.txt"), "utf8"),
		"prima\nrisolto a mano\ndopo\n"
	);
	const snapshot = await backend.markResolved(["testo.txt"]);
	assert.deepEqual(
		snapshot.status.entries
			.filter((entry) => entry.kind === "unmerged")
			.map((entry) => entry.path),
		["intero.txt"]
	);
});

test("«usa loro» per un intero file", async () => {
	const snapshot = await backend.resolveConflictFile("intero.txt", "theirs");
	assert.equal((await backend.conflicts()).length, 0);
	assert.equal(
		await readFile(join(root, "intero.txt"), "utf8"),
		"uno\nDUE LORO\ntre\n"
	);
	assert.equal(snapshot.status.entries.some((entry) => entry.kind === "unmerged"), false);
});

test("«continua» chiude il merge", async () => {
	const snapshot = await backend.continueOperation();
	assert.equal(snapshot.info.operation, null);
	assert.equal(snapshot.commits[0]!.subject.includes("Merge"), true);
	assert.equal(await readFile(join(root, "testo.txt"), "utf8"), "prima\nrisolto a mano\ndopo\n");
});

test("modifica da un lato e cancellazione dall'altro: si sceglie la cancellazione", async () => {
	git("switch", "-c", "cancella");
	git("rm", "intero.txt");
	git("commit", "-m", "tolgo intero.txt");

	git("switch", "main");
	await writeFile(join(root, "intero.txt"), "uno\nancora modificato\ntre\n");
	git("commit", "-am", "modifico intero.txt");

	await assert.rejects(backend.merge("cancella"));
	const files = await backend.conflicts();
	assert.deepEqual(files.map((file) => file.path), ["intero.txt"]);
	const detail = await backend.conflictDetail("intero.txt");
	assert.deepEqual(detail.stages, { base: true, ours: true, theirs: false });

	await backend.resolveConflictFile("intero.txt", "theirs");
	assert.equal((await backend.conflicts()).length, 0);
	await assert.rejects(readFile(join(root, "intero.txt"), "utf8"), {
		code: "ENOENT",
	});
	await backend.continueOperation();
	const snapshot = await backend.refresh();
	assert.equal(snapshot.info.operation, null);
	assert.equal(
		snapshot.status.entries.some((entry) => entry.path === "intero.txt"),
		false
	);
});
