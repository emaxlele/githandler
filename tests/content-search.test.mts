import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";
import { promisify } from "node:util";

import {
	contentSearchArgs,
	parseContentMatches,
	type ContentMatch,
} from "../src/core/content.ts";
import { CliGitBackend } from "../src/main/backend.ts";

const run = promisify(execFile);
const root = await mkdtemp(join(tmpdir(), "githandler-grep-"));

function git(...args: string[]): Promise<{ stdout: string }> {
	return run("git", args, {
		cwd: root,
		env: { ...process.env, LC_ALL: "C" },
	}) as Promise<{ stdout: string }>;
}

after(async () => {
	await rm(root, { recursive: true, force: true });
});

test("il testo è letterale salvo regex, con \\0 e senza opzioni ambigue", () => {
	assert.deepEqual(
		contentSearchArgs({
			text: "  ciao mondo  ",
			regex: false,
			caseSensitive: false,
		}),
		["grep", "-n", "-I", "-z", "-F", "-i", "-e", "ciao mondo", "--"]
	);
	assert.deepEqual(
		contentSearchArgs({
			text: "-rf",
			regex: true,
			caseSensitive: true,
		}),
		["grep", "-n", "-I", "-z", "-E", "-e", "-rf", "--"]
	);
	assert.throws(
		() => contentSearchArgs({ text: " ", regex: false, caseSensitive: false }),
		/testo/
	);
	assert.throws(
		() =>
			contentSearchArgs({
				text: "a\u0000b",
				regex: false,
				caseSensitive: false,
			}),
		/NUL/
	);
});

test("l'output -z non si confonde con i due punti nel percorso", () => {
	const result = parseContentMatches(
		[
			"src/a:b.ts\u00003\u0000const a: b = 1;",
			"b.txt\u000010\u0000seconda riga",
			"malformato",
			"",
		].join("\n")
	);
	assert.deepEqual(result, {
		matches: [
			{ path: "src/a:b.ts", line: 3, text: "const a: b = 1;" },
			{ path: "b.txt", line: 10, text: "seconda riga" },
		],
		truncated: false,
	});
});

test("il limite taglia l'elenco e dice che ce n'erano altri", () => {
	const lines: string[] = [];
	for (let index = 1; index <= 4; index++) {
		lines.push(`f.txt\u0000${index}\u0000testo`);
	}
	const limited = parseContentMatches(lines.join("\n"), 2);
	assert.equal(limited.matches.length, 2);
	assert.equal(limited.truncated, true);
	assert.deepEqual(
		limited.matches.map((match: ContentMatch) => match.line),
		[1, 2]
	);
});

test("git grep reale trova i file, ignora le maiuscole e rispetta il flag", async () => {
	await git("init", "-b", "main");
	await git("config", "user.name", "Test");
	await git("config", "user.email", "test@example.com");
	await writeFile(join(root, "a.txt"), "Prima riga\nCiao Mondo\nultima\n");
	await writeFile(join(root, "b.txt"), "niente da vedere\n");
	await git("add", ".");
	await git("commit", "-qm", "primo");

	const backend = new CliGitBackend();
	await backend.open(root);

	const found = await backend.searchContent({
		text: "ciao mondo",
		regex: false,
		caseSensitive: false,
	});
	assert.deepEqual(found.matches, [
		{ path: "a.txt", line: 2, text: "Ciao Mondo" },
	]);

	const exact = await backend.searchContent({
		text: "ciao mondo",
		regex: false,
		caseSensitive: true,
	});
	assert.deepEqual(exact.matches, []);

	const regex = await backend.searchContent({
		text: "^ultima$",
		regex: true,
		caseSensitive: false,
	});
	assert.deepEqual(regex.matches, [
		{ path: "a.txt", line: 3, text: "ultima" },
	]);
});
