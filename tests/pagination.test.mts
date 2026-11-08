import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";

import { logArgs } from "../src/core/log.ts";
import { CliGitBackend } from "../src/main/backend.ts";

const root = await mkdtemp(join(tmpdir(), "githandler-pages-"));

function git(...args: string[]): string {
	return execFileSync("git", args, { cwd: root, encoding: "utf8" });
}

git("init", "-b", "main");
git("config", "user.name", "Test");
git("config", "user.email", "test@example.com");

const TOTAL = 25;
for (let i = 0; i < TOTAL; i++) {
	await writeFile(join(root, "file.txt"), `riga ${i}\n`);
	git("add", "file.txt");
	git("commit", "-m", `commit ${i}`);
}

const backend = new CliGitBackend();
await backend.open(root);

after(async () => {
	await rm(root, { recursive: true, force: true });
});

test("logArgs traduce skip in --skip", () => {
	const args = logArgs({ limit: 10, skip: 20 });
	assert.ok(args.includes("-n10"));
	assert.ok(args.includes("--skip=20"));
	const all = args.indexOf("--all");
	assert.ok(all > 0);
	// l'esclusione deve precedere `--all`, altrimenti i nostri ref rientrerebbero nel log
	assert.equal(args[all - 1], "--exclude=refs/githandler/*");
	assert.ok(!logArgs({ skip: 0 }).some((arg) => arg.startsWith("--skip")));
	assert.deepEqual(logArgs({ all: false }).slice(0, 3), [
		"log",
		"--date-order",
		"-n5000",
	]);
	assert.ok(!logArgs({ all: false }).includes("--all"));
});

test("le pagine si susseguono senza buchi né duplicati", async () => {
	const first = await backend.historyPage(0, 10);
	assert.equal(first.commits.length, 10);
	assert.equal(first.hasMore, true);
	assert.equal(first.commits[0]!.subject, `commit ${TOTAL - 1}`);

	const second = await backend.historyPage(10, 10);
	assert.equal(second.commits.length, 10);
	assert.equal(second.hasMore, true);

	const third = await backend.historyPage(20, 10);
	assert.equal(third.commits.length, 5);
	assert.equal(third.hasMore, false);
	assert.equal(third.commits.at(-1)!.subject, "commit 0");

	const shas = new Set(
		[...first.commits, ...second.commits, ...third.commits].map(
			(commit) => commit.sha,
		),
	);
	assert.equal(shas.size, TOTAL);

	const empty = await backend.historyPage(TOTAL, 10);
	assert.deepEqual(empty, { commits: [], hasMore: false });
});

test("la prima pagina arriva dal refresh e dichiara se ce ne sono altre", async () => {
	const snapshot = await backend.refresh();
	assert.equal(snapshot.commits.length, TOTAL);
	assert.equal(snapshot.hasMore, false);
});

test("skip e limit non validi vengono rifiutati", async () => {
	await assert.rejects(() => backend.historyPage(-1), /non valida/);
	await assert.rejects(() => backend.historyPage(0, 0), /non valida/);
	await assert.rejects(() => backend.historyPage(0, 10_000), /non valida/);
});
