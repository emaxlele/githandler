import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";
import { promisify } from "node:util";

import {
	assertPlanCovers,
	parseRebaseCandidates,
	rebaseTodo,
	subjectOf,
	validateRebaseSteps,
	type RebaseStep,
} from "../src/core/rebase.ts";
import { CliGitBackend } from "../src/main/backend.ts";

const run = promisify(execFile);
const base = await mkdtemp(join(tmpdir(), "githandler-rebase-"));

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
	return repo;
}

async function commit(
	repo: string,
	file: string,
	text: string,
	message: string
): Promise<string> {
	await writeFile(join(repo, file), text);
	await git(repo, "add", file);
	await git(repo, "commit", "-qm", message);
	return (await git(repo, "rev-parse", "HEAD")).stdout.trim();
}

after(async () => {
	await rm(base, { recursive: true, force: true });
});

test("un piano valido: ordine, drop e reword", () => {
	const steps: RebaseStep[] = [
		{ sha: "a".repeat(40), action: "pick" },
		{ sha: "b".repeat(40), action: "drop" },
		{ sha: "c".repeat(40), action: "reword", message: "nuovo" },
		{ sha: "d".repeat(40), action: "squash" },
	];
	validateRebaseSteps(steps);
	const todo = rebaseTodo(steps, (index) => `/tmp/messaggi/${index}.txt`);
	assert.equal(
		todo,
		[
			`pick ${"a".repeat(40)}`,
			`pick ${"c".repeat(40)}`,
			`exec git commit --amend --no-verify -F "/tmp/messaggi/2.txt"`,
			`squash ${"d".repeat(40)}`,
			"",
		].join("\n")
	);

	// il primo commit non può unirsi a niente, e almeno uno deve restare
	for (const bad of [
		[{ sha: "a".repeat(40), action: "squash" as const }],
		[{ sha: "a".repeat(40), action: "drop" as const }],
		[
			{ sha: "a".repeat(40), action: "pick" as const },
			{ sha: "a".repeat(40), action: "pick" as const },
		],
		[{ sha: "a".repeat(40), action: "reword" as const }],
	]) {
		assert.throws(() => validateRebaseSteps(bad));
	}
});

test("il piano non può perdere né aggiungere commit", () => {
	assertPlanCovers(
		[
			{ sha: "a".repeat(40), action: "pick" },
			{ sha: "b".repeat(40), action: "drop" },
		],
		["a".repeat(40), "b".repeat(40)]
	);
	assert.throws(() =>
		assertPlanCovers([{ sha: "a".repeat(40), action: "pick" }], [
			"a".repeat(40),
			"b".repeat(40),
		])
	);
	assert.throws(() =>
		assertPlanCovers(
			[
				{ sha: "a".repeat(40), action: "pick" },
				{ sha: "b".repeat(40), action: "pick" },
			],
			["a".repeat(40)]
		)
	);
});

test("i candidati si leggono anche con un corpo su più righe", () => {
	const raw = [
		`${"a".repeat(40)}\x00primo\n\ncorpo\n`,
		`${"b".repeat(40)}\x00secondo`,
		"troncato senza NUL",
	].join("\x1e");
	assert.deepEqual(parseRebaseCandidates(`${raw}\x1e`), [
		{ sha: "a".repeat(40), message: "primo\n\ncorpo" },
		{ sha: "b".repeat(40), message: "secondo" },
	]);
	assert.equal(subjectOf("primo\n\ncorpo"), "primo");
	assert.equal(subjectOf(""), "(senza messaggio)");
});

