import assert from "node:assert/strict";
import {
	mkdir,
	mkdtemp,
	readFile,
	rm,
	stat,
	writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";

import {
	AUDIT_LIMIT_BYTES,
	auditArguments,
	auditFile,
	recordAudit,
} from "../src/mcp/audit.ts";

/**
 * L'audit log è l'unica traccia di quello che un agente ha fatto al repository: si prova su un
 * filesystem vero, perché quello che conta è il file che resta (righe JSON, permessi, rotazione).
 */

const base = await mkdtemp(join(tmpdir(), "githandler-audit-"));

after(async () => {
	await rm(base, { recursive: true, force: true });
});

let counter = 0;
function freshGitDir(): string {
	counter += 1;
	return join(base, `repo-${counter}`, ".git");
}

test("il file vive accanto al journal di undo", () => {
	assert.equal(
		auditFile("/tmp/progetto/.git"),
		join("/tmp/progetto/.git", "githandler", "mcp-audit.jsonl"),
	);
});

test("gli argomenti restano scalari e corti", () => {
	const reduced = auditArguments({
		path: "src/renderer/app.ts",
		count: 3,
		force: true,
		nothing: null,
		message: "m".repeat(500),
		nested: { deep: "valore" },
	});

	assert.equal(reduced.path, "src/renderer/app.ts");
	assert.equal(reduced.count, 3);
	assert.equal(reduced.force, true);
	assert.equal(reduced.nothing, null);
	// un messaggio di commit lungo viene tagliato invece di riempire il file
	assert.equal((reduced.message as string).length, 200);
	// un oggetto non ha posto in una riga di log: si scarta
	assert.equal("nested" in reduced, false);
});

test("un elenco di path diventa una riga per voce, con un tetto", () => {
	const paths = Array.from({ length: 60 }, (_, index) => `file-${index}.txt`);
	const reduced = auditArguments({ paths });
	const joined = reduced.paths as string;

	assert.equal(joined.split("\n").length, 50);
	assert.equal(joined.split("\n")[0], "file-0.txt");
	// valori di altro tipo dentro l'elenco si scartano invece di diventare "[object Object]"
	const mixed = auditArguments({ paths: ["a.txt", { x: 1 }, "b.txt", 7] });
	assert.equal(mixed.paths, "a.txt\nb.txt\n7");
});

test("un valore non oggetto non produce argomenti", () => {
	assert.deepEqual(auditArguments(null), {});
	assert.deepEqual(auditArguments("testo"), {});
});

test("una voce è una riga JSON, con i permessi di un file privato", async () => {
	const gitDir = freshGitDir();
	await recordAudit(gitDir, {
		timestamp: "2026-11-09T10:00:00.000Z",
		tool: "commit",
		ok: true,
		arguments: { message: "primo commit" },
	});

	const file = auditFile(gitDir);
	const raw = await readFile(file, "utf8");
	const lines = raw.trim().split("\n");

	assert.equal(lines.length, 1);
	assert.deepEqual(JSON.parse(lines[0]!), {
		timestamp: "2026-11-09T10:00:00.000Z",
		tool: "commit",
		ok: true,
		arguments: { message: "primo commit" },
	});
	// su Windows i permessi POSIX non esistono: resta il controllo che il file sia leggibile
	if (process.platform !== "win32")
		assert.equal((await stat(file)).mode & 0o777, 0o600);
});

test("le voci si accumulano in ordine", async () => {
	const gitDir = freshGitDir();
	for (const tool of ["stage", "commit", "checkout_branch"]) {
		await recordAudit(gitDir, {
			timestamp: "2026-11-09T10:00:00.000Z",
			tool,
			ok: true,
			arguments: {},
		});
	}
	const lines = (await readFile(auditFile(gitDir), "utf8"))
		.trim()
		.split("\n")
		.map((line) => JSON.parse(line) as { tool: string });
	assert.deepEqual(
		lines.map((entry) => entry.tool),
		["stage", "commit", "checkout_branch"],
	);
});

test("superato il limite il file vecchio diventa .1 e si riparte", async () => {
	const gitDir = freshGitDir();
	const file = auditFile(gitDir);
	await recordAudit(gitDir, {
		timestamp: "2026-11-09T10:00:00.000Z",
		tool: "stage",
		ok: true,
		arguments: {},
	});

	// un file già al limite: la voce successiva deve ruotare, non allungare
	await writeFile(file, "x".repeat(AUDIT_LIMIT_BYTES));
	await recordAudit(gitDir, {
		timestamp: "2026-11-09T10:01:00.000Z",
		tool: "commit",
		ok: false,
		arguments: {},
		error: "niente da committare",
	});

	assert.equal((await stat(`${file}.1`)).size, AUDIT_LIMIT_BYTES);
	const current = await readFile(file, "utf8");
	assert.equal(current.trim().split("\n").length, 1);
	assert.equal(JSON.parse(current).tool, "commit");
	assert.equal(JSON.parse(current).ok, false);
});

test("un audit che non si può scrivere non ferma l'operazione", async () => {
	// `githandler` qui è un file: la cartella non si può creare e la scrittura fallisce
	const gitDir = freshGitDir();
	await mkdir(gitDir, { recursive: true });
	await writeFile(join(gitDir, "githandler"), "occupato");

	await assert.doesNotReject(
		recordAudit(gitDir, {
			timestamp: "2026-11-09T10:00:00.000Z",
			tool: "stage",
			ok: true,
			arguments: {},
		}),
	);
});
