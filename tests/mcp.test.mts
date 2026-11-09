import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";

import { CliGitBackend } from "../src/main/backend.ts";
import { defaultSettings, type Settings } from "../src/core/settings.ts";
import type { AuditRecord } from "../src/mcp/audit.ts";
import { handleRequest, PROTOCOL_VERSION } from "../src/mcp/server.ts";

/**
 * Il protocollo si prova in-process: stesso `handleRequest` che il trasporto stdio chiama.
 * Il repository è vero, quindi i tool sono provati contro Git, non contro mock.
 */

const root = await mkdtemp(join(tmpdir(), "githandler-mcp-"));

function git(...args: string[]): string {
	return execFileSync("git", args, { cwd: root, encoding: "utf8" });
}

git("init", "-b", "main");
git("config", "user.name", "Test");
git("config", "user.email", "test@example.com");
await writeFile(join(root, "a.txt"), "uno\ndue\n");
git("add", "a.txt");
git("commit", "-m", "primo commit");

const backend = new CliGitBackend();
await backend.open(root);

/** La policy che il server legge a ogni richiesta: i test la cambiano al volo. */
const defaultTrash = defaultSettings().trash;
const defaultAppearance = defaultSettings().appearance;
let settings: Settings = {
	api: { mode: "all", tools: [] },
	locale: "auto",
	appearance: defaultAppearance,
	defaultRoot: null,
	trash: defaultTrash,
	repoAccounts: {},
};
/** Le voci che il server scriverebbe nell'audit log: qui restano in memoria. */
const audits: AuditRecord[] = [];
const context = {
	backend,
	repo: root,
	settings: async () => settings,
	audit: async (record: AuditRecord) => {
		audits.push(record);
	},
};

after(async () => {
	await rm(root, { recursive: true, force: true });
});

interface ToolResult {
	content: Array<{ type: string; text: string }>;
	isError?: boolean;
}

async function callTool(
	name: string,
	args: Record<string, unknown> = {},
): Promise<ToolResult> {
	const response = await handleRequest(context, {
		jsonrpc: "2.0",
		id: 7,
		method: "tools/call",
		params: { name, arguments: args },
	});
	assert.ok(response);
	const result = response.result as ToolResult;
	assert.ok(Array.isArray(result.content));
	return result;
}

function data(result: ToolResult): Record<string, unknown> {
	return JSON.parse(result.content[0]!.text) as Record<string, unknown>;
}

test("initialize dichiara il protocollo e i tool", async () => {
	const response = await handleRequest(context, {
		jsonrpc: "2.0",
		id: 1,
		method: "initialize",
	});
	assert.ok(response);
	const result = response.result as {
		protocolVersion: string;
		serverInfo: { name: string };
		capabilities: { tools: unknown };
	};
	assert.equal(result.protocolVersion, PROTOCOL_VERSION);
	assert.equal(result.serverInfo.name, "githandler");
	assert.ok(result.capabilities.tools);
});

test("tools/list elenca lettura e scrittura in quest'ordine", async () => {
	const response = await handleRequest(context, {
		jsonrpc: "2.0",
		id: 2,
		method: "tools/list",
	});
	const result = response!.result as {
		tools: Array<{ name: string; inputSchema: unknown }>;
	};
	assert.deepEqual(
		result.tools.map((tool) => tool.name),
		[
			"repo_status",
			"history",
			"show_commit",
			"worktree_diff",
			"blame",
			"stage",
			"unstage",
			"commit",
			"create_branch",
			"checkout_branch",
		],
	);
	for (const tool of result.tools) assert.ok(tool.inputSchema);
});

test("le notifiche non ricevono risposta e i metodi ignoti danno errore", async () => {
	const notification = await handleRequest(context, {
		jsonrpc: "2.0",
		method: "notifications/initialized",
	});
	assert.equal(notification, null);

	const unknown = await handleRequest(context, {
		jsonrpc: "2.0",
		id: 3,
		method: "tools/nope",
	});
	assert.equal(unknown?.error?.code, -32601);
});

