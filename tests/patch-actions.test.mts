import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";
import { promisify } from "node:util";

import type { DiffFile } from "../src/core/types.ts";
import {
	buildPatch,
	revertPatch,
	type HunkSelection,
} from "../src/core/patch.ts";
import { CliGitBackend } from "../src/main/backend.ts";

/**
 * Azioni sulla selezione di un diff, contro `git` vero: mettere nello stash solo una parte delle
 * modifiche di un file e scartarne solo una parte, con l'annullamento che riporta il file com'era.
 *
 * Le due patch si costruiscono come le costruisce la finestra: `buildPatch` per ciò che va nello
 * stash, `revertPatch` per ciò che esce dal file. Il caso che conta è la modifica **dentro un hunk
 * condiviso**: le righe non scelte devono restare, e non possono entrare nella patch come se il
 * file le avesse già perse.
 */

const run = promisify(execFile);
const base = await mkdtemp(join(tmpdir(), "githandler-patch-actions-"));

function git(cwd: string, ...args: string[]): Promise<{ stdout: string }> {
	return run("git", args, {
		cwd,
		env: { ...process.env, LC_ALL: "C", GIT_TERMINAL_PROMPT: "0" },
	}) as Promise<{ stdout: string }>;
}

after(async () => {
	await rm(base, { recursive: true, force: true });
});

/** Dieci righe: due modifiche a due righe di distanza finiscono nello stesso hunk. */
const initial = [
	"uno",
	"due",
	"tre",
	"quattro",
	"cinque",
	"sei",
	"sette",
	"otto",
	"nove",
	"dieci",
].join("\n");

/** La prima modifica usata dai test: `tre` diventa `TRE`. La seconda: `cinque` → `CINQUE`. */
const first = /^tre$/m;
const firstNow = "TRE";
const second = /^cinque$/m;
const secondNow = "CINQUE";

function withChanges(text: string, which: "prima" | "seconda" | "entrambe"): string {
	let next = text;
	if (which !== "seconda") next = next.replace(first, firstNow);
	if (which !== "prima") next = next.replace(second, secondNow);
	return next;
}

/** Repository con un file noto, pronto per le modifiche del test. */
async function makeRepo(
	name: string
): Promise<{ backend: CliGitBackend; repo: string }> {
	const repo = join(base, name);
	await git(base, "init", "-q", "-b", "main", repo);
	await git(repo, "config", "user.name", "Test");
	await git(repo, "config", "user.email", "test@example.com");
	await writeFile(join(repo, "a.txt"), `${initial}\n`);
	await git(repo, "add", ".");
	await git(repo, "commit", "-qm", "primo");

	const backend = new CliGitBackend();
	await backend.open(repo);
	return { backend, repo };
}

function read(repo: string): Promise<string> {
	return readFile(join(repo, "a.txt"), "utf8");
}

/**
 * Le righe cambiate che contengono uno dei testi cercati, raggruppate per hunk. Un testo vale sia
 * per la riga rimossa (`tre`) sia per quella aggiunta (`TRE`).
 */
function selectionOn(file: DiffFile, texts: string[]): HunkSelection[] {
	const byHunk = new Map<number, number[]>();
	file.hunks.forEach((hunk, index) => {
		hunk.lines.forEach((line, i) => {
			if (line.type !== "add" && line.type !== "del") return;
			if (!texts.includes(line.text)) return;
			byHunk.set(index, [...(byHunk.get(index) ?? []), i]);
		});
	});
	return [...byHunk].map(([hunk, lines]) => ({ hunk, lines }));
}

test("stash parziale: una modifica esce, l'altra resta nello stesso hunk", async () => {
	const { backend, repo } = await makeRepo("stash-vicini");
	await writeFile(join(repo, "a.txt"), `${withChanges(initial, "entrambe")}\n`);

	const file = await backend.worktreePatch("a.txt", false);
	const selection = selectionOn(file, ["tre", "TRE"]);
	assert.equal(selection.length, 1, "le due modifiche stanno nello stesso hunk");

	const selected = buildPatch(file, selection, "stage");
	const revert = revertPatch(file, selection);
	assert.ok(selected, "patch della parte scelta");
	assert.ok(revert, "patch di ripristino");

	const snapshot = await backend.stashPatch(
		"a.txt",
		"La prima modifica",
		selected!,
		revert!
	);

	// nel file resta la seconda modifica, intatta
	assert.equal(await read(repo), `${withChanges(initial, "seconda")}\n`);
	assert.equal(snapshot.status.entries.length, 1);
	assert.equal(snapshot.status.entries[0]!.worktree, "M");

	const stashes = await backend.stashList();
	assert.equal(stashes.length, 1);
	assert.match(stashes[0]!.message, /La prima modifica/);
	// lo stash contiene la sola parte scelta: la prima modifica, non la seconda
	const shown = await git(repo, "show", `${stashes[0]!.sha}:a.txt`);
	assert.equal(shown.stdout, `${withChanges(initial, "prima")}\n`);
});

