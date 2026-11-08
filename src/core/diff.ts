import type { CommitFile, DiffFile, DiffHunk } from "./types.ts";

export function commitFilesArgs(sha: string): string[] {
	// `--first-parent`: un merge senza questo flag non mostra alcun file.
	return [
		"show",
		"--name-status",
		"--first-parent",
		"--format=",
		"-z",
		"--no-color",
		sha,
	];
}

export function commitDiffArgs(
	sha: string,
	parent: string | null,
	path: string
): string[] {
	const common = ["--no-color", "--no-ext-diff", "-U3"];
	return parent
		? ["diff", ...common, parent, sha, "--", path]
		: ["show", ...common, "--format=", sha, "--", path];
}

export function worktreeDiffArgs(staged: boolean, path: string): string[] {
	const args = ["diff", "--no-color", "--no-ext-diff", "-U3"];
	if (staged) args.push("--cached");
	args.push("--", path);
	return args;
}

function parseHunkHeader(line: string): DiffHunk {
	const match = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@ ?(.*)$/.exec(
		line
	);
	if (!match) {
		return {
			header: line,
			oldStart: 0,
			oldLines: 0,
			newStart: 0,
			newLines: 0,
			lines: [],
		};
	}
	return {
		header: match[5] ?? "",
		oldStart: Number(match[1]),
		oldLines: match[2] === undefined ? 1 : Number(match[2]),
		newStart: Number(match[3]),
		newLines: match[4] === undefined ? 1 : Number(match[4]),
		lines: [],
	};
}

/**
 * Parser di un unified diff relativo a **un singolo file**.
 *
 * Il path è noto a monte (lo si è chiesto a Git), quindi non viene dedotto dalla riga
 * `diff --git a/x b/x`, che è ambigua quando il path contiene spazi.
 */
export function parseDiff(raw: string, path: string): DiffFile {
	const file: DiffFile = {
		path,
		oldPath: null,
		status: "modified",
		binary: false,
		additions: 0,
		deletions: 0,
		hunks: [],
	};

	if (!raw.trim()) return file;

	if (
		/^Binary files .* differ$/m.test(raw) ||
		raw.includes("GIT binary patch")
	) {
		file.binary = true;
		file.status = "binary";
		return file;
	}

	if (/^new file mode /m.test(raw)) file.status = "added";
	else if (/^deleted file mode /m.test(raw)) file.status = "deleted";
	else if (/^rename from /m.test(raw)) file.status = "renamed";
	else if (/^copy from /m.test(raw)) file.status = "copied";

	file.oldPath =
		/^rename from (.+)$/m.exec(raw)?.[1] ??
		/^copy from (.+)$/m.exec(raw)?.[1] ??
		null;

	let hunk: DiffHunk | null = null;
	let oldNo = 0;
	let newNo = 0;

	for (const line of raw.split("\n")) {
		if (line.startsWith("@@")) {
			hunk = parseHunkHeader(line);
			file.hunks.push(hunk);
			oldNo = hunk.oldStart;
			newNo = hunk.newStart;
			continue;
		}

		// fuori da un hunk: metadati del file (`diff --git`, `index`, `---`, `+++`, …)
		if (hunk === null) {
			// `--no-index` e i file nuovi usano /dev/null al posto del lato inesistente
			if (line === "--- /dev/null") file.status = "added";
			else if (line === "+++ /dev/null") file.status = "deleted";
			continue;
		}

		if (line === "") break;

		const marker = line[0];
		const text = line.slice(1);

		if (marker === "\\") {
			hunk.lines.push({
				type: "nonewline",
				text: line,
				oldNo: null,
				newNo: null,
			});
		} else if (marker === "+") {
			hunk.lines.push({ type: "add", text, oldNo: null, newNo: newNo++ });
			file.additions++;
		} else if (marker === "-") {
			hunk.lines.push({ type: "del", text, oldNo: oldNo++, newNo: null });
			file.deletions++;
		} else if (marker === " ") {
			hunk.lines.push({
				type: "context",
				text,
				oldNo: oldNo++,
				newNo: newNo++,
			});
		} else {
			hunk = null;
		}
	}

	return file;
}

/**
 * Riscrive il diff in formato unified, per chi lo legge come testo (API per l'AI, test).
 * Il percorso non compare: è già noto a chi ha chiesto il diff.
 */
export function formatDiff(file: DiffFile): string {
	if (file.binary) return `Binary file ${file.path} differs`;
	if (file.hunks.length === 0) return "";

	const out: string[] = [];
	for (const hunk of file.hunks) {
		out.push(
			`@@ -${hunk.oldStart},${hunk.oldLines} +${hunk.newStart},${
				hunk.newLines
			} @@${hunk.header ? ` ${hunk.header}` : ""}`
		);
		for (const line of hunk.lines) {
			if (line.type === "nonewline") out.push(line.text);
			else if (line.type === "add") out.push(`+${line.text}`);
			else if (line.type === "del") out.push(`-${line.text}`);
			else out.push(` ${line.text}`);
		}
	}
	return out.join("\n");
}

/**
 * Parser di `--name-status -z`.
 * Formato: `M\0path\0`, e per rename/copy `R100\0vecchio\0nuovo\0`.
 */
export function parseNameStatus(raw: string): CommitFile[] {
	const files: CommitFile[] = [];
	const tokens = raw.split("\x00").filter((token) => token.length > 0);

	let i = 0;
	while (i < tokens.length) {
		const status = tokens[i++]!;
		if (!/^[A-Z]/.test(status)) continue;
		const code = status[0]!;
		if (code === "R" || code === "C") {
			const oldPath = tokens[i++] ?? "";
			const path = tokens[i++] ?? "";
			if (path) files.push({ path, oldPath, status: code });
		} else {
			const path = tokens[i++] ?? "";
			if (path) files.push({ path, oldPath: null, status: code });
		}
	}

	return files;
}
