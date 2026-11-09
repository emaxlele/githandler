import { UNCOMMITTED_SHA } from "../core/blame.ts";
import { formatDiff } from "../core/diff.ts";
import { formatHistoryQuery, type HistoryQuery } from "../core/search.ts";
import {
	allowedTools,
	isApiTool,
	isToolAllowed,
	isWriteTool,
	type ApiPolicy,
	type ApiTool,
	type Settings,
} from "../core/settings.ts";
import type { Commit, Snapshot } from "../core/types.ts";
import type { GitBackend } from "../main/backend.ts";
import { auditArguments, type AuditRecord } from "./audit.ts";

/**
 * Server MCP (Model Context Protocol) per un repository.
 *
 * Non è un secondo strato che tocca il disco: riusa `GitBackend`, quindi vede esattamente lo
 * stesso repository, con le stesse regole e lo stesso output della UI.
 *
 * L'elenco dei tool non è una costante: a ogni richiesta si legge la policy delle impostazioni e si
 * espone solo ciò che l'utente ha consentito. I tool che scrivono (`stage`, `unstage`, `commit`,
 * `create_branch`, `checkout_branch`) non sono mai impliciti: la modalità `read` non li espone, e
 * ogni chiamata che cambia il repository finisce nell'audit log.
 */

export const SERVER_INFO = { name: "githandler", version: "0.5.0" } as const;
export const PROTOCOL_VERSION = "2024-11-05";

export interface McpContext {
	backend: GitBackend;
	repo: string;
	/** Rilette a ogni richiesta: cambiare i permessi non richiede riavviare il client. */
	settings: () => Promise<Settings>;
	/** Riceve una voce per ogni tool che scrive; assente nelle prove che non toccano il disco. */
	audit?: (record: AuditRecord) => Promise<void>;
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
	{
		name: "stage",
		description:
			"Stages the given files (`git add`). Every path must be inside the repository. Writes to the index; the change appears in the app and can be undone there.",
		inputSchema: {
			type: "object",
			properties: {
				paths: {
					type: "array",
					items: { type: "string" },
					minItems: 1,
					description: "repository-relative paths",
				},
			},
			required: ["paths"],
			additionalProperties: false,
		},
	},
	{
		name: "unstage",
		description:
			"Removes the given files from the index without touching the working tree. Writes to the index; the change appears in the app and can be undone there.",
		inputSchema: {
			type: "object",
			properties: {
				paths: {
					type: "array",
					items: { type: "string" },
					minItems: 1,
					description: "repository-relative paths",
				},
			},
			required: ["paths"],
			additionalProperties: false,
		},
	},
	{
		name: "commit",
		description:
			"Creates a commit from the staged files with the given message (subject on the first line, body after). With `all` it also stages tracked changes. Undoable from the app.",
		inputSchema: {
			type: "object",
			properties: {
				message: {
					type: "string",
					description: "commit message; the first line is the subject",
				},
				all: {
					type: "boolean",
					description: "stage tracked changes before committing (default false)",
				},
			},
			required: ["message"],
			additionalProperties: false,
		},
	},
	{
		name: "create_branch",
		description:
			"Creates a branch at the current HEAD and switches to it (`git switch -c`). Undoable from the app.",
		inputSchema: {
			type: "object",
			properties: {
				name: { type: "string", description: "new branch name" },
			},
			required: ["name"],
			additionalProperties: false,
		},
	},
	{
		name: "checkout_branch",
		description:
			"Switches the working tree to an existing branch (`git switch`). Refuses when Git refuses, for example with uncommitted changes it would overwrite. Undoable from the app.",
		inputSchema: {
			type: "object",
			properties: {
				name: { type: "string", description: "existing branch name" },
			},
			required: ["name"],
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

/** Lo stato che ogni operazione che scrive restituisce: la stessa forma di `repo_status`. */
function snapshotSummary(snapshot: Snapshot): Record<string, unknown> {
	return {
		repo: snapshot.info.root,
		name: snapshot.info.name,
		branch: snapshot.info.branch,
		detached: snapshot.info.detached,
		operation: snapshot.info.operation,
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
	};
}

/** Elenco di path: solo stringhe non vuote, nessun altro tipo accettato. */
function asPathList(value: unknown): string[] | null {
	if (!Array.isArray(value)) return null;
	const paths = value
		.filter((item): item is string => typeof item === "string")
		.map((item) => item.trim())
		.filter(Boolean);
	return paths.length > 0 ? paths : null;
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
		return text(snapshotSummary(await backend.refresh()));
	}

	if (name === "stage" || name === "unstage") {
		const paths = asPathList(args.paths);
		if (!paths)
			return failure(
				"`paths` must be a non-empty array of repository paths."
			);
		const snapshot =
			name === "stage"
				? await backend.stage(paths)
				: await backend.unstage(paths);
		return text({ paths, ...snapshotSummary(snapshot) });
	}

	if (name === "commit") {
		const message = asString(args.message);
		if (!message) return failure("`message` is required.");
		const snapshot = await backend.commit(message, args.all === true);
		return text(snapshotSummary(snapshot));
	}

	if (name === "create_branch" || name === "checkout_branch") {
		const branch = asString(args.name);
		if (!branch) return failure("`name` is required.");
		const snapshot =
			name === "create_branch"
				? await backend.createBranch(branch)
				: await backend.checkout(branch);
		return text(snapshotSummary(snapshot));
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
				"Access to a Git repository. history, show_commit, worktree_diff and blame inspect it; stage, unstage, commit, create_branch and checkout_branch modify it and are recorded in .git/githandler/mcp-audit.jsonl. Only the tools enabled in the githandler settings are exposed, and reading is always separate from writing.",
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
					`Tool "${name}" is not enabled in the githandler settings.`
				)
			);
		const writes = isWriteTool(name);
		const startedAt = new Date().toISOString();
		let result: ToolResult;
		try {
			result = await callTool(context, name, params.arguments);
		} catch (cause) {
			const message =
				cause instanceof Error ? cause.message : String(cause);
			result = failure(message);
		}
		if (writes) {
			await context.audit?.({
				timestamp: startedAt,
				tool: name,
				ok: result.isError !== true,
				arguments: auditArguments(params.arguments),
				...(result.isError ? { error: result.content[0]?.text ?? "" } : {}),
			});
		}
		return ok(id, result);
	}

	return error(id, -32601, `Method not found: ${method}`);
}