test("stash parziale: una sola aggiunta scelta non porta via le altre righe del hunk", async () => {
	const { backend, repo } = await makeRepo("stash-aggiunta");
	await writeFile(join(repo, "a.txt"), `${withChanges(initial, "entrambe")}\n`);

	const file = await backend.worktreePatch("a.txt", false);
	// solo l'aggiunta della prima modifica, senza la rimozione che le sta accanto
	const selection = selectionOn(file, ["TRE"]);
	const selected = buildPatch(file, selection, "stage");
	const revert = revertPatch(file, selection);
	assert.ok(selected);
	assert.ok(revert);

	await backend.stashPatch("a.txt", "Solo l'aggiunta", selected!, revert!);

	// l'aggiunta scelta esce dal file; la seconda modifica resta
	const left = await read(repo);
	assert.doesNotMatch(left, /TRE/);
	assert.match(left, /CINQUE/);

	const stashes = await backend.stashList();
	const shown = await git(repo, "show", `${stashes[0]!.sha}:a.txt`);
	assert.match(shown.stdout, /TRE/);
	assert.match(shown.stdout, /^tre$/m);
});

test("stash parziale: un file con qualcosa in stage viene rifiutato senza toccare niente", async () => {
	const { backend, repo } = await makeRepo("stash-staged");
	await writeFile(join(repo, "a.txt"), `${withChanges(initial, "prima")}\n`);
	await git(repo, "add", "a.txt");

	const before = await read(repo);
	const patch = [
		"diff --git a/a.txt b/a.txt",
		"--- a/a.txt",
		"+++ b/a.txt",
		"@@ -1,1 +1,1 @@",
		"-uno",
		"+uno modificato",
	].join("\n");
	await assert.rejects(
		backend.stashPatch("a.txt", "niente", patch, patch),
		/ha già modifiche in stage/
	);
	assert.equal(await read(repo), before);
	assert.deepEqual(await backend.stashList(), []);
});

test("scarto parziale: la parte scelta sparisce, il resto dell'hunk resta, Annulla riporta tutto", async () => {
	const { backend, repo } = await makeRepo("scarto");
	const changed = `${withChanges(initial, "entrambe")}\n`;
	await writeFile(join(repo, "a.txt"), changed);

	const file = await backend.worktreePatch("a.txt", false);
	const selection = selectionOn(file, ["tre", "TRE"]);
	const patch = revertPatch(file, selection);
	assert.ok(patch);

	await backend.discardPatch("a.txt", patch!, "stage");
	assert.equal(await read(repo), `${withChanges(initial, "seconda")}\n`);

	// «Annulla» riporta il file di prima, righe tenute comprese
	await backend.undo();
	assert.equal(await read(repo), changed);
});

test("scarto parziale di una sola aggiunta: non tocca le righe non scelte", async () => {
	const { backend, repo } = await makeRepo("scarto-aggiunta");
	const changed = `${withChanges(initial, "entrambe")}\n`;
	await writeFile(join(repo, "a.txt"), changed);

	const file = await backend.worktreePatch("a.txt", false);
	const patch = revertPatch(file, selectionOn(file, ["TRE"]));
	assert.ok(patch);

	await backend.discardPatch("a.txt", patch!, "stage");
	const left = await read(repo);
	// l'aggiunta scelta è uscita; l'altra modifica e le righe attorno sono ancora lì
	assert.doesNotMatch(left, /TRE/);
	assert.match(left, /CINQUE/);
	assert.match(left, /^due$/m);
});

test("scarto parziale del lato in stage toglie la parte scelta da indice e disco", async () => {
	const { backend, repo } = await makeRepo("scarto-staged");
	await writeFile(join(repo, "a.txt"), `${withChanges(initial, "entrambe")}\n`);
	await git(repo, "add", "a.txt");

	const file = await backend.worktreePatch("a.txt", true);
	const selection = selectionOn(file, ["tre", "TRE"]);
	const patch = revertPatch(file, selection);
	assert.ok(patch);

	const snapshot = await backend.discardPatch("a.txt", patch!, "unstage");

	assert.equal(await read(repo), `${withChanges(initial, "seconda")}\n`);
	// nell'indice resta solo la seconda modifica, anch'essa ancora da committare
	const index = await git(repo, "show", ":a.txt");
	assert.equal(index.stdout, `${withChanges(initial, "seconda")}\n`);
	assert.equal(snapshot.status.entries.length, 1);
});

test("una patch che nomina un altro file non arriva a git", async () => {
	const { backend, repo } = await makeRepo("intruso");
	const changed = `${withChanges(initial, "entrambe")}\n`;
	await writeFile(join(repo, "a.txt"), changed);

	const file = await backend.worktreePatch("a.txt", false);
	const selection = selectionOn(file, ["tre", "TRE"]);
	const patch = revertPatch(file, selection)!;
	const forged = patch.replace(
		"diff --git a/a.txt b/a.txt",
		"diff --git a/evil b/evil"
	);

	await assert.rejects(
		backend.discardPatch("a.txt", forged, "stage"),
		/non riguarda solo a\.txt/
	);
	await assert.rejects(
		backend.stashPatch("a.txt", "x", forged, forged),
		/non riguarda solo a\.txt/
	);
	assert.equal(await read(repo), changed);
});
