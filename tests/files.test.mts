import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";

import {
	readCommitFile,
	readWorkingFile,
	resolveInside,
} from "../src/main/files.ts";

/**
 * Integrazione: un repository vero, file di testo e binari. Il punto non è il parsing ma i **byte**:
 * una copia salvata deve essere identica, anche quando il file non è UTF-8.
 */

const root = await mkdtemp(join(tmpdir(), "githandler-files-"));

function git(...args: string[]): string {
	return execFileSync("git", args, { cwd: root, encoding: "utf8" });
}

git("init", "-b", "main");
git("config", "user.name", "Test");
git("config", "user.email", "test@example.com");

const binary = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x00, 0xff, 0xfe, 0x0a, 0x00]);
await writeFile(join(root, "logo.png"), binary);
await writeFile(join(root, "nota.txt"), "prima versione\n");
await writeFile(join(root, "spazio file.txt"), "con lo spazio\n");
git("add", ".");
git("commit", "-m", "primo");
const first = git("rev-parse", "HEAD").trim();

// il file cambia dopo il commit: la copia da commit deve restituire la versione di allora
await writeFile(join(root, "logo.png"), "cambiato davvero\n");
await writeFile(join(root, "nota.txt"), "seconda versione, più lunga\n");

after(async () => {
	await rm(root, { recursive: true, force: true });
});

test("i path restano dentro il repository", () => {
	assert.equal(resolveInside(root, "nota.txt"), join(root, "nota.txt"));
	assert.equal(resolveInside(root, "a/b/../c.txt"), join(root, "a/c.txt"));

	for (const bad of ["", "  ", "/etc/passwd", "../fuori.txt", "a/../../x"]) {
		assert.throws(() => resolveInside(root, bad), /non valido|fuori dal repository|mancante/i, bad);
	}
});

test("il working tree dà i byte attuali, anche binari", async () => {
	const current = await readWorkingFile(root, "logo.png");
	assert.deepEqual(current, Buffer.from("cambiato davvero\n"));

	const spaced = await readWorkingFile(root, "spazio file.txt");
	assert.deepEqual(spaced, Buffer.from("con lo spazio\n"));
});

test("il commit dà la versione di allora, byte per byte", async () => {
	assert.deepEqual(await readCommitFile(root, first, "logo.png"), binary);
	assert.deepEqual(
		await readCommitFile(root, first, "nota.txt"),
		Buffer.from("prima versione\n")
	);

	// un file che in quel commit non c'era: errore di git, non contenuto vuoto
	await assert.rejects(
		readCommitFile(root, first, "non-esiste.txt"),
		/già|does not exist|esiste/i
	);
	await assert.rejects(readCommitFile(root, "non-uno-sha", "nota.txt"), /SHA non valido/);
	await assert.rejects(readCommitFile(root, first, "../fuori"), /Percorso non valido/);
});
