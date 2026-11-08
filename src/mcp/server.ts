import { UNCOMMITTED_SHA } from "../core/blame.ts";
import { formatDiff } from "../core/diff.ts";
import { formatHistoryQuery, type HistoryQuery } from "../core/search.ts";
import {
	allowedTools,
	isApiTool,
	isToolAllowed,
	type ApiPolicy,
	type ApiTool,
	type Settings,
} from "../core/settings.ts";
import type { Commit } from "../core/types.ts";
import type { GitBackend } from "../main/backend.ts";

/**
 * Server MCP (Model Context Protocol) in sola lettura.
 *
 * Non è un secondo strato che tocca il disco: riusa `GitBackend`, quindi vede esattamente lo
 * stesso repository, con le stesse regole e lo stesso output della UI. Nessun tool scrive.
 *
 * L'elenco dei tool non è una costante: a ogni richiesta si legge la policy delle impostazioni e si
 * espone solo ciò che l'utente ha consentito. Un client che chiama un tool non esposto riceve un
 * errore, non un'esecuzione.
 */

export const SERVER_INFO = { name: "lanecraft", version: "0.5.0" } as const;
export const PROTOCOL_VERSION = "2024-11-05";

export interface McpContext {
	backend: GitBackend;
	repo: string;
	/** Rilette a ogni richiesta: cambiare i permessi non richiede riavviare il client. */
	settings: () => Promise<Settings>;
}

export interface JsonRpcResponse {
	jsonrpc: "2.0";
	id: number | string | null;
	result?: unknown;
	error?: { code: number; message: string };
}

interface ToolDefinition {
	name: string;
	description: string;
	inputSchema: Record<string, unknown>;
}

const TOOLS: ToolDefinition[] = [
	{
		name: "repo_status",
		description:
			"Current state of the repository: branch, ahead/behind counters, changed files (staged and working tree codes) and the last undoable operation. Read-only.",
		inputSchema: {
			type: "object",
			properties: {},
			additionalProperties: false,
		},
	},
	{
		name: "history",
		description:
			"Search the commit history, newest first. Filters combine: free text is a literal substring of the message, author matches name or email, file restricts to commits touching that path. Read-only.",
		inputSchema: {
			type: "object",
			properties: {
				text: {
					type: "string",
					description: "literal text in the commit message",
				},
				author: {
					type: "string",
					description: "author name or email fragment",
				},
				file: {
					type: "string",
					description: "path that the commit must have touched",
				},
				limit: {
					type: "integer",
					minimum: 1,
					maximum: 500,
					description: "maximum number of commits (default 50)",
				},
			},
			additionalProperties: false,
		},
	},
	{
		name: "show_commit",
		description:
			"Metadata and changed files of a commit, plus the unified diff of one file when `path` is given. Read-only.",
		inputSchema: {
			type: "object",
			properties: {
				sha: {
					type: "string",
					description: "full or abbreviated commit SHA",
				},
				path: {
					type: "string",
					description: "file path to include the diff for",
				},
			},
			required: ["sha"],
			additionalProperties: false,
		},
	},
	{
		name: "worktree_diff",
		description:
			"Unified diff of one working-tree file, either staged or unstaged. Read-only.",
		inputSchema: {
			type: "object",
			properties: {
				path: { type: "string" },
				staged: {
					type: "boolean",
					description:
						"true reads the index instead of the working tree",
				},
			},
			required: ["path"],
			additionalProperties: false,
		},
	},
	{
		name: "blame",
		description:
			"Line-by-line attribution of a file: commit, author, date and text for each line. Read-only.",
		inputSchema: {
			type: "object",
			properties: {
				path: { type: "string" },
				start: {
					type: "integer",
					minimum: 1,
					description: "first line (1-based)",
				},
				end: {
					type: "integer",
					minimum: 1,
					description: "last line, inclusive",
				},
			},
			required: ["path"],
			additionalProperties: false,
		},
	},
];

interface ToolResult {
	content: Array<{ type: "text"; text: string }>;
	isError?: boolean;
}

function asRecord(value: unknown): Record<string, unknown> {
	return typeof value === "object" && value !== null
		? (value as Record<string, unknown>)
		: {};
}

/** I tool che la policy corrente consente di elencare e chiamare. */
function visibleTools(policy: ApiPolicy): ToolDefinition[] {
	const allowed = new Set(allowedTools(policy));
	return TOOLS.filter((tool) => allowed.has(tool.name as ApiTool));
}

function asString(value: unknown): string | null {
	return typeof value === "string" && value.trim() ? value.trim() : null;
}

function asInteger(value: unknown): number | null {
	return typeof value === "number" && Number.isInteger(value) ? value : null;
}

function clamp(value: number, min: number, max: number): number {
	return Math.min(max, Math.max(min, value));
}

function text(value: unknown): ToolResult {
	return {
		content: [{ type: "text", text: JSON.stringify(value, null, 2) }],
	};
}

function failure(message: string): ToolResult {
	return {
		content: [{ type: "text", text: `Error: ${message}` }],
		isError: true,
	};
}

function commitSummary(commit: Commit): Record<string, unknown> {
	return {
		sha: commit.sha,
		author: commit.author,
		email: commit.email,
		date: new Date(commit.timestamp * 1000).toISOString(),
		subject: commit.subject,
		parents: commit.parents,
	};
}

