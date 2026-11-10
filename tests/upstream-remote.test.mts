import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";
import { promisify } from "node:util";

import {
	removeUpstream,
	setUpstream,
	upstreamRemotes,
} from "../src/main/fork.ts";

const run = promisify(execFile);
const base = await mkdtemp(join(tmpdir(), "githandler-upstream-"));

function git(cwd: string, ...args: string[]): Promise<{ stdout: string }> {
	return run("git", args, {
		cwd,
		env: { ...process.env, LC_ALL: "C", GIT_TERMINAL_PROMPT: "0" },
	}) as Promise<{ stdout: string }>;
}

async function makeRepo(name: string): Promise<string> {
	const repo = join(base, name);
	await git(base, "init", "-q", "-b", "main", repo);
	await git(repo, "config", "user.name", "Test");
	await git(repo, "config", "user.email", "test@example.com");
	await writeFile(join(repo, "a.txt"), "contenuto\n");
	await git(repo, "add", ".");
	await git(repo, "commit", "-qm", "primo");
	return repo;
}

after(async () => {
	await rm(base, { recursive: true, force: true });
});

test("il remoto upstream si crea, si cambia e si toglie", async () => {
	const repo = await makeRepo("fork");
	assert.deepEqual(await upstreamRemotes(repo), { url: null, remotes: [] });

	const created = await setUpstream(
		repo,
		"git@github.com:original/progetto.git"
	);
	assert.equal(created.url, "git@github.com:original/progetto.git");
	assert.deepEqual(created.remotes, [
		{ name: "upstream", url: "git@github.com:original/progetto.git" },
	]);

	// cambiare indirizzo aggiorna il remoto esistente, non ne aggiunge un secondo
	const changed = await setUpstream(
		repo,
		"https://github.com/original/progetto.git"
	);
	assert.equal(changed.url, "https://github.com/original/progetto.git");
	assert.equal(changed.remotes.length, 1);

	const removed = await removeUpstream(repo);
	assert.deepEqual(removed, { url: null, remotes: [] });
	await assert.rejects(removeUpstream(repo), /Nessun remoto «upstream»/);
});

test("un indirizzo che sembra un'opzione non arriva a git", async () => {
	const repo = await makeRepo("opzioni");
	await assert.rejects(
		setUpstream(repo, "--upload-pack=touch /tmp/non-deve-esistere"),
		/cominciare con «-»/
	);
	assert.deepEqual(await upstreamRemotes(repo), { url: null, remotes: [] });
});

test("gli altri remoti restano com'erano", async () => {
	const repo = await makeRepo("altri");
	const origin = join(base, "origin.git");
	await git(base, "init", "-q", "--bare", origin);
	await git(repo, "remote", "add", "origin", origin);

	const withUpstream = await setUpstream(
		repo,
		"https://github.com/original/progetto.git"
	);
	assert.deepEqual(withUpstream.remotes, [
		{ name: "origin", url: origin },
		{ name: "upstream", url: "https://github.com/original/progetto.git" },
	]);

	const removed = await removeUpstream(repo);
	assert.deepEqual(removed.remotes, [{ name: "origin", url: origin }]);
});
