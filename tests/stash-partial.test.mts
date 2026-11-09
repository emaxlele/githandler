import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";
import { promisify } from "node:util";

import { CliGitBackend } from "../src/main/backend.ts";

const run = promisify(execFile);
const root = await mkdtemp(join(tmpdir(), "githandler-stash-"));

function git(...args: string[]): Promise<{ stdout: string }> {
	return run("git", args, {
		cwd: root,
		env: { ...process.env, LC_ALL: "C" },
	}) as Promise<{ stdout: string }>;
}

after(async () => {
	await rm(root, { recursive: true, force: true });
});

await git("init", "-b", "main");
await git("config", "user.name", "Test");
await git("config", "user.email", "test@example.com");
await writeFile(join(root, "a.txt"), "base a\n");
await writeFile(join(root, "b.txt"), "base b\n");
await git("add", ".");
await git("commit", "-qm", "primo");

const backend = new CliGitBackend();
await backend.open(root);

test("lo stash parziale salva solo i file indicati e lascia gli altri", async () => {
	await writeFile(join(root, "a.txt"), "modificato a\n");
	await writeFile(join(root, "b.txt"), "modificato b\n");
	await writeFile(join(root, "nuovo.txt"), "non tracciato\n");

	const snapshot = await backend.stashSave("solo a", ["a.txt"]);
	assert.equal(await readFile(join(root, "a.txt"), "utf8"), "base a\n");
	assert.equal(await readFile(join(root, "b.txt"), "utf8"), "modificato b\n");
	// il file non tracciato non era selezionato: resta dov'è
	assert.equal(await readFile(join(root, "nuovo.txt"), "utf8"), "non tracciato\n");
	assert.deepEqual(
		snapshot.status.entries.map((entry) => entry.path).sort(),
		["b.txt", "nuovo.txt"]
	);

	const stashes = await backend.stashList();
	assert.equal(stashes.length, 1);
	assert.equal(stashes[0]!.message.includes("solo a"), true);

	// applicare lo stash riporta a.txt sopra b.txt, che non era stato salvato
	await backend.stashApply(0, false);
	assert.equal(await readFile(join(root, "a.txt"), "utf8"), "modificato a\n");
	assert.equal(await readFile(join(root, "b.txt"), "utf8"), "modificato b\n");
});

test("un path fuori dal repository viene rifiutato prima di chiamare git", async () => {
	await writeFile(join(root, "a.txt"), "ancora modificato\n");
	await assert.rejects(
		() => backend.stashSave("x", ["../fuori.txt"]),
		/Percorso non valido/
	);
	await assert.rejects(
		() => backend.stashSave("x", ["-p"]),
		/Percorso non valido/
	);
	// niente stash creato dai tentativi rifiutati
	assert.equal((await backend.stashList()).length, 1);
});
