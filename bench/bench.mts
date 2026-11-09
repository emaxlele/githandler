/**
 * Misura il costo reale del backend, per decidere con i numeri e non con le impressioni.
 *
 *   npm run bench                 # 20.000 commit, 20.000 file
 *   npm run bench -- --commits 50000 --files 100000
 *
 * Crea un repository temporaneo con `git fast-import` (veloce, nessun commit a mano), poi misura:
 *   - `git log` completo (processo + I/O + formattazione)
 *   - il nostro parser del log (mediana su più giri)
 *   - il layout del grafo (mediana)
 *   - `git status --porcelain=v2 -z` su N file
 *
 * Non è un test: è il misuratore che dice se e dove serve un core nativo.
 */

import { spawn } from "node:child_process";
import { mkdtemp, rm, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { performance } from "node:perf_hooks";

import { layoutGraph } from "../src/core/graph.ts";
import { logArgs, parseLog, refsArgs } from "../src/core/log.ts";
import { parseStatus, statusArgs } from "../src/core/status.ts";
import { CliGitBackend } from "../src/main/backend.ts";
import { runGit } from "../src/main/git.ts";

function arg(name: string, fallback: number): number {
	const index = process.argv.indexOf(name);
	if (index < 0) return fallback;
	const value = Number(process.argv[index + 1]);
	return Number.isFinite(value) && value > 0 ? value : fallback;
}

const commits = arg("--commits", 20_000);
const files = arg("--files", 20_000);

function median(values: number[]): number {
	const sorted = [...values].sort((a, b) => a - b);
	return sorted[Math.floor(sorted.length / 2)]!;
}

function measure<T>(runs: number, task: () => T): { result: T; ms: number } {
	const times: number[] = [];
	let result = task();
	for (let i = 0; i < runs; i++) {
		const start = performance.now();
		result = task();
		times.push(performance.now() - start);
	}
	return { result, ms: median(times) };
}

function git(cwd: string, args: string[], input?: string): Promise<void> {
	return new Promise((resolve, reject) => {
		const child = spawn("git", args, {
			cwd,
			stdio: input === undefined ? "ignore" : ["pipe", "ignore", "pipe"],
		});
		let stderr = "";
		child.stderr?.on("data", (chunk: Buffer) => {
			stderr += chunk.toString();
		});
		if (input !== undefined) {
			child.stdin!.end(input);
		}
		child.on("error", reject);
		child.on("close", (code) => {
			if (code === 0) resolve();
			else reject(new Error(`git ${args[0]} (${code}): ${stderr.trim()}`));
		});
	});
}

function fastImportStream(commitCount: number): string {
	const chunks: string[] = [];
	for (let i = 1; i <= commitCount; i++) {
		const message = `commit numero ${i} con un messaggio di lunghezza realistica`;
		const content = `export const v${i} = ${i};`;
		chunks.push(
			"commit refs/heads/main",
			`committer Autore <a@example.com> ${1_700_000_000 + i} +0100`,
			`data ${Buffer.byteLength(message)}`,
			message,
			`M 100644 inline src/file${i % 200}.ts`,
			`data ${Buffer.byteLength(content)}`,
			content,
			"",
		);
	}
	return chunks.join("\n");
}

async function createRepo(dir: string): Promise<void> {
	await git(dir, ["init", "-q", "-b", "main"]);
	// Il `git gc` automatico parte in background dopo il commit dei file e scriverebbe dentro
	// `.git/objects` mentre il benchmark sta cancellando il repository temporaneo.
	await git(dir, ["config", "gc.auto", "0"]);
	await git(dir, ["fast-import", "--quiet"], fastImportStream(commits));
}

async function addFiles(dir: string, count: number): Promise<void> {
	// File distribuiti in sottocartelle: un'unica directory con 100k voci è un caso limite
	// che non rappresenta un repository reale.
	const perDir = 500;
	for (let start = 0; start < count; start += perDir) {
		const sub = join(dir, "src", `mod${start / perDir}`);
		await mkdir(sub, { recursive: true });
		const writes: Promise<void>[] = [];
		for (let i = start; i < Math.min(start + perDir, count); i++) {
			writes.push(
				writeFile(join(sub, `file${i}.ts`), `export const f${i} = ${i};\n`),
			);
		}
		await Promise.all(writes);
	}
	await git(dir, ["add", "-A"]);
	await git(dir, [
		"-c",
		"user.name=bench",
		"-c",
		"user.email=bench@example.com",
		"commit",
		"-qm",
		"file di prova",
	]);
}

async function measureAsync<T>(
	runs: number,
	task: () => Promise<T>
): Promise<{ result: T; ms: number }> {
	const times: number[] = [];
	let result = await task();
	for (let i = 0; i < runs; i++) {
		const start = performance.now();
		result = await task();
		times.push(performance.now() - start);
	}
	return { result, ms: median(times) };
}

function fmt(ms: number): string {
	return `${ms.toFixed(1)} ms`;
}

const root = await mkdtemp(join(tmpdir(), "githandler-bench-"));

try {
	process.stdout.write(
		`Repository di prova: ${commits} commit, ${files} file\n\n`,
	);
	await createRepo(root);

	const started = performance.now();
	const log = await runGit(root, logArgs({ limit: commits }));
	const logMs = performance.now() - started;

	const parsed = measure(5, () => parseLog(log.stdout));
	const graph = measure(5, () => layoutGraph(parsed.result));
	const statusRaw = await runGit(root, statusArgs(), { allowFailure: true });
	const statusParsed = measure(5, () => parseStatus(statusRaw.stdout));

	const payload = Buffer.byteLength(log.stdout);
	process.stdout.write(
		[
			`git log (${commits} commit)      ${fmt(logMs)}   output ${(payload / 1024 / 1024).toFixed(1)} MB`,
			`parseLog                        ${fmt(parsed.ms)}   ${parsed.result.length} commit`,
			`layoutGraph                     ${fmt(graph.ms)}   ${graph.result.length} righe`,
			`parse del payload               ${(
				((parsed.ms + graph.ms) / logMs) *
				100
			).toFixed(0)}% del tempo di git log`,
			"",
		].join("\n"),
	);

	process.stdout.write("Creo i file…\n");
	const filesStart = performance.now();
	await addFiles(root, files);
	process.stdout.write(`creazione + commit             ${fmt(performance.now() - filesStart)}\n`);

	const statusStart = performance.now();
	const status = await runGit(root, statusArgs(), { allowFailure: true });
	const statusMs = performance.now() - statusStart;

	const backend = new CliGitBackend();
	await backend.open(root);
	const page = await measureAsync(5, () =>
		runGit(root, logArgs({ limit: 2000 }), { allowFailure: true })
	);
	const refsCall = await measureAsync(5, () =>
		runGit(root, refsArgs(), { allowFailure: true })
	);
	const statusCall = await measureAsync(5, () =>
		runGit(root, statusArgs(), { allowFailure: true })
	);
	const refresh = await measureAsync(5, () => backend.refresh());

	process.stdout.write(
		[
			`git status (${files} file)     ${fmt(statusMs)}   ${parseStatus(status.stdout).entries.length} modifiche`,
			`parse dello status              ${fmt(statusParsed.ms)}`,
			`pagina di storia (2000)         ${fmt(page.ms)}   come la chiede il refresh`,
			`refs                            ${fmt(refsCall.ms)}`,
			`status nel refresh              ${fmt(statusCall.ms)}`,
			`refresh completo                ${fmt(refresh.ms)}   ${refresh.result.commits.length} commit, ${refresh.result.status.entries.length} modifiche`,
			"",
		].join("\n"),
	);
} finally {
	await rm(root, { recursive: true, force: true, maxRetries: 3 });
}
