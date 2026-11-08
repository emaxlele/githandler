import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";

import { parseBlame, UNCOMMITTED_SHA } from "../src/core/blame.ts";
import { CliGitBackend } from "../src/main/backend.ts";

const root = await mkdtemp(join(tmpdir(), "lanecraft-blame-"));

function git(...args: string[]): string {
	return execFileSync("git", args, { cwd: root, encoding: "utf8" });
}

git("init", "-b", "main");
git("config", "user.name", "Test");
git("config", "user.email", "test@example.com");

await writeFile(join(root, "file con spazio.txt"), "prima riga\nseconda riga\n");
git("add", ".");
git("commit", "-m", "prima versione");

await writeFile(join(root, "file con spazio.txt"), "prima riga\nseconda riga\n");
const firstSha = git("rev-parse", "HEAD").trim();

await writeFile(
	join(root, "file con spazio.txt"),
	"prima riga\nseconda riga MODIFICATA\nterza riga\n",
);
git(
	"-c",
	"user.name=Anna",
	"-c",
	"user.email=anna@example.com",
	"commit",
	"-am",
	"seconda versione",
);

const backend = new CliGitBackend();
await backend.open(root);

after(async () => {
	await rm(root, { recursive: true, force: true });
});

test("il parser legge commit, autore e contenuto di ogni riga", async () => {
	const blamed = await backend.blame("file con spazio.txt");
	assert.equal(blamed.path, "file con spazio.txt");
	assert.equal(blamed.lines.length, 3);

	const [first, second, third] = blamed.lines;
	assert.equal(first!.line, 1);
	assert.equal(first!.commit, firstSha);
	assert.equal(first!.author, "Test");
	assert.equal(first!.email, "test@example.com");
	assert.equal(first!.text, "prima riga");
	assert.ok(first!.timestamp > 0);

	assert.equal(second!.line, 2);
	assert.equal(second!.author, "Anna");
	assert.equal(second!.summary, "seconda versione");
	assert.equal(third!.text, "terza riga");
});

test("il range limita le righe chieste", async () => {
	const blamed = await backend.blame("file con spazio.txt", 2, 2);
	assert.equal(blamed.lines.length, 1);
	assert.equal(blamed.lines[0]!.line, 2);
	assert.equal(blamed.lines[0]!.text, "seconda riga MODIFICATA");
});

test("le righe non committate hanno lo SHA nullo", async () => {
	await writeFile(
		join(root, "file con spazio.txt"),
		"prima riga\nseconda riga MODIFICATA\nterza riga\nquarta non committata\n",
	);
	const blamed = await backend.blame("file con spazio.txt");
	const last = blamed.lines.at(-1);
	assert.ok(last);
	assert.equal(last!.commit, UNCOMMITTED_SHA);
	assert.equal(last!.text, "quarta non committata");
});

test("un output vuoto non produce righe", () => {
	assert.deepEqual(parseBlame("", "x.txt").lines, []);
});