test("il backend riscrive, riordina e annulla", async () => {
	const repo = await makeRepo("storia");
	const first = await commit(repo, "a.txt", "a\n", "primo");
	const second = await commit(repo, "b.txt", "b\n", "secondo");
	const third = await commit(repo, "c.txt", "c\n", "terzo");
	const fourth = await commit(repo, "d.txt", "d\n", "quarto");

	const backend = new CliGitBackend();
	await backend.open(repo);
	const plan = await backend.rebaseCandidates(second);
	assert.equal(plan.base, first);
	assert.equal(plan.head, fourth);
	assert.deepEqual(
		plan.candidates.map((candidate) => subjectOf(candidate.message)),
		["secondo", "terzo", "quarto"]
	);

	const snapshot = await backend.rebaseInteractive(
		plan.base,
		[
			{ sha: third, action: "pick" },
			{ sha: second, action: "reword", message: "secondo riscritto\n\ncon corpo" },
			{ sha: fourth, action: "drop" },
		],
		plan.head
	);
	assert.deepEqual(
		snapshot.commits.map((entry) => entry.subject),
		["secondo riscritto", "terzo", "primo"]
	);
	assert.equal(snapshot.info.branch, "main");
	// il corpo del messaggio non si perde nel reword (il commit rinominato è ora in testa)
	const shown = await git(repo, "show", "-s", "--format=%B", "HEAD");
	assert.match(shown.stdout, /con corpo/);
	// il file del commit eliminato non torna
	await assert.rejects(() => git(repo, "cat-file", "-e", "HEAD:d.txt"));

	await backend.undo();
	const restored = await git(repo, "log", "--reverse", "--format=%s");
	assert.deepEqual(
		restored.stdout.trim().split("\n"),
		["primo", "secondo", "terzo", "quarto"]
	);
});

test("squash e fixup uniscono i commit, con i controlli di sicurezza", async () => {
	const repo = await makeRepo("unione");
	const first = await commit(repo, "a.txt", "a\n", "primo");
	const second = await commit(repo, "b.txt", "b1\n", "secondo");
	const third = await commit(repo, "c.txt", "c\n", "terzo");
	const fourth = await commit(repo, "b.txt", "b2\n", "quarto");

	const backend = new CliGitBackend();
	await backend.open(repo);
	const plan = await backend.rebaseCandidates(second);

	// un commit fuori dalla storia e il primo commit non sono riscrivibili
	await assert.rejects(() => backend.rebaseCandidates(first), /primo commit/);
	await assert.rejects(
		() => backend.rebaseCandidates(fourth),
		/più vecchio/
	);

	await assert.rejects(
		() =>
			backend.rebaseInteractive(
				plan.base,
				[
					{ sha: second, action: "pick" },
					{ sha: third, action: "fixup" },
				],
				plan.head
			),
		/non copre|manca/
	);
	await assert.rejects(
		() =>
			backend.rebaseInteractive(
				plan.base,
				[
					{ sha: second, action: "pick" },
					{ sha: third, action: "fixup" },
					{ sha: fourth, action: "fixup" },
				],
				"0".repeat(40)
			),
		/storia è cambiata/
	);

	const snapshot = await backend.rebaseInteractive(
		plan.base,
		[
			{ sha: second, action: "pick" },
			{ sha: third, action: "squash" },
			{ sha: fourth, action: "fixup" },
		],
		plan.head
	);
	assert.deepEqual(
		snapshot.commits.map((entry) => entry.subject),
		["secondo", "primo"]
	);
	// il contenuto del terzo e del quarto è dentro il commit unito
	const content = await git(repo, "show", `${first}..HEAD`, "--stat", "--oneline");
	assert.match(content.stdout, /b\.txt|c\.txt/);

});

test("un intervallo con un merge viene rifiutato", async () => {
	const repo = await makeRepo("merge");
	await commit(repo, "a.txt", "a\n", "primo");
	const mainTip = await commit(repo, "b.txt", "b\n", "secondo");
	await git(repo, "checkout", "-q", "-b", "laterale", mainTip);
	const side = await commit(repo, "c.txt", "c\n", "terzo");
	await git(repo, "checkout", "-q", "main");
	await commit(repo, "d.txt", "d\n", "quarto");
	await git(repo, "merge", "--no-ff", "-q", "-m", "unione", side);
	const tip = (await git(repo, "rev-parse", "HEAD")).stdout.trim();

	const backend = new CliGitBackend();
	await backend.open(repo);
	await assert.rejects(
		() => backend.rebaseCandidates(mainTip),
		/contiene un merge/
	);
	await assert.rejects(
		() => backend.rebaseCandidates(tip),
		/più vecchio/
	);
});
