import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import {
	access,
	mkdir,
	mkdtemp,
	readFile,
	rm,
	truncate,
	writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";

import type { Settings } from "../src/core/settings.ts";
import { CliGitBackend } from "../src/main/backend.ts";
import {
	copyToTrash,
	TrashLimitError,
	trashDirectory,
} from "../src/main/trash.ts";

/**
 * Lo scarto dei file non tracciati si prova sul filesystem vero: copia, cancellazione,
 * ripristino e limiti. Nessun mock: il comportamento dipende proprio dal disco.
 */

const root = await mkdtemp(join(tmpdir(), "gitcraft-trash-"));

function git(...args: string[]): string {
	return execFileSync("git", args, { cwd: root, encoding: "utf8" });
}

git("init", "-b", "main");
git("config", "user.name", "Test");
git("config", "user.email", "test@example.com");
await writeFile(join(root, "tracked.txt"), "base\n");
git("add", "tracked.txt");
git("commit", "-m", "primo commit");

let settings: Settings = {
	api: { mode: "off", tools: [] },
	trashUntracked: true,
};
const backend = new CliGitBackend({ settings: async () => settings });
await backend.open(root);

function gitDir(): string {
	return git("rev-parse", "--absolute-git-dir").trim();
}

async function exists(path: string): Promise<boolean> {
	try {
		await access(path);
		return true;
	} catch {
		return false;
	}
}

after(async () => {
	await rm(root, { recursive: true, force: true });
});

test("file e cartelle non tracciati tornano con Annulla", async () => {
	await writeFile(join(root, "nuovo.txt"), "contenuto nuovo\n");
	await mkdir(join(root, "cartella", "sub"), { recursive: true });
	await writeFile(join(root, "cartella", "sub", "dentro.txt"), "dentro\n");

	const discarded = await backend.discard(["nuovo.txt", "cartella/"]);
	assert.equal(await exists(join(root, "nuovo.txt")), false);
	assert.equal(await exists(join(root, "cartella")), false);

	const undo = discarded.undo;
	assert.ok(undo);
	assert.equal(undo!.kind, "discard");
	assert.deepEqual(new Set(undo!.untrackedPaths), new Set(["nuovo.txt", "cartella/"]));
	assert.ok(undo!.trash);
	assert.equal(await exists(trashDirectory(gitDir(), undo!.trash!)), true);

	const restored = await backend.undo();
	assert.equal(restored.undo, null);
	assert.equal(await readFile(join(root, "nuovo.txt"), "utf8"), "contenuto nuovo\n");
	assert.equal(
		await readFile(join(root, "cartella", "sub", "dentro.txt"), "utf8"),
		"dentro\n",
	);
	assert.equal(await exists(trashDirectory(gitDir(), undo!.trash!)), false);
});

test("oltre il limite la copia fallisce e il file resta", async () => {
	const big = join(root, "grande.bin");
	await writeFile(big, "");
	await truncate(big, 26 * 1024 * 1024);

	await assert.rejects(() => backend.discard(["grande.bin"]), /limite/);
	assert.equal(await exists(big), true);
	assert.equal((await backend.refresh()).undo, null);

	// disattivando la copia lo scarto è permesso, ma non è annullabile
	settings = { api: { mode: "off", tools: [] }, trashUntracked: false };
	const discarded = await backend.discard(["grande.bin"]);
	assert.equal(await exists(big), false);
	assert.equal(discarded.undo, null);
	settings = { api: { mode: "off", tools: [] }, trashUntracked: true };
});

test("un file ricreato non viene sovrascritto dall'annullamento", async () => {
	await writeFile(join(root, "dup.txt"), "originale\n");
	await backend.discard(["dup.txt"]);
	await writeFile(join(root, "dup.txt"), "scritto dopo\n");

	await assert.rejects(() => backend.undo(), /esiste già/);
	assert.equal(await readFile(join(root, "dup.txt"), "utf8"), "scritto dopo\n");

	// la voce è ancora lì: togliendo il file nuovo il ripristino riesce
	await rm(join(root, "dup.txt"));
	const restored = await backend.undo();
	assert.equal(restored.undo, null);
	assert.equal(await readFile(join(root, "dup.txt"), "utf8"), "originale\n");
});

test("copyToTrash rispetta i limiti passati", async () => {
	const dir = await mkdtemp(join(tmpdir(), "gitcraft-trash-limits-"));
	await writeFile(join(dir, "x.txt"), "x".repeat(100));
	await assert.rejects(
		() =>
			copyToTrash({
				gitDir: dir,
				root: dir,
				id: "prova",
				paths: ["x.txt"],
				limits: { maxBytes: 10 },
			}),
		(error: unknown) => error instanceof TrashLimitError,
	);
	await assert.rejects(
		() =>
			copyToTrash({
				gitDir: dir,
				root: dir,
				id: "prova",
				paths: ["x.txt"],
				limits: { maxFiles: 0 },
			}),
		(error: unknown) => error instanceof TrashLimitError,
	);
	assert.equal(await exists(join(dir, "gitcraft", "trash", "prova")), false);
	await rm(dir, { recursive: true, force: true });
});
