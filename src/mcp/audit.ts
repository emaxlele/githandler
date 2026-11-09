import { appendFile, mkdir, rename, stat } from "node:fs/promises";
import { join } from "node:path";

/**
 * Audit log of what an agent did through the MCP server.
 *
 * It lives in `.git/githandler/mcp-audit.jsonl`, next to the undo journal: one JSON object per line,
 * inside the repository it describes. Only the tools that change the repository are recorded — the
 * log is about consequences, not about every read.
 *
 * The file never grows without limit: past `AUDIT_LIMIT_BYTES` it becomes `mcp-audit.jsonl.1` and a
 * new file starts. A failed write is reported on stderr and never turns a successful Git operation
 * into an error: the repository state is the truth, the log is the record.
 */

export const AUDIT_LIMIT_BYTES = 1024 * 1024;
export const AUDIT_FILE = "mcp-audit.jsonl";

export interface AuditRecord {
	timestamp: string;
	tool: string;
	/** `false` when the tool returned an error or threw. */
	ok: boolean;
	/** Argument values already reduced to scalars and shortened. */
	arguments: Record<string, string | number | boolean | null>;
	error?: string;
}

export function auditFile(gitDir: string): string {
	return join(gitDir, "githandler", AUDIT_FILE);
}

/**
 * Only scalars survive: an argument is a path, a branch, a message. Arrays are joined, objects are
 * dropped (a tool never takes one today, and the log should not become a copy of the input), and a
 * long commit message is cut instead of filling the file.
 */
export function auditArguments(
	raw: unknown
): Record<string, string | number | boolean | null> {
	const out: Record<string, string | number | boolean | null> = {};
	if (typeof raw !== "object" || raw === null) return out;
	for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
		if (typeof value === "string") out[key] = value.slice(0, 200);
		else if (typeof value === "number" || typeof value === "boolean")
			out[key] = value;
		else if (value === null) out[key] = null;
		else if (Array.isArray(value))
			out[key] = value
				.filter(
					(item) =>
						typeof item === "string" ||
						typeof item === "number" ||
						typeof item === "boolean"
				)
				.slice(0, 50)
				.map((item) => String(item).slice(0, 100))
				.join("\n");
	}
	return out;
}

/** Appends one record, rotating the file when it is already large. */
export async function recordAudit(
	gitDir: string,
	record: AuditRecord
): Promise<void> {
	const file = auditFile(gitDir);
	try {
		await mkdir(join(gitDir, "githandler"), {
			recursive: true,
			mode: 0o700,
		});
		const size = await stat(file).then(
			(info) => info.size,
			() => 0
		);
		if (size >= AUDIT_LIMIT_BYTES) {
			await rename(file, `${file}.1`).catch(() => undefined);
		}
		await appendFile(file, `${JSON.stringify(record)}\n`, {
			mode: 0o600,
		});
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		process.stderr.write(
			`githandler mcp: audit log not written: ${message}\n`
		);
	}
}
