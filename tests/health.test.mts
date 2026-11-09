import assert from "node:assert/strict";
import { test } from "node:test";

import {
	assessHealth,
	LARGE_HISTORY_COMMITS,
	LARGE_WORKTREE_FILES,
	STALE_STASH_DAYS,
} from "../src/core/health.ts";
import type { RefInfo, StashEntry, SubmoduleInfo } from "../src/core/types.ts";

const NOW = Date.parse("2026-11-09T12:00:00Z");
const DAY = 86_400_000;

function ref(
	short: string,
	kind: RefInfo["kind"],
	extra: Partial<RefInfo> = {}
): RefInfo {
	return {
		name: `refs/${kind === "local" ? "heads" : kind}/${short}`,
		short,
		kind,
		sha: "a".repeat(40),
		upstream: kind === "local" ? `origin/${short}` : null,
		ahead: 0,
		behind: 0,
		current: false,
		...extra,
	};
}

function stash(index: number, daysAgo: number): StashEntry {
	return {
		index,
		sha: String(index).repeat(40).slice(0, 40),
		message: `WIP on main: ${index}`,
		branch: "main",
		timestamp: Math.floor((NOW - daysAgo * DAY) / 1000),
	};
}

function submodule(
	path: string,
	state: SubmoduleInfo["state"]
): SubmoduleInfo {
	return { path, sha: "b".repeat(40), state, description: null };
}

test("un repository in ordine non ha niente da segnalare", () => {
	const report = assessHealth({
		refs: [
			ref("main", "local", { ahead: 2, behind: 0 }),
			ref("origin/main", "remote"),
		],
		stashes: [stash(0, 1)],
		submodules: [submodule("vendor/lib", "clean")],
		detached: false,
		now: NOW,
		scale: { commits: 120, files: 40 },
	});
	assert.deepEqual(report, {
		diverged: [],
		orphanBranches: [],
		staleStashes: [],
		dirtySubmodules: [],
		detached: false,
		scale: { commits: 120, files: 40 },
		outgrown: false,
		clean: true,
	});
});

test("divergenti e rami senza upstream si distinguono", () => {
	const report = assessHealth({
		refs: [
			ref("main", "local", { ahead: 1, behind: 3 }),
			ref("feature", "local", { ahead: 4, behind: 0 }),
			ref("solo-locale", "local", { upstream: null }),
			ref("origin/main", "remote", { ahead: 1, behind: 3 }),
			ref("v1.0", "tag"),
		],
		stashes: [],
		submodules: [],
		detached: false,
		now: NOW,
	});
	assert.deepEqual(report.diverged, [{ name: "main", ahead: 1, behind: 3 }]);
	assert.deepEqual(report.orphanBranches, ["solo-locale"]);
	assert.equal(report.clean, false);
});

test("solo gli stash oltre la soglia vengono ricordati, dal più vecchio", () => {
	const report = assessHealth({
		refs: [],
		stashes: [
			stash(0, STALE_STASH_DAYS - 1),
			stash(1, STALE_STASH_DAYS + 10),
			stash(2, STALE_STASH_DAYS + 2),
		],
		submodules: [],
		detached: false,
		now: NOW,
	});
	assert.deepEqual(
		report.staleStashes.map((entry) => entry.index),
		[1, 2]
	);
});

test("i submodule non puliti e HEAD staccato non passano inosservati", () => {
	const report = assessHealth({
		refs: [],
		stashes: [],
		submodules: [
			submodule("a", "clean"),
			submodule("b", "modified"),
			submodule("c", "uninitialized"),
			submodule("d", "conflict"),
		],
		detached: true,
		now: NOW,
	});
	assert.deepEqual(
		report.dirtySubmodules.map((module) => module.path),
		["b", "c", "d"]
	);
	assert.equal(report.detached, true);
	assert.equal(report.clean, false);
});

test("le dimensioni dicono quando il repository ha superato il layout misurato", () => {
	const base = {
		refs: [],
		stashes: [],
		submodules: [],
		detached: false,
		now: NOW,
	};

	// alla soglia esatta non c'è ancora niente da segnalare: il numero è misurato, non un limite
	const atLimit = assessHealth({
		...base,
		scale: { commits: LARGE_HISTORY_COMMITS, files: LARGE_WORKTREE_FILES },
	});
	assert.equal(atLimit.outgrown, false);
	assert.equal(atLimit.clean, true);
	assert.deepEqual(atLimit.scale, {
		commits: LARGE_HISTORY_COMMITS,
		files: LARGE_WORKTREE_FILES,
	});

	const history = assessHealth({
		...base,
		scale: { commits: LARGE_HISTORY_COMMITS + 1, files: 10 },
	});
	assert.equal(history.outgrown, true);
	assert.equal(history.clean, false);

	const worktree = assessHealth({
		...base,
		scale: { commits: 10, files: LARGE_WORKTREE_FILES + 1 },
	});
	assert.equal(worktree.outgrown, true);
	assert.equal(worktree.clean, false);

	// senza misura il pannello resta com'era
	const unknown = assessHealth(base);
	assert.deepEqual(unknown.scale, { commits: 0, files: 0 });
	assert.equal(unknown.outgrown, false);
	assert.equal(unknown.clean, true);
});

test("il backend guarda ref reali e non inventa problemi", async () => {
	const { execFile } = await import("node:child_process");
	const { mkdtemp, rm, writeFile } = await import("node:fs/promises");
	const { tmpdir } = await import("node:os");
	const { join } = await import("node:path");
	const { promisify } = await import("node:util");
	const { CliGitBackend } = await import("../src/main/backend.ts");
	const run = promisify(execFile);
	const base = await mkdtemp(join(tmpdir(), "githandler-health-"));
	const repo = join(base, "repo");
	const remote = join(base, "remote.git");
	const git = (cwd: string, ...args: string[]) =>
		run("git", args, {
			cwd,
			env: { ...process.env, LC_ALL: "C" },
		}) as Promise<{ stdout: string }>;

	try {
		await git(base, "init", "-q", "-b", "main", repo);
		await git(repo, "config", "user.name", "Test");
		await git(repo, "config", "user.email", "test@example.com");
		await writeFile(join(repo, "a.txt"), "contenuto\n");
		await git(repo, "add", ".");
		await git(repo, "commit", "-qm", "primo");
		await git(base, "init", "-q", "--bare", remote);
		await git(repo, "remote", "add", "origin", remote);
		await git(repo, "push", "-q", "-u", "origin", "main");
		await git(repo, "fetch", "-q", "origin");
		await git(repo, "branch", "solo-locale");

		const backend = new CliGitBackend();
		await backend.open(repo);

		const report = await backend.health();
		assert.deepEqual(report.orphanBranches, ["solo-locale"]);
		assert.deepEqual(report.diverged, []);
		assert.deepEqual(report.staleStashes, []);
		assert.deepEqual(report.dirtySubmodules, []);
		assert.equal(report.detached, false);
		assert.equal(report.clean, false);
		// le dimensioni si leggono davvero: un commit e un file tracciato
		assert.deepEqual(report.scale, { commits: 1, files: 1 });
	} finally {
		await rm(base, { recursive: true, force: true });
	}
});