async function callTool(
	context: McpContext,
	name: string,
	rawArgs: unknown
): Promise<ToolResult> {
	const args = asRecord(rawArgs);
	const { backend } = context;

	if (name === "repo_status") {
		const snapshot = await backend.refresh();
		return text({
			repo: snapshot.info.root,
			name: snapshot.info.name,
			branch: snapshot.info.branch,
			detached: snapshot.info.detached,
			ahead: snapshot.status.ahead,
			behind: snapshot.status.behind,
			changes: snapshot.status.entries.map((entry) => ({
				path: entry.path,
				originalPath: entry.origPath,
				kind: entry.kind,
				index: entry.index,
				worktree: entry.worktree,
				label: entry.label,
			})),
			undo: snapshot.undo
				? { kind: snapshot.undo.kind, label: snapshot.undo.label }
				: null,
		});
	}

	if (name === "history") {
		const query: HistoryQuery = {
			text: asString(args.text),
			author: asString(args.author),
			file: asString(args.file),
		};
		const limit = clamp(asInteger(args.limit) ?? 50, 1, 500);
		const commits = await backend.search(formatHistoryQuery(query), limit);
		return text({
			query,
			count: commits.length,
			commits: commits.map(commitSummary),
		});
	}

	if (name === "show_commit") {
		const sha = asString(args.sha);
		if (!sha) return failure("`sha` is required.");
		const commit = await backend.commitInfo(sha);
		const files = await backend.commitFiles(commit.sha);
		const path = asString(args.path);
		const diff = path
			? formatDiff(await backend.commitPatch(commit.sha, path))
			: null;
		return text({
			commit: commitSummary(commit),
			files: files.map((file) => ({
				path: file.path,
				originalPath: file.oldPath,
				status: file.status,
			})),
			path: path ?? null,
			diff,
		});
	}

	if (name === "worktree_diff") {
		const path = asString(args.path);
		if (!path) return failure("`path` is required.");
		const staged = args.staged === true;
		const file = await backend.worktreePatch(path, staged);
		return text({
			path: file.path,
			staged,
			status: file.status,
			binary: file.binary,
			additions: file.additions,
			deletions: file.deletions,
			diff: formatDiff(file),
		});
	}

	if (name === "blame") {
		const path = asString(args.path);
		if (!path) return failure("`path` is required.");
		const start = asInteger(args.start) ?? undefined;
		const end = asInteger(args.end) ?? undefined;
		const blamed = await backend.blame(path, start, end);
		return text({
			path: blamed.path,
			count: blamed.lines.length,
			lines: blamed.lines.map((line) => ({
				line: line.line,
				commit: line.commit === UNCOMMITTED_SHA ? null : line.commit,
				author: line.author,
				date:
					line.commit === UNCOMMITTED_SHA
						? null
						: new Date(line.timestamp * 1000).toISOString(),
				summary: line.summary,
				text: line.text,
			})),
		});
	}

	return failure(`Unknown tool: ${name}`);
}

interface ParsedRequest {
	id: number | string | null;
	hasId: boolean;
	method: string;
	params: unknown;
}

function parseRequest(raw: unknown): ParsedRequest | null {
	if (typeof raw !== "object" || raw === null) return null;
	const record = raw as Record<string, unknown>;
	if (typeof record.method !== "string") return null;
	const id = record.id;
	if (
		id !== undefined &&
		typeof id !== "number" &&
		typeof id !== "string" &&
		id !== null
	)
		return null;
	return {
		id: id ?? null,
		hasId: id !== undefined,
		method: record.method,
		params: record.params,
	};
}

function ok(id: number | string | null, result: unknown): JsonRpcResponse {
	return { jsonrpc: "2.0", id, result };
}

function error(
	id: number | string | null,
	code: number,
	message: string
): JsonRpcResponse {
	return { jsonrpc: "2.0", id, error: { code, message } };
}

/** Una richiesta JSON-RPC; `null` quando non va inviata risposta (notifiche). */
export async function handleRequest(
	context: McpContext,
	request: unknown
): Promise<JsonRpcResponse | null> {
	const parsed = parseRequest(request);
	if (!parsed) return error(null, -32600, "Invalid Request");

	const { id, hasId, method } = parsed;
	const params = asRecord(parsed.params);

	if (method === "initialize") {
		return ok(id, {
			protocolVersion: PROTOCOL_VERSION,
			capabilities: { tools: {} },
			serverInfo: SERVER_INFO,
			instructions:
				"Read-only access to a Git repository for analysis. Use history, show_commit, worktree_diff and blame to inspect; this server cannot modify the repository. Only tools enabled in the lanecraft settings are exposed.",
		});
	}

	if (method === "notifications/initialized" || !hasId) return null;

	if (method === "ping") return ok(id, {});

	const policy = (await context.settings()).api;

	if (method === "tools/list") return ok(id, { tools: visibleTools(policy) });

	if (method === "tools/call") {
		const name = asString(params.name);
		if (!name) return ok(id, failure("`name` is required."));
		if (!isApiTool(name) || !isToolAllowed(policy, name))
			return ok(
				id,
				failure(
					`Tool "${name}" is not enabled in the lanecraft settings.`
				)
			);
		try {
			return ok(id, await callTool(context, name, params.arguments));
		} catch (cause) {
			const message =
				cause instanceof Error ? cause.message : String(cause);
			return ok(id, failure(message));
		}
	}

	return error(id, -32601, `Method not found: ${method}`);
}
