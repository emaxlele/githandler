import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";

import {
	formatHistoryQuery,
	historyArgs,
	parseHistoryQuery,
} from "../src/core/search.ts";
import { CliGitBackend } from "../src/main/backend.ts";

const root = await mkdtemp(join(tmpdir(), "gitcraft-search-"));

function git(...args: string[]): string {
	return execFileSync("git", args, { cwd: root, encoding: "utf8" });
}

git("init", "-b", "main");
git("config", "user.name", "Test");
git("config", "user.email", "test@example.com");

await writeFile(join(root, "a.txt"), "uno\n");
git("add", "a.txt");
git("commit", "-m", "primo commit");

await writeFile(join(root, "b.txt"), "due\n");
git("add", "b.txt");
git(
	"-c",
	"user.name=Anna",
	"-c",
	"user.email=anna@example.com",
	"commit",
	"-m",
	"secondo: correzione (urgente)",
);

await writeFile(join(root, "a.txt"), "uno modificato\n");
git("add", "a.txt");
git("commit", "-m", "terzo commit");

const backend = new CliGitBackend();
await backend.open(root);

after(async () => {
	await rm(root, { recursive: true, force: true });
});

test("la query riconosce autore, file e testo libero", () => {
	assert.deepEqual(parseHistoryQuery('fix author:"Mario Rossi" file:src/main.ts'), {
		text: "fix",
		author: "Mario Rossi",
		file: "src/main.ts",
	});
	assert.deepEqual(parseHistoryQuery("solo testo"), {
		text: "solo testo",
		author: null,
		file: null,
	});
	assert.deepEqual(parseHistoryQuery("author:  file:"), {
		text: null,
		author: null,
		file: null,
	});
});

test("formatHistoryQuery ricompone i valori con spazi", () => {
	const raw = formatHistoryQuery({
		text: "fix (urgente)",
		author: "Mario Rossi",
		file: "src/a b.ts",
	});
	const parsed = parseHistoryQuery(raw);
	assert.equal(parsed.text, "fix (urgente)");
	assert.equal(parsed.author, "Mario Rossi");
	assert.equal(parsed.file, "src/a b.ts");
});

test("historyArgs usa espressioni letterali e un limite", () => {
	const args = historyArgs({ text: "x[1]", author: null, file: null }, 7);
	assert.ok(args.includes("-n7"));
	assert.ok(args.includes("--grep=x[1]"));
	assert.ok(args.includes("--fixed-strings"));
	assert.equal(args.at(-1), "--grep=x[1]");
});

test("la ricerca filtra per testo, autore e file", async () => {
	const text = await backend.search("correzione");
	assert.deepEqual(
		text.map((commit) => commit.subject),
		["secondo: correzione (urgente)"],
	);

	const author = await backend.search("author:Anna");
	assert.equal(author.length, 1);
	assert.equal(author[0]!.email, "anna@example.com");

	const file = await backend.search("file:b.txt");
	assert.equal(file.length, 1);
	assert.equal(file[0]!.subject, "secondo: correzione (urgente)");

	const limited = await backend.search("", 2);
	assert.equal(limited.length, 2);
});

test("le parentesi nel testo non diventano una regex", async () => {
	const exact = await backend.search("(urgente)");
	assert.equal(exact.length, 1);
	// se fosse una regex, `urgent.` troverebbe "urgente"; come testo letterale no
	const literal = await backend.search("urgent.");
	assert.equal(literal.length, 0);
});
