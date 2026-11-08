import { createInterface } from "node:readline";

import { CliGitBackend } from "../main/backend.ts";
import { loadSettings } from "../main/settings.ts";
import { handleRequest, type JsonRpcResponse } from "./server.ts";

/**
 * Trasporto stdio del server MCP: una richiesta JSON per riga, una risposta per riga.
 * Nessuna dipendenza esterna, nessun processo figlio: il server apre il repository con lo stesso
 * `CliGitBackend` della UI.
 */
const argv = process.argv.slice(2);
const argValue = (name: string): string | null => {
	const index = argv.indexOf(name);
	return index >= 0 ? argv[index + 1] ?? null : null;
};

function respond(response: JsonRpcResponse): void {
	process.stdout.write(`${JSON.stringify(response)}\n`);
}

async function main(): Promise<void> {
	const repo =
		argValue("--repo") ?? process.env.GITCRAFT_REPO ?? process.cwd();
	const backend = new CliGitBackend({ settings: loadSettings });

	try {
		await backend.open(repo);
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		process.stderr.write(`gitcraft mcp: ${message}\n`);
		process.exitCode = 2;
		return;
	}

	const lines = createInterface({
		input: process.stdin,
		crlfDelay: Infinity,
	});

	let queue: Promise<void> = Promise.resolve();

	lines.on("line", (line) => {
		const trimmed = line.trim();
		if (!trimmed) return;
		queue = queue
			.then(async () => {
				let request: unknown;
				try {
					request = JSON.parse(trimmed);
				} catch {
					respond({
						jsonrpc: "2.0",
						id: null,
						error: { code: -32700, message: "Parse error" },
					});
					return;
				}
				const response = await handleRequest(
					{ backend, repo, settings: loadSettings },
					request
				);
				if (response) respond(response);
			})
			.catch((error: unknown) => {
				const message =
					error instanceof Error ? error.message : String(error);
				process.stderr.write(`gitcraft mcp: ${message}\n`);
			});
	});

	lines.on("close", () => {
		void queue.finally(() => process.exit(0));
	});
}

void main().catch((error: unknown) => {
	const message = error instanceof Error ? error.message : String(error);
	process.stderr.write(`gitcraft mcp: ${message}\n`);
	process.exit(1);
});
