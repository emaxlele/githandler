import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";
import { promisify } from "node:util";

import { summarizeRemoteCheck } from "../src/core/remotes.ts";
import { CliGitBackend } from "../src/main/backend.ts";

const run = promisify(execFile);
const base = await mkdtemp(join(tmpdir(), "githandler-remotes-"));

function git(cwd: string, ...args: string[]): Promise<{ stdout: string }> {
	return run("git", args, {
		cwd,
		env: { ...process.env, LC_ALL: "C", GIT_TERMINAL_PROMPT: "0" },
	}) as Promise<{ stdout: string }>;
}

after(async () => {
	await rm(base, { recursive: true, force: true });
});

test("l'esito grezzo diventa una riga leggibile", () => {
	assert.deepEqual(
		summarizeRemoteCheck(
			"origin",
			"https://example.com/r.git",
			0,
			"a\trefs/heads/main\nb\trefs/heads/dev\n",
			""
		),
		{
			name: "origin",
			url: "https://example.com/r.git",
			reachable: true,
			heads: 2,
			error: null,
		}
	);
	assert.deepEqual(
		summarizeRemoteCheck(
			"upstream",
			"/missing",
			128,
			"",
			"fatal: '/missing' does not appear to be a git repository\naltro\n"
		),
		{
			name: "upstream",
			url: "/missing",
			reachable: false,
			heads: 0,
			error: "fatal: '/missing' does not appear to be a git repository",
		}
	);
	// un repository vuoto è raggiungibile anche senza rami
	assert.equal(
		summarizeRemoteCheck("origin", "u", 0, "", "").reachable,
		true
	);
});

test("il backend distingue un remoto raggiungibile da uno sparito", async () => {
	const repo = join(base, "repo");
	const remote = join(base, "remote.git");
	await git(base, "init", "-q", "-b", "main", repo);
	await git(repo, "config", "user.name", "Test");
	await git(repo, "config", "user.email", "test@example.com");
	await writeFile(join(repo, "a.txt"), "contenuto\n");
	await git(repo, "add", ".");
	await git(repo, "commit", "-qm", "primo");
	await git(base, "init", "-q", "--bare", remote);
	await git(repo, "remote", "add", "origin", remote);
	await git(repo, "push", "-q", "-u", "origin", "main");
	await git(repo, "remote", "add", "sparito", join(base, "non-esiste.git"));

	const backend = new CliGitBackend();
	await backend.open(repo);

	const checks = await backend.remoteChecks();
	assert.equal(checks.length, 2);
	const origin = checks.find((check) => check.name === "origin");
	assert.equal(origin?.reachable, true);
	assert.equal(origin?.heads, 1);
	assert.equal(origin?.error, null);

	const missing = checks.find((check) => check.name === "sparito");
	assert.equal(missing?.reachable, false);
	assert.match(missing?.error ?? "", /repository|does not appear/i);
});
