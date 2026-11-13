import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";
import { promisify } from "node:util";

import { parseWorktrees } from "../src/core/worktrees.ts";
import { CliGitBackend } from "../src/main/backend.ts";

const run = promisify(execFile);
const base = await mkdtemp(join(tmpdir(), "githandler-worktrees-"));

function git(cwd: string, ...args: string[]): Promise<{ stdout: string }> {
	return run("git", args, {
		cwd,
		env: { ...process.env, LC_ALL: "C" },
	}) as Promise<{ stdout: string }>;
}

after(async () => {
	await rm(base, { recursive: true, force: true });
});

test("il formato porcelain diventa worktree leggibili", () => {
	const parsed = parseWorktrees(
		[
			"worktree /repo",
			"HEAD aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
			"branch refs/heads/main",
			"",
			"worktree /repo-feature",
			"HEAD bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
			"detached",
			"locked in uso",
			"",
			"worktree /repo-vecchio",
			"HEAD cccccccccccccccccccccccccccccccccccccccc",
			"branch refs/heads/vecchio",
			"prunable gitdir file points to non-existent location",
			"",
		].join("\n")
	);
	assert.equal(parsed.length, 3);
	assert.deepEqual(parsed[0], {
		path: "/repo",
		head: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
		branch: "main",
		bare: false,
		detached: false,
		locked: false,
		prunable: false,
		main: true,
	});
	assert.equal(parsed[1]?.branch, null);
	assert.equal(parsed[1]?.detached, true);
	assert.equal(parsed[1]?.locked, true);
	assert.equal(parsed[2]?.branch, "vecchio");
	assert.equal(parsed[2]?.prunable, true);
	assert.equal(parsed[2]?.main, false);
	// un repository bare non ha rami né worktree secondari
	assert.deepEqual(parseWorktrees(""), []);
});

test("il backend crea, elenca e rimuove un worktree", async () => {
	const repo = join(base, "repo");
	await git(base, "init", "-q", "-b", "main", repo);
	await git(repo, "config", "user.name", "Test");
	await git(repo, "config", "user.email", "test@example.com");
	await writeFile(join(repo, "a.txt"), "contenuto\n");
	await git(repo, "add", ".");
	await git(repo, "commit", "-qm", "primo");

	const path = join(base, "repo-feature");
	const backend = new CliGitBackend();
	await backend.open(repo);

	const created = await backend.createWorktree(path, "feature");
	assert.equal(created.length, 2);
	assert.equal(created[0]?.main, true);
	// il separatore di Windows non deve impedire il confronto
	const same = (value: string): boolean =>
		value.replace(/\\/g, "/").toLowerCase() === path.replace(/\\/g, "/").toLowerCase();
	const feature = created.find((entry) => same(entry.path));
	assert.equal(feature?.branch, "feature");
	assert.equal(feature?.main, false);

	// un secondo ramo nuovo: `-b` viene usato di nuovo
	const second = await backend.createWorktree(join(base, "repo-altra"), "altra");
	assert.equal(second.length, 3);

	await assert.rejects(
		() => backend.removeWorktree(repo),
		/principale/
	);

	const removed = await backend.removeWorktree(path);
	assert.equal(removed.length, 2);
	assert.equal(
		removed.some((entry) => entry.path === path),
		false
	);
});