test("repo_status descrive ramo, modifiche e undo", async () => {
	await writeFile(join(root, "a.txt"), "uno\nDUE\n");
	const status = data(await callTool("repo_status"));
	assert.equal(status.branch, "main");
	assert.equal(status.detached, false);
	const changes = status.changes as Array<{ path: string; worktree: string }>;
	assert.equal(changes.length, 1);
	assert.equal(changes[0]!.path, "a.txt");
	assert.equal(changes[0]!.worktree, "M");
	assert.equal(status.undo, null);
});

test("history filtra e show_commit restituisce il diff richiesto", async () => {
	const history = data(await callTool("history", { text: "primo" }));
	const commits = history.commits as Array<{ sha: string; subject: string }>;
	assert.equal(commits.length, 1);

	const shown = data(
		await callTool("show_commit", { sha: commits[0]!.sha, path: "a.txt" }),
	);
	const commit = shown.commit as { sha: string; subject: string };
	assert.equal(commit.subject, "primo commit");
	const files = shown.files as Array<{ path: string; status: string }>;
	assert.deepEqual(files, [{ path: "a.txt", originalPath: null, status: "A" }]);
	assert.equal(shown.path, "a.txt");
	assert.match(shown.diff as string, /\+uno/);

	const withoutDiff = data(
		await callTool("show_commit", { sha: commits[0]!.sha }),
	);
	assert.equal(withoutDiff.diff, null);
});

test("worktree_diff restituisce il testo unified", async () => {
	const result = data(await callTool("worktree_diff", { path: "a.txt" }));
	assert.equal(result.staged, false);
	assert.equal(result.additions, 1);
	assert.equal(result.deletions, 1);
	assert.match(result.diff as string, /-due\n\+DUE/);
});

test("blame attribuisce le righe", async () => {
	const result = data(await callTool("blame", { path: "a.txt" }));
	const lines = result.lines as Array<{
		line: number;
		author: string;
		commit: string | null;
		text: string;
	}>;
	assert.equal(lines.length, 2);
	assert.equal(lines[0]!.line, 1);
	assert.equal(lines[0]!.author, "Test");
	assert.equal(lines[0]!.text, "uno");
	assert.equal(lines[1]!.commit, null); // riga modificata, non committata
	assert.equal(lines[1]!.text, "DUE");
});

test("gli errori dei tool tornano come contenuto, non come crash", async () => {
	const missing = await callTool("show_commit", {});
	assert.equal(missing.isError, true);

	const badSha = await callTool("show_commit", { sha: "non-un-sha" });
	assert.equal(badSha.isError, true);

	const unknownTool = await callTool("rm_rf");
	assert.equal(unknownTool.isError, true);

	const traversal = await callTool("worktree_diff", { path: "../etc/passwd" });
	assert.equal(traversal.isError, true);
});

test("la policy delle impostazioni filtra tools/list e tools/call", async () => {
	const list = async (): Promise<Array<{ name: string }>> => {
		const response = await handleRequest(context, {
			jsonrpc: "2.0",
			id: 9,
			method: "tools/list",
		});
		const result = response!.result as { tools: Array<{ name: string }> };
		return result.tools;
	};

	settings = { api: { mode: "off", tools: [] }, locale: "auto", appearance: defaultAppearance, defaultRoot: null, trash: defaultTrash, repoAccounts: {} };
	assert.deepEqual(await list(), []);
	const denied = await callTool("repo_status");
	assert.equal(denied.isError, true);
	assert.match(denied.content[0]!.text, /not enabled/);

	settings = { api: { mode: "read", tools: [] }, locale: "auto", appearance: defaultAppearance, defaultRoot: null, trash: defaultTrash, repoAccounts: {} };
	assert.equal((await list()).length, 5);

	settings = {
		api: { mode: "custom", tools: ["history", "blame"] },
		locale: "auto",
		appearance: defaultAppearance,
		defaultRoot: null,
		trash: defaultTrash,
		repoAccounts: {},
	};
	assert.deepEqual(
		(await list()).map((tool) => tool.name),
		["history", "blame"],
	);
	assert.equal((await callTool("repo_status")).isError, true);
	assert.equal((await callTool("history", { limit: 1 })).isError, undefined);
	assert.equal((await callTool("blame", { path: "a.txt" })).isError, undefined);

	// una policy con tool che non esistono non li inventa
	settings = { api: { mode: "custom", tools: [] }, locale: "auto", appearance: defaultAppearance, defaultRoot: null, trash: defaultTrash, repoAccounts: {} };
	assert.deepEqual(await list(), []);

	settings = { api: { mode: "all", tools: [] }, locale: "auto", appearance: defaultAppearance, defaultRoot: null, trash: defaultTrash, repoAccounts: {} };
});

