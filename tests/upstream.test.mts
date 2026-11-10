import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";
import { promisify } from "node:util";

import { CliGitBackend } from "../src/main/backend.ts";

/**
 * Allineamento del ramo attuale al suo upstream, con un remoto vero: i casi che contano sono
 * tre, e ognuno deve lasciare il repository in uno stato dichiarato prima di chiamare Git.
 */

const run = promisify(execFile);
const base = await mkdtemp(join(tmpdir(), "githandler-upstream-"));

function git(cwd: string, ...args: string[]): Promise<{ stdout: string }> {
	return run("git", args, {
		cwd,
		env: { ...process.env, LC_ALL: "C", GIT_TERMINAL_PROMPT: "0" },
	}) as Promise<{ stdout: string }>;
}

after(async () => {
	await rm(base, { recursive: true, force: true });
});

const remote = join(base, "remote.git");
const work = join(base, "work");
const other = join(base, "other");

await git(base, "init", "-q", "-b", "main", work);
await git(work, "config", "user.name", "Test");
await git(work, "config", "user.email", "test@example.com");
await writeFile(join(work, "a.txt"), "primo\n");
await git(work, "add", ".");
await git(work, "commit", "-qm", "primo");

await git(base, "init", "-q", "--bare", remote);
await git(work, "remote", "add", "origin", remote);
await git(work, "push", "-q", "-u", "origin", "main");

await git(base, "clone", "-q", remote, other);
await git(other, "config", "user.name", "Altro");
await git(other, "config", "user.email", "altro@example.com");

const backend = new CliGitBackend();
await backend.open(work);

test("già allineato: non si muove niente", async () => {
	const outcome = await backend.alignToUpstream();
	assert.equal(outcome.status, "up-to-date");
	assert.equal(outcome.upstream, "origin/main");
	assert.equal(outcome.ahead, 0);
	assert.equal(outcome.behind, 0);
	assert.equal(outcome.snapshot, null);
});

test("fast-forward: il ramo raggiunge l'ultimo commit del remoto", async () => {
	await writeFile(join(other, "a.txt"), "secondo\n");
	await git(other, "commit", "-qam", "secondo");
	await git(other, "push", "-q", "origin", "main");

	const outcome = await backend.alignToUpstream();
	assert.equal(outcome.status, "fast-forward");
	assert.equal(outcome.behind, 1);
	assert.equal(outcome.ahead, 0);
	assert.equal(
		await readFile(join(work, "a.txt"), "utf8"),
		"secondo\n"
	);
	assert.ok(outcome.snapshot);
	assert.equal(outcome.snapshot.info.branch, "main");
});

test("divergente: non tocca niente e lo dichiara", async () => {
	await writeFile(join(work, "locale.txt"), "mio\n");
	await git(work, "add", "locale.txt");
	await git(work, "commit", "-qm", "locale");

	await writeFile(join(other, "b.txt"), "remoto\n");
	await git(other, "add", "b.txt");
	await git(other, "commit", "-qm", "remoto");
	await git(other, "push", "-q", "origin", "main");

	const before = (await git(work, "rev-parse", "HEAD")).stdout.trim();
	const outcome = await backend.alignToUpstream();
	assert.equal(outcome.status, "diverged");
	assert.equal(outcome.ahead, 1);
	assert.equal(outcome.behind, 1);
	assert.equal(outcome.snapshot, null);
	// il ramo non si è mosso e il commit remoto non è entrato nel working tree
	assert.equal((await git(work, "rev-parse", "HEAD")).stdout.trim(), before);
	await assert.rejects(() => readFile(join(work, "b.txt"), "utf8"));

	// il rebase, che il renderer chiede dopo la conferma, porta i commit locali sopra l'upstream
	const rebased = await backend.rebase(outcome.upstream);
	const current = rebased.refs.find(
		(ref) => ref.kind === "local" && ref.short === "main"
	);
	// il commit locale esiste ancora, ma ora sopra il remoto: niente più da scaricare
	assert.equal(current?.behind, 0);
	assert.equal(current?.ahead, 1);
	assert.equal(await readFile(join(work, "b.txt"), "utf8"), "remoto\n");
	assert.equal(await readFile(join(work, "locale.txt"), "utf8"), "mio\n");
});

test("senza upstream il ramo si ferma prima di chiamare git", async () => {
	await git(work, "switch", "-q", "-c", "senza-tracking");
	await assert.rejects(
		() => backend.alignToUpstream(),
		/non ha un upstream/
	);
});
