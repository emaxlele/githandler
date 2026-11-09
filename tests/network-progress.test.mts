import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";
import { promisify } from "node:util";

import type { NetworkProgress } from "../src/core/network.ts";
import { cloneRepository } from "../src/main/repos.ts";

const run = promisify(execFile);
const roots: string[] = [];

after(async () => {
	await Promise.all(roots.map((root) => rm(root, { recursive: true, force: true })));
});

function git(cwd: string, ...args: string[]): Promise<{ stdout: string }> {
	return run("git", args, {
		cwd,
		env: { ...process.env, LC_ALL: "C" },
	}) as Promise<{ stdout: string }>;
}

test("il clone riporta l'avanzamento mentre gli oggetti arrivano", async () => {
	const base = await mkdtemp(join(tmpdir(), "githandler-net-"));
	roots.push(base);
	const source = join(base, "sorgente");
	const dest = join(base, "destinazione");

	await git(base, "init", "-q", source);
	await git(source, "config", "user.name", "Test");
	await git(source, "config", "user.email", "test@example.com");
	for (let index = 0; index < 40; index++) {
		await writeFile(
			join(source, `file-${index}.txt`),
			"contenuto di prova\n".repeat(2000)
		);
	}
	await git(source, "add", ".");
	await git(source, "commit", "-qm", "primo");

	const events: NetworkProgress[] = [];
	// `file://` evita il percorso locale ottimizzato: Git trasferisce davvero un pack
	await cloneRepository(
		`file://${source}`,
		dest,
		null,
		(progress) => events.push(progress)
	);

	assert.ok(events.length > 0, "nessun evento di avanzamento");
	assert.ok(
		events.some((event) => event.phase === "Receiving objects"),
		`fasi viste: ${[...new Set(events.map((event) => event.phase))].join(", ")}`
	);
	assert.ok(
		events.every(
			(event) =>
				event.percent >= 0 &&
				event.percent <= 100 &&
				event.phase.trim() !== ""
		)
	);
	assert.equal(events.at(-1)?.percent, 100);
});
