/**
 * Parser di `git blame --line-porcelain`.
 *
 * Il formato ripete i metadati per ogni riga (a differenza di `--porcelain`), quindi non serve
 * ricordare l'ultimo blocco: ogni riga è autosufficiente e un output troncato non produce dati
 * attribuiti alla riga sbagliata.
 */

export interface BlameLine {
	commit: string;
	author: string;
	email: string;
	timestamp: number;
	summary: string;
	/** numero di riga nel file (1-based) */
	line: number;
	text: string;
}

export interface BlameFile {
	path: string;
	lines: BlameLine[];
}

/** SHA dell'ultima modifica non ancora committata. */
export const UNCOMMITTED_SHA = "0".repeat(40);

export function blameArgs(
	path: string,
	start?: number,
	end?: number
): string[] {
	const args = ["blame", "--line-porcelain"];
	if (start !== undefined) args.push(`-L${start},${end ?? start}`);
	args.push("--", path);
	return args;
}

const HEADER = /^\^?([0-9a-f]{40,64}) (\d+) (\d+)(?: (\d+))?$/;

export function parseBlame(raw: string, path: string): BlameFile {
	const lines: BlameLine[] = [];

	let commit = "";
	let author = "";
	let email = "";
	let timestamp = 0;
	let summary = "";
	let line = 0;
	let inRecord = false;

	for (const row of raw.split("\n")) {
		const header = HEADER.exec(row);
		if (header) {
			commit = header[1]!;
			line = Number(header[3]);
			author = "";
			email = "";
			timestamp = 0;
			summary = "";
			inRecord = true;
			continue;
		}

		if (!inRecord) continue;

		if (row.startsWith("\t")) {
			lines.push({
				commit,
				author,
				email,
				timestamp,
				summary,
				line,
				text: row.slice(1),
			});
			inRecord = false;
			continue;
		}

		if (row.startsWith("author ")) author = row.slice("author ".length);
		else if (row.startsWith("author-mail ")) {
			email = row
				.slice("author-mail ".length)
				.replace(/^</, "")
				.replace(/>$/, "");
		} else if (row.startsWith("author-time ")) {
			timestamp = Number(row.slice("author-time ".length)) || 0;
		} else if (row.startsWith("summary ")) {
			summary = row.slice("summary ".length);
		}
	}

	return { path, lines };
}