test("i tool che scrivono non compaiono con la sola lettura", async () => {
	settings = {
		api: { mode: "read", tools: [] },
		locale: "auto",
		appearance: defaultAppearance,
		defaultRoot: null,
		trash: defaultTrash,
		repoAccounts: {},
	};
	const denied = await callTool("stage", { paths: ["a.txt"] });
	assert.equal(denied.isError, true);
	assert.match(denied.content[0]!.text, /not enabled/);

	settings = {
		api: { mode: "all", tools: [] },
		locale: "auto",
		appearance: defaultAppearance,
		defaultRoot: null,
		trash: defaultTrash,
		repoAccounts: {},
	};
});

test("stage, commit e unstage cambiano l'indice e finiscono nell'audit", async () => {
	audits.length = 0;
	await writeFile(join(root, "b.txt"), "nuovo file\n");

	const staged = data(await callTool("stage", { paths: ["b.txt"] }));
	const stagedEntries = staged.changes as Array<{ path: string; index: string }>;
	assert.equal(
		stagedEntries.find((entry) => entry.path === "b.txt")?.index,
		"A",
	);

	const committed = data(
		await callTool("commit", { message: "aggiungi b\n\ncorpo del messaggio" }),
	);
	assert.equal(committed.branch, "main");
	assert.equal(committed.detached, false);
	assert.equal(git("log", "-1", "--pretty=%s").trim(), "aggiungi b");

	// l'audit registra solo le scritture, con gli argomenti ridotti a scalari
	assert.deepEqual(
		audits.map((entry) => entry.tool),
		["stage", "commit"],
	);
	assert.equal(audits[0]!.ok, true);
	assert.equal(audits[0]!.arguments.paths, "b.txt");
	assert.equal(audits[1]!.arguments.message, "aggiungi b\n\ncorpo del messaggio");

	await writeFile(join(root, "b.txt"), "modificato\n");
	await callTool("stage", { paths: ["b.txt"] });
	const unstaged = data(await callTool("unstage", { paths: ["b.txt"] }));
	const entries = unstaged.changes as Array<{ path: string; index: string }>;
	assert.equal(entries.find((entry) => entry.path === "b.txt")?.index, ".");
	assert.equal(audits.at(-1)!.tool, "unstage");
});

test("create_branch e checkout_branch cambiano il ramo", async () => {
	audits.length = 0;
	const created = data(await callTool("create_branch", { name: "esperimento" }));
	assert.equal(created.branch, "esperimento");

	const back = data(await callTool("checkout_branch", { name: "main" }));
	assert.equal(back.branch, "main");
	assert.deepEqual(
		audits.map((entry) => entry.tool),
		["create_branch", "checkout_branch"],
	);
});

test("un ramo inesistente torna errore e resta nell'audit", async () => {
	audits.length = 0;
	const result = await callTool("checkout_branch", { name: "non-esiste" });
	assert.equal(result.isError, true);
	assert.equal(audits.length, 1);
	assert.equal(audits[0]!.ok, false);
	assert.match(audits[0]!.error ?? "", /non-esiste/);
});

test("un path fuori dal repository viene rifiutato", async () => {
	audits.length = 0;
	const result = await callTool("stage", { paths: ["../fuori.txt"] });
	assert.equal(result.isError, true);
	assert.equal(audits.length, 1);
	assert.equal(audits.at(-1)!.ok, false);
});

test("un elenco di path vuoto non tocca niente, ma il tentativo resta scritto", async () => {
	audits.length = 0;
	const result = await callTool("stage", { paths: [] });
	assert.equal(result.isError, true);
	assert.match(result.content[0]!.text, /paths/);
	assert.equal(audits.length, 1);
	assert.equal(audits[0]!.ok, false);
});
