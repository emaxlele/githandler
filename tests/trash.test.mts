import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import {
	access,
	chmod,
	mkdir,
	mkdtemp,
	readFile,
	readlink,
	rm,
	stat,
	symlink,
	truncate,
	writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";

import {
	defaultSettings,
	MEBIBYTE,
	type Settings,
} from "../src/core/settings.ts";
import { CliGitBackend } from "../src/main/backend.ts";
import {
	removeTrash,
	restoreFromTrash,
	storeTrash,
	TrashUnsupportedError,
	trashRef,
	trashRefPrefix,
} from "../src/main/trash.ts";

/**
 * Lo scarto dei file non tracciati si prova sul filesystem vero e su Git vero: copia come oggetti,
 * ripristino, limiti, quota e compatibilità con il formato v0.4. Nessun mock: il comportamento
 * dipende proprio da come Git tratta i path e i byte.
 */

const root = await mkdtemp(join(tmpdir(), "gitlattice-trash-"));
const extraRoots: string[] = [];

function git(...args: string[]): string {
	return execFileSync("git", args, { cwd: root, encoding: "utf8" });
}

function gitBuffer(...args: string[]): Buffer {
	return execFileSync("git", args, { cwd: root });
}

git("init", "-b", "main");
git("config", "user.name", "Test");
git("config", "user.email", "test@example.com");
await writeFile(join(root, "tracked.txt"), "base\n");
git("add", "tracked.txt");
git("commit", "-m", "primo commit");

function trashSettings(
	patch: Partial<Settings["trash"]> = {}
): Settings {
	return {
		api: { mode: "off", tools: [] },
		trash: { ...defaultSettings().trash, ...patch },
	};
}

let settings = trashSettings();
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

function refExists(gitDirPath: string, id: string): boolean {
	try {
		execFileSync(
			"git",
			[
				"--git-dir",
				gitDirPath,
				"rev-parse",
				"--verify",
				"--quiet",
				trashRef(gitDirPath, id),
			],
			{ cwd: root, stdio: "ignore" }
		);
		return true;
	} catch {
		return false;
	}
}

function treePaths(id: string): string[] {
	const listing = execFileSync(
		"git",
		["--git-dir", gitDir(), "ls-tree", "-r", "-z", "--name-only", trashRef(gitDir(), id)],
		{ cwd: root, encoding: "utf8" }
	);
	return listing.split("\0").filter(Boolean);
}

after(async () => {
	await rm(root, { recursive: true, force: true });
	for (const path of extraRoots) await rm(path, { recursive: true, force: true });
});

test("file, cartella, eseguibile e link tornano con Annulla", async () => {
	await writeFile(join(root, "nuovo.txt"), "contenuto nuovo\n");
	await mkdir(join(root, "cartella", "sub"), { recursive: true });
	await writeFile(join(root, "cartella", "sub", "dentro.txt"), "dentro\n");
	await mkdir(join(root, "bin"));
	await writeFile(join(root, "bin", "run.sh"), "#!/bin/sh\necho ok\n");
	await chmod(join(root, "bin", "run.sh"), 0o755);
	await symlink("nuovo.txt", join(root, "link.txt"));

	const discarded = await backend.discard([
		"nuovo.txt",
		"cartella/",
		"bin",
		"link.txt",
	]);
	assert.equal(await exists(join(root, "nuovo.txt")), false);
	assert.equal(await exists(join(root, "cartella")), false);
	assert.equal(await exists(join(root, "bin")), false);
	assert.equal(await exists(join(root, "link.txt")), false);

	const undo = discarded.undo;
	assert.ok(undo);
	assert.equal(undo!.kind, "discard");
	assert.ok(undo!.trash);
	assert.equal(undo!.trashFiles, 4);
	assert.ok((undo!.trashBytes ?? 0) > 0);
	assert.equal(refExists(gitDir(), undo!.trash!), true);
	assert.deepEqual(new Set(treePaths(undo!.trash!)), new Set([
		"nuovo.txt",
		"cartella/sub/dentro.txt",
		"bin/run.sh",
		"link.txt",
	]));

	// la modalità eseguibile e il link non sono semplici file: l'albero deve dirlo
	const modes = git("--git-dir", gitDir(), "ls-tree", "-r", trashRef(gitDir(), undo!.trash!));
	assert.match(modes, /100755 blob \w+\tbin\/run\.sh/);
	assert.match(modes, /120000 blob \w+\tlink\.txt/);

	const restored = await backend.undo();
	assert.equal(restored.undo, null);
	assert.equal(await readFile(join(root, "nuovo.txt"), "utf8"), "contenuto nuovo\n");
	assert.equal(
		await readFile(join(root, "cartella", "sub", "dentro.txt"), "utf8"),
		"dentro\n"
	);
	assert.equal(await readlink(join(root, "link.txt")), "nuovo.txt");
	assert.ok(((await stat(join(root, "bin", "run.sh"))).mode & 0o111) !== 0);
	assert.equal(
		refExists(gitDir(), undo!.trash!),
		false,
		"il ref deve sparire quando la voce esce dal journal"
	);
});

test("i byte sono quelli del disco: CRLF, NUL e nomi con %", async () => {
	const binary = Buffer.concat([
		Buffer.from([0x00, 0x01, 0xff, 0xfe]),
		Buffer.from("riga\r\nseconda\r\n", "utf8"),
	]);
	await writeFile(join(root, "binario.dat"), binary);
	await writeFile(join(root, "crlf.txt"), "a\r\nb\r\n");
	await writeFile(join(root, "100%.txt"), "percento\n");
	await writeFile(join(root, "%00x.txt"), "escape\n");

	const discarded = await backend.discard([
		"binario.dat",
		"crlf.txt",
		"100%.txt",
		"%00x.txt",
	]);
	const id = discarded.undo!.trash!;
	const ref = trashRef(gitDir(), id);

	// `hash-object` senza `--path` non applica autocrlf: il blob è identico al file
	assert.deepEqual(gitBuffer("--git-dir", gitDir(), "cat-file", "blob", `${ref}:binario.dat`), binary);
	assert.deepEqual(
		gitBuffer("--git-dir", gitDir(), "cat-file", "blob", `${ref}:crlf.txt`),
		Buffer.from("a\r\nb\r\n")
	);

	await backend.undo();
	assert.deepEqual(await readFile(join(root, "binario.dat")), binary);
	assert.equal(await readFile(join(root, "crlf.txt"), "utf8"), "a\r\nb\r\n");
	assert.equal(await readFile(join(root, "100%.txt"), "utf8"), "percento\n");
	assert.equal(await readFile(join(root, "%00x.txt"), "utf8"), "escape\n");
});

test("un nome con newline passa da hash-object come argomento", async () => {
	const name = "a\nb.txt";
	await writeFile(join(root, name), "newline nel nome\n");
	const id = "prova-newline";
	const stored = await storeTrash({
		root,
		gitDir: gitDir(),
		id,
		paths: [name],
		limits: { maxBytes: MEBIBYTE, maxFiles: 10 },
	});
	assert.ok(stored);
	assert.deepEqual(treePaths(id), [name]);

	await rm(join(root, name));
	await restoreFromTrash({ root, gitDir: gitDir(), id, paths: [name] });
	assert.equal(await readFile(join(root, name), "utf8"), "newline nel nome\n");
	await removeTrash(root, gitDir(), id);
});

test("un sotto-repo annidato conserva anche la sua cartella .git", async () => {
	await mkdir(join(root, "nested", ".git", "refs"), { recursive: true });
	await writeFile(join(root, "nested", ".git", "HEAD"), "ref: refs/heads/main\n");
	await writeFile(join(root, "nested", ".git", "refs", "main"), "abc\n");
	await writeFile(join(root, "nested", "a.txt"), "sotto\n");
	await writeFile(join(root, "nested", "git~1"), "nome NTFS\n");

	const discarded = await backend.discard(["nested"]);
	assert.equal(await exists(join(root, "nested")), false);

	// Git rifiuterebbe `.git` in un albero: la copia lo conserva codificato, senza perdere nulla
	const id = discarded.undo!.trash!;
	const paths = treePaths(id);
	assert.ok(paths.includes("nested/%00.git/HEAD"));
	assert.ok(paths.includes("nested/%00git~1"));

	await backend.undo();
	assert.equal(
		await readFile(join(root, "nested", ".git", "HEAD"), "utf8"),
		"ref: refs/heads/main\n"
	);
	assert.equal(
		await readFile(join(root, "nested", ".git", "refs", "main"), "utf8"),
		"abc\n"
	);
	assert.equal(await readFile(join(root, "nested", "a.txt"), "utf8"), "sotto\n");
	assert.equal(await readFile(join(root, "nested", "git~1"), "utf8"), "nome NTFS\n");
});

test("un file speciale viene rifiutato prima di cancellare", async () => {
	const fifo = join(root, "pipe");
	execFileSync("mkfifo", [fifo]);

	// `git status` non elenca i file speciali: li si prova direttamente sul salvataggio
	await assert.rejects(
		() =>
			storeTrash({
				root,
				gitDir: gitDir(),
				id: "prova-fifo",
				paths: ["pipe"],
				limits: { maxBytes: MEBIBYTE, maxFiles: 10 },
			}),
		(error: unknown) => error instanceof TrashUnsupportedError
	);
	assert.equal(await exists(fifo), true);
	assert.equal(git("--git-dir", gitDir(), "for-each-ref", trashRefPrefix(gitDir())), "");
	await rm(fifo, { force: true });
});

test("oltre il limite lo scarto si rifiuta e non cancella niente", async () => {
	settings = trashSettings({ maxBytes: 1024, maxFiles: 3 });

	const big = join(root, "grande.bin");
	await writeFile(big, "");
	await truncate(big, 2048);
	await assert.rejects(
		() => backend.discard(["grande.bin"]),
		/supera il limite di 1 kB/
	);
	assert.equal(await exists(big), true);
	assert.equal((await backend.refresh()).undo, null);
	assert.equal(git("--git-dir", gitDir(), "for-each-ref", trashRefPrefix(gitDir())), "");

	for (const name of ["uno.txt", "due.txt", "tre.txt", "quattro.txt"])
		await writeFile(join(root, name), "x\n");
	await assert.rejects(
		() => backend.discard(["uno.txt", "due.txt", "tre.txt", "quattro.txt"]),
		/limite di 3 file/
	);
	for (const name of ["uno.txt", "due.txt", "tre.txt", "quattro.txt"])
		assert.equal(await exists(join(root, name)), true);

	// con la copia spenta lo scarto passa, ma non è annullabile
	settings = trashSettings({ maxBytes: 1024, enabled: false });
	const discarded = await backend.discard(["grande.bin"]);
	assert.equal(await exists(big), false);
	assert.equal(discarded.undo, null);
	settings = trashSettings();
	await rm(join(root, "uno.txt"));
	await rm(join(root, "due.txt"));
	await rm(join(root, "tre.txt"));
	await rm(join(root, "quattro.txt"));
});

test("la quota elimina le copie più vecchie, mai quella appena creata", async () => {
	settings = trashSettings({ quotaBytes: 150 });
	await writeFile(join(root, "vecchio.txt"), "a".repeat(100));
	await writeFile(join(root, "nuovo.txt"), "b".repeat(100));

	const first = await backend.discard(["vecchio.txt"]);
	const firstId = first.undo!.trash!;
	assert.equal(refExists(gitDir(), firstId), true);

	const second = await backend.discard(["nuovo.txt"]);
	const secondId = second.undo!.trash!;
	assert.notEqual(firstId, secondId);
	assert.equal(refExists(gitDir(), firstId), false);
	assert.equal(refExists(gitDir(), secondId), true);

	const usage = await backend.trashUsage();
	assert.deepEqual(usage, { bytes: 100, files: 1, entries: 1 });

	// una copia più grande della quota resta: la rete di sicurezza non si cancella da sola
	settings = trashSettings({ quotaBytes: 50 });
	await writeFile(join(root, "enorme.txt"), "c".repeat(120));
	const third = await backend.discard(["enorme.txt"]);
	assert.ok(third.undo?.trash);
	assert.equal(refExists(gitDir(), third.undo!.trash!), true);
	assert.equal(refExists(gitDir(), secondId), false);

	await backend.undo();
	assert.equal(await readFile(join(root, "enorme.txt"), "utf8"), "c".repeat(120));
	assert.equal((await backend.trashUsage()).entries, 0);
	settings = trashSettings();
});

test("commits e snapshot del trash non entrano nella storia", async () => {
	await writeFile(join(root, "storia.txt"), "x\n");
	const before = await backend.refresh();
	await backend.discard(["storia.txt"]);
	const after = await backend.refresh();
	assert.equal(after.commits.length, before.commits.length);
	assert.ok(
		after.commits.every((commit) => !commit.subject.includes("discarded")),
		"il commit della copia non deve comparire nel log"
	);
	await backend.undo();
});

test("in un worktree collegato il trash ha un namespace proprio", async () => {
	const base = await mkdtemp(join(tmpdir(), "gitlattice-trash-wt-"));
	extraRoots.push(base);
	const mainRepo = join(base, "main");
	execFileSync("git", ["init", "-b", "main", mainRepo]);
	execFileSync("git", ["config", "user.name", "Test"], { cwd: mainRepo });
	execFileSync("git", ["config", "user.email", "t@example.com"], {
		cwd: mainRepo,
	});
	await writeFile(join(mainRepo, "a.txt"), "a\n");
	execFileSync("git", ["add", "a.txt"], { cwd: mainRepo });
	execFileSync("git", ["commit", "-m", "base"], { cwd: mainRepo });
	execFileSync("git", ["worktree", "add", "-q", "../wt", "-b", "side"], {
		cwd: mainRepo,
	});

	const wt = join(base, "wt");
	const local = new CliGitBackend({ settings: async () => trashSettings() });
	await local.open(wt);
	// un ref di un altro scope non deve essere toccato dalla potatura di questo worktree
	execFileSync(
		"git",
		["update-ref", "refs/gitlattice/trash/main/finto", "HEAD"],
		{ cwd: mainRepo }
	);

	await writeFile(join(wt, "nuovo.txt"), "ramo laterale\n");
	const discarded = await local.discard(["nuovo.txt"]);
	const id = discarded.undo!.trash!;
	const wtGitDir = execFileSync("git", ["rev-parse", "--absolute-git-dir"], {
		cwd: wt,
		encoding: "utf8",
	}).trim();
	assert.match(
		trashRef(wtGitDir, id),
		/^refs\/gitlattice\/trash\/wt-[0-9a-f]{8}\//
	);

	// gli oggetti e i ref vivono nel database comune: il repository principale li vede
	const refs = execFileSync(
		"git",
		["for-each-ref", "--format=%(refname)", "refs/gitlattice/trash"],
		{ cwd: mainRepo, encoding: "utf8" }
	);
	assert.ok(refs.includes(id));
	assert.ok(refs.includes("refs/gitlattice/trash/main/finto"));

	await local.undo();
	assert.equal(await readFile(join(wt, "nuovo.txt"), "utf8"), "ramo laterale\n");
	assert.ok(
		execFileSync(
			"git",
			["for-each-ref", "--format=%(refname)", "refs/gitlattice/trash"],
			{ cwd: mainRepo, encoding: "utf8" }
		).includes("refs/gitlattice/trash/main/finto")
	);
});

test("un file ricreato non viene sovrascritto dall'annullamento", async () => {
	await writeFile(join(root, "dup.txt"), "originale\n");
	const discarded = await backend.discard(["dup.txt"]);
	await writeFile(join(root, "dup.txt"), "scritto dopo\n");

	await assert.rejects(() => backend.undo(), /esiste già/);
	assert.equal(await readFile(join(root, "dup.txt"), "utf8"), "scritto dopo\n");
	// la copia è ancora lì: togliendo il file nuovo il ripristino riesce
	assert.equal(refExists(gitDir(), discarded.undo!.trash!), true);

	await rm(join(root, "dup.txt"));
	const restored = await backend.undo();
	assert.equal(restored.undo, null);
	assert.equal(await readFile(join(root, "dup.txt"), "utf8"), "originale\n");
});

test("le copie della v0.4 restano ripristinabili", async () => {
	const gitDirPath = gitDir();
	const legacy = join(gitDirPath, "gitlattice", "trash", "1-legacy");
	await mkdir(legacy, { recursive: true });
	await writeFile(join(legacy, "vecchio.txt"), "dalla v0.4\n");
	await writeFile(
		join(gitDirPath, "gitlattice", "undo.json"),
		`${JSON.stringify(
			[
				{
					id: "1-legacy",
					kind: "discard",
					at: Date.now(),
					head: null,
					branch: "main",
					label: "Scarta vecchio.txt",
					untrackedPaths: ["vecchio.txt"],
					trash: "1-legacy",
					stash: null,
				},
			],
			null,
			"\t"
		)}\n`
	);

	assert.equal((await backend.refresh()).undo?.trash, "1-legacy");
	await backend.undo();
	assert.equal(await readFile(join(root, "vecchio.txt"), "utf8"), "dalla v0.4\n");
	assert.equal(await exists(legacy), false);
	await rm(join(root, "vecchio.txt"));
});

test("senza commit la copia basta: lo scarto resta annullabile", async () => {
	const dir = await mkdtemp(join(tmpdir(), "gitlattice-trash-nohead-"));
	extraRoots.push(dir);
	execFileSync("git", ["init", "-b", "main"], { cwd: dir });
	const local = new CliGitBackend({ settings: async () => trashSettings() });
	await local.open(dir);
	await writeFile(join(dir, "solo.txt"), "senza HEAD\n");

	const discarded = await local.discard(["solo.txt"]);
	assert.ok(discarded.undo?.trash);
	assert.equal(await exists(join(dir, "solo.txt")), false);

	const restored = await local.undo();
	assert.equal(restored.undo, null);
	assert.equal(await readFile(join(dir, "solo.txt"), "utf8"), "senza HEAD\n");
});
