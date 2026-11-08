import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";

import {
	Debouncer,
	isInterestingPath,
	startWatcher,
} from "../src/main/watcher.ts";

const dirs: string[] = [];

after(async () => {
	await Promise.all(
		dirs.map((dir) => rm(dir, { recursive: true, force: true })),
	);
});

test("i path rumorosi non interessano", () => {
	assert.equal(isInterestingPath("src/app.ts"), true);
	assert.equal(isInterestingPath(".git/HEAD"), true);
	assert.equal(isInterestingPath(".git/objects/ab/cdef"), false);
	assert.equal(isInterestingPath(".git/lfs/objects/aa"), false);
	assert.equal(isInterestingPath(".git/gitcraft/undo.json"), false);
	assert.equal(isInterestingPath("node_modules/x/index.js"), false);
	assert.equal(isInterestingPath("cache/node_modules/x.js"), false);
	assert.equal(isInterestingPath(".git/index.lock"), false);
	assert.equal(isInterestingPath("file.swp"), false);
	assert.equal(isInterestingPath(""), true);
});

test("il debounce chiama una sola volta", async () => {
	let calls = 0;
	const debouncer = new Debouncer(40, () => {
		calls += 1;
	});
	debouncer.trigger();
	debouncer.trigger();
	debouncer.trigger();
	await new Promise((resolve) => setTimeout(resolve, 120));
	assert.equal(calls, 1);
	debouncer.cancel();
});

test("una scrittura nel repository produce un evento", async () => {
	const dir = await mkdtemp(join(tmpdir(), "gitcraft-watch-"));
	dirs.push(dir);

	let notify: () => void = () => undefined;
	const received = new Promise<void>((resolve) => {
		notify = resolve;
	});
	const stop = startWatcher({
		root: dir,
		debounceMs: 60,
		onChange: () => notify(),
	});

	await writeFile(join(dir, "file.txt"), "ciao\n");

	await Promise.race([
		received,
		new Promise((_, reject) =>
			setTimeout(
				() => reject(new Error("nessun evento entro 4 secondi")),
				4000,
			),
		),
	]);

	stop();
});

test("i file ignorati non generano eventi", async () => {
	const dir = await mkdtemp(join(tmpdir(), "gitcraft-watch-ignore-"));
	dirs.push(dir);

	let calls = 0;
	const stop = startWatcher({
		root: dir,
		debounceMs: 40,
		onChange: () => {
			calls += 1;
		},
	});

	await writeFile(join(dir, "file.lock"), "x");
	await writeFile(join(dir, "file.swp"), "x");
	await new Promise((resolve) => setTimeout(resolve, 200));
	stop();
	assert.equal(calls, 0);
});
