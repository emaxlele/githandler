import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";

import { historyArgs, parseHistoryQuery } from "../src/core/search.ts";

/** La query come la scrive l'utente; `backend.search` prende già la forma parsata. */
const q = (raw: string) => parseHistoryQuery(raw);
import { CliGitBackend } from "../src/main/backend.ts";

const root = await mkdtemp(join(tmpdir(), "githandler-search-"));

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
		regex: null,
		pickaxe: null,
		diff: null,
		lines: null,
	});
	assert.deepEqual(parseHistoryQuery("solo testo"), {
		text: "solo testo",
		author: null,
		file: null,
		regex: null,
		pickaxe: null,
		diff: null,
		lines: null,
	});
	assert.deepEqual(parseHistoryQuery("author:  file:"), {
		text: null,
		author: null,
		file: null,
		regex: null,
		pickaxe: null,
		diff: null,
		lines: null,
	});
});

test("regex, pickaxe, diff e intervallo di righe", () => {
	assert.deepEqual(
		parseHistoryQuery('regex:"^fix \\(urgente\\)" change:motivo diff:^TODO lines:10,40:"src/a b.ts"'),
		{
			text: null,
			author: null,
			file: null,
			regex: "^fix \\(urgente\\)",
			pickaxe: "motivo",
			diff: "^TODO",
			lines: { start: 10, end: 40, path: "src/a b.ts" },
		}
	);
	// `grep:` resta un alias di `file:`
	assert.equal(parseHistoryQuery("grep:b.txt").file, "b.txt");
});

test("un intervallo di righe sbagliato si ferma con un messaggio", () => {
	for (const raw of [
		"lines:0,3:a.txt",
		"lines:5,2:a.txt",
		"lines:1,2",
		"lines:1,5000:a.txt",
	]) {
		assert.throws(() => parseHistoryQuery(raw), /Intervallo/, raw);
	}
	assert.throws(
		() => parseHistoryQuery("testo regex:^fix"),
		/non entrambi/,
	);
});

test("historyArgs usa espressioni letterali e un limite", () => {
	const args = historyArgs(q("x[1]"), 7);
	assert.ok(args.includes("-n7"));
	assert.ok(args.includes("--grep=x[1]"));
	assert.ok(args.includes("--fixed-strings"));
	assert.equal(args.at(-1), "--grep=x[1]");
});

test("historyArgs distingue letterale, regex, pickaxe e diff", () => {
	const regex = historyArgs(q("regex:^fix"), 7);
	assert.ok(regex.includes("--extended-regexp"));
	assert.ok(regex.includes("--grep=^fix"));
	assert.equal(regex.includes("--fixed-strings"), false);

	assert.ok(historyArgs(q("change:motivo"), 5).includes("-Smotivo"));
	assert.ok(historyArgs(q("diff:^TODO"), 5).includes("-G^TODO"));

	// `-L` non convive con `--all` e implica il diff: si chiede la storia senza patch
	const lines = historyArgs(q("lines:1,3:a.txt"), 5);
	assert.ok(lines.includes("-L1,3:a.txt"));
	assert.ok(lines.includes("--no-patch"));
	assert.equal(lines.includes("--all"), false);
	assert.equal(lines.at(-1), "-L1,3:a.txt");
});

test("la ricerca filtra per testo, autore e file", async () => {
	const text = await backend.search(q("correzione"));
	assert.deepEqual(
		text.map((commit) => commit.subject),
		["secondo: correzione (urgente)"],
	);

	const author = await backend.search(q("author:Anna"));
	assert.equal(author.length, 1);
	assert.equal(author[0]!.email, "anna@example.com");

	const file = await backend.search(q("file:b.txt"));
	assert.equal(file.length, 1);
	assert.equal(file[0]!.subject, "secondo: correzione (urgente)");

	const limited = await backend.search(q(""), 2);
	assert.equal(limited.length, 2);
});

test("le parentesi nel testo non diventano una regex", async () => {
	const exact = await backend.search(q("(urgente)"));
	assert.equal(exact.length, 1);
	// se fosse una regex, `urgent.` troverebbe "urgente"; come testo letterale no
	const literal = await backend.search(q("urgent."));
	assert.equal(literal.length, 0);
});

test("regex, pickaxe, diff e righe trovano i commit giusti", async () => {
	const regex = await backend.search(q("regex:^secondo"));
	assert.deepEqual(
		regex.map((commit) => commit.subject),
		["secondo: correzione (urgente)"],
	);
	// con la regex il punto vale «qualsiasi carattere», con il testo libero no
	const dotted = await backend.search(q("regex:urgent."));
	assert.equal(dotted.length, 1);

	const added = await backend.search(q("change:due"));
	assert.deepEqual(
		added.map((commit) => commit.subject),
		["secondo: correzione (urgente)"],
	);

	const inDiff = await backend.search(q("diff:^due$"));
	assert.deepEqual(
		inDiff.map((commit) => commit.subject),
		["secondo: correzione (urgente)"],
	);

	// storia della prima riga di a.txt: creazione e modifica, dalla più recente
	const line = await backend.search(q("lines:1,1:a.txt"));
	assert.deepEqual(
		line.map((commit) => commit.subject),
		["terzo commit", "primo commit"],
	);
});
