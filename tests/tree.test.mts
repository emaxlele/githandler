import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";
import { promisify } from "node:util";

import { parseTreeEntries, sortTreeEntries } from "../src/core/tree.ts";
import { CliGitBackend } from "../src/main/backend.ts";

const run = promisify(execFile);
const base = await mkdtemp(join(tmpdir(), "githandler-tree-"));

function git(cwd: string, ...args: string[]): Promise<{ stdout: string }> {
	return run("git", args, {
		cwd,
		env: { ...process.env, LC_ALL: "C" },
	}) as Promise<{ stdout: string }>;
}

async function makeRepo(name: string): Promise<string> {
	const repo = join(base, name);
	await git(base, "init", "-q", "-b", "main", repo);
	await git(repo, "config", "user.name", "Test");
	await git(repo, "config", "user.email", "test@example.com");
	return repo;
}

after(async () => {
	await rm(base, { recursive: true, force: true });
});

test("ls-tree -z diventa un livello di albero, cartelle prima", () => {
	const output = [
		"100644 blob aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa\tREADME.md",
		"040000 tree bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb\tsrc",
		"100644 blob cccccccccccccccccccccccccccccccccccccccc\tsrc/greet.ts",
		"160000 commit dddddddddddddddddddddddddddddddddddddddd\tvendor/lib",
	].join("\u0000");

	const parsed = parseTreeEntries(`${output}\u0000`);
	assert.deepEqual(parsed, [
		{
			name: "README.md",
			path: "README.md",
			type: "blob",
			mode: "100644",
		},
		{ name: "src", path: "src", type: "tree", mode: "040000" },
		{
			name: "greet.ts",
			path: "src/greet.ts",
			type: "blob",
			mode: "100644",
		},
		{
			name: "lib",
			path: "vendor/lib",
			type: "commit",
			mode: "160000",
		},
	]);

	const sorted = sortTreeEntries(parsed);
	// le cartelle stanno davanti, poi tutto il resto
	assert.deepEqual(
		sorted.map((entry) => entry.type),
		["tree", "blob", "commit", "blob"]
	);
	assert.equal(sorted[0]?.name, "src");
	// un output vuoto o corrotto non deve esplodere
	assert.deepEqual(parseTreeEntries(""), []);
	assert.deepEqual(parseTreeEntries("riga senza tab\u0000"), []);
});

test("il backend legge una cartella alla volta", async () => {
	const repo = await makeRepo("repo");
	await writeFile(join(repo, "README.md"), "contenuto\n");
	await writeFile(join(repo, "primo.txt"), "testo\n");
	await git(repo, "add", ".");
	await git(repo, "commit", "-qm", "primo");

	const backend = new CliGitBackend();
	await backend.open(repo);

	const root = await backend.treeEntries(null, "");
	assert.deepEqual(
		root.map((entry) => [entry.name, entry.type]),
		[
			["primo.txt", "blob"],
			["README.md", "blob"],
		]
	);

	// la radice vuota e `HEAD` sono lo stesso albero; un percorso annidato si legge da solo
	const src = join(repo, "src");
	await mkdir(src, { recursive: true });
	await writeFile(join(src, "greet.ts"), "export const x = 1;\n");
	await git(repo, "add", ".");
	await git(repo, "commit", "-qm", "secondo");
	const head = await backend.treeEntries("HEAD", "");
	assert.deepEqual(
		head.map((entry) => entry.name),
		["src", "primo.txt", "README.md"]
	);
	const nested = await backend.treeEntries("HEAD", "src");
	assert.deepEqual(
		nested.map((entry) => [entry.path, entry.type]),
		[["src/greet.ts", "blob"]]
	);
	// la barra finale scritta a mano non raddoppia
	assert.deepEqual(
		(await backend.treeEntries("HEAD", "src/")).map((entry) => entry.name),
		["greet.ts"]
	);

	await assert.rejects(
		() => backend.treeEntries("HEAD", "../fuori"),
		/Percorso non valido/
	);
	await assert.rejects(
		() => backend.treeEntries("HEAD", "/etc"),
		/Percorso non valido/
	);
	await assert.rejects(
		() => backend.treeEntries("non-un-ref!", ""),
		/Riferimento non valido/
	);
});

test("un repository senza commit ha un albero vuoto, non un errore", async () => {
	const repo = await makeRepo("vuoto");
	const backend = new CliGitBackend();
	await backend.open(repo);
	assert.deepEqual(await backend.treeEntries(null, ""), []);
});
