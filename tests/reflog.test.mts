import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";

import { parseReflog, reflogArgs } from "../src/core/reflog.ts";
import { CliGitBackend } from "../src/main/backend.ts";

/**
 * Il reflog è la storia di HEAD: si prova il parser su righe finte (indice ricavato dall'ordine,
 * selettore e data) e poi lo stesso backend della UI su un repository vero, con un reset che
 * sposta HEAD all'indietro.
 */

const root = await mkdtemp(join(tmpdir(), "githandler-reflog-"));

function git(...args: string[]): string {
	return execFileSync("git", args, { cwd: root, encoding: "utf8" });
}

const empty = await mkdtemp(join(tmpdir(), "githandler-reflog-empty-"));
execFileSync("git", ["init", "-b", "main"], { cwd: empty });

const A = "a".repeat(40);
const B = "b".repeat(40);

after(async () => {
	await rm(root, { recursive: true, force: true });
	await rm(empty, { recursive: true, force: true });
});

test("gli argomenti chiedono il reflog di HEAD con un limite", () => {
	const args = reflogArgs(30);
	assert.equal(args[0], "reflog");
	assert.equal(args[1], "show");
	assert.ok(args.includes("-n30"));
	assert.ok(args.includes("--date=iso-strict"));
	// un limite assurdo resta dentro un intervallo sensato
	assert.ok(reflogArgs(0).includes("-n1"));
	assert.ok(reflogArgs(10_000).includes("-n1000"));
});

test("il parser ricava indice, selettore e data", () => {
	const stdout = [
		`${B}\x1fb\x1fHEAD@{2026-11-09T10:30:00+01:00}\x1fcommit: secondo`,
		`${A}\x1fa\x1fHEAD@{2026-11-09T10:00:00+01:00}\x1fcommit (initial): primo`,
		"",
	].join("\n");

	assert.deepEqual(parseReflog(stdout), [
		{
			sha: B,
			short: "b",
			index: 0,
			selector: "HEAD@{0}",
			action: "commit: secondo",
			date: "2026-11-09T10:30:00+01:00",
		},
		{
			sha: A,
			short: "a",
			index: 1,
			selector: "HEAD@{1}",
			action: "commit (initial): primo",
			date: "2026-11-09T10:00:00+01:00",
		},
	]);
});

test("una riga rotta si scarta, una coda vuota resta vuota", () => {
	assert.deepEqual(parseReflog(""), []);
	assert.deepEqual(parseReflog("non abbastanza campi"), []);
	const mixed = [
		`${A}\x1fa\x1fHEAD@{2026-11-09T10:00:00+01:00}\x1fcommit: primo`,
		"zzz\x1fz\x1fHEAD@{2026-11-09T11:00:00+01:00}\x1fcommit: rotto",
	].join("\n");
	assert.equal(parseReflog(mixed).length, 1);
	// un selettore senza data resta leggibile, ma la data è vuota
	const plain = parseReflog(`${A}\x1fa\x1fHEAD@{3}\x1fcommit: primo`);
	assert.equal(plain[0]!.date, "");
	assert.equal(plain[0]!.selector, "HEAD@{0}");
});

test("il backend legge il reflog vero, dal più recente", async () => {
	git("init", "-b", "main");
	git("config", "user.name", "Test");
	git("config", "user.email", "test@example.com");
	await writeFile(join(root, "a.txt"), "uno\n");
	git("add", "a.txt");
	git("commit", "-m", "primo commit");
	await writeFile(join(root, "a.txt"), "due\n");
	git("commit", "-am", "secondo commit");
	git("reset", "--hard", "HEAD~1");

	const backend = new CliGitBackend();
	await backend.open(root);
	const entries = await backend.reflog(10);

	assert.equal(entries.length, 3);
	assert.equal(entries[0]!.action, "reset: moving to HEAD~1");
	assert.equal(entries[0]!.selector, "HEAD@{0}");
	assert.equal(entries[1]!.action, "commit: secondo commit");
	assert.match(entries[0]!.date, /^\d{4}-\d{2}-\d{2}T/);
	// tutte le voci sono SHA completi
	for (const entry of entries) assert.match(entry.sha, /^[0-9a-f]{40,64}$/);
	// il limite si rispetta
	assert.equal((await backend.reflog(1)).length, 1);
});

test("un repository senza commit ha un reflog vuoto, non un errore", async () => {
	const backend = new CliGitBackend();
	await backend.open(empty);
	assert.deepEqual(await backend.reflog(), []);
});
