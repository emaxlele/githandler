import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";
import { promisify } from "node:util";

import {
	COMMIT_TEMPLATE_LIMIT,
	commitArgs,
	limitCommitTemplate,
	resolveCommitTemplatePath,
} from "../src/core/commit.ts";
import { CliGitBackend } from "../src/main/backend.ts";

const run = promisify(execFile);
const root = await mkdtemp(join(tmpdir(), "githandler-template-"));

function git(...args: string[]): Promise<{ stdout: string }> {
	return run("git", args, {
		cwd: root,
		env: { ...process.env, LC_ALL: "C" },
	}) as Promise<{ stdout: string }>;
}

after(async () => {
	await rm(root, { recursive: true, force: true });
});

test("il percorso del modello segue la configurazione, non la fantasia", () => {
	assert.equal(resolveCommitTemplatePath("/repo", "  ", "/home/x"), null);
	assert.equal(
		resolveCommitTemplatePath("/repo", "docs/msg", "/home/x"),
		"/repo/docs/msg"
	);
	assert.equal(
		resolveCommitTemplatePath("/repo/", "./msg", "/home/x"),
		"/repo/msg"
	);
	assert.equal(
		resolveCommitTemplatePath("/repo", "~/tpl", "/home/x"),
		"/home/x/tpl"
	);
	assert.equal(resolveCommitTemplatePath("/repo", "~", "/home/x"), "/home/x");
	assert.equal(
		resolveCommitTemplatePath("/repo", "/tmp/tpl", "/home/x"),
		"/tmp/tpl"
	);
	assert.throws(
		() => resolveCommitTemplatePath("/repo", "~bob/tpl", "/home/x"),
		/altro utente/
	);
	assert.throws(
		() => resolveCommitTemplatePath("/repo", "a\u0000b", "/home/x"),
		/NUL/
	);
});

test("un modello enorme si taglia e gli a capo diventano \\n", () => {
	const small = limitCommitTemplate("riga uno\r\nriga due\r\n");
	assert.deepEqual(small, {
		text: "riga uno\nriga due\n",
		truncated: false,
	});
	const huge = limitCommitTemplate("x".repeat(COMMIT_TEMPLATE_LIMIT + 10));
	assert.equal(huge.truncated, true);
	assert.equal(huge.text.length, COMMIT_TEMPLATE_LIMIT);
});

test("il backend legge commit.template e sopporta un file mancante", async () => {
	await git("init", "-q", "-b", "main");
	await git("config", "user.name", "Test");
	await git("config", "user.email", "test@example.com");
	await writeFile(join(root, "a.txt"), "contenuto\n");
	await git("add", ".");
	await git("commit", "-qm", "primo");

	const backend = new CliGitBackend();
	await backend.open(root);

	// nessun modello configurato: il campo resta vuoto, non è un errore
	assert.deepEqual(await backend.commitTemplate(), {
		text: "",
		truncated: false,
	});

	await writeFile(join(root, ".gitmessage"), "# soggetto\n\n# corpo\n");
	await git("config", "commit.template", ".gitmessage");
	assert.deepEqual(await backend.commitTemplate(), {
		text: "# soggetto\n\n# corpo\n",
		truncated: false,
	});

	// un modello che non esiste non blocca la scrittura a mano
	await git("config", "commit.template", ".mancante");
	assert.deepEqual(await backend.commitTemplate(), {
		text: "",
		truncated: false,
	});
});

test("gli argomenti del commit: -a e -S solo quando servono", () => {
	assert.deepEqual(commitArgs(false, false), ["commit", "-F", "-"]);
	assert.deepEqual(commitArgs(true, false), ["commit", "-a", "-F", "-"]);
	assert.deepEqual(commitArgs(false, true), ["commit", "-S", "-F", "-"]);
	assert.deepEqual(commitArgs(true, true), ["commit", "-a", "-S", "-F", "-"]);
});
