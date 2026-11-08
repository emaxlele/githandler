import type { StatusEntry, StatusKind, WorkingTree } from "./types.ts";

export function statusArgs(): string[] {
	return [
		"status",
		"--porcelain=v2",
		"-z",
		"--branch",
		"--untracked-files=all",
	];
}

/** Codici `--porcelain=v2`: X = index, Y = working tree, `.` = invariato. */
function describe(index: string, worktree: string): string {
	const code = worktree !== "." ? worktree : index;
	switch (code) {
		case "A":
			return "Nuovo";
		case "M":
			return "Modificato";
		case "D":
			return "Eliminato";
		case "R":
			return "Rinominato";
		case "C":
			return "Copiato";
		case "T":
			return "Tipo cambiato";
		case "U":
			return "Conflitto";
		default:
			return code;
	}
}

function kindOf(index: string, worktree: string): StatusKind {
	const code = worktree !== "." ? worktree : index;
	if (code === "R") return "renamed";
	if (code === "U" || (index === "U" && worktree !== "U")) return "unmerged";
	return "changed";
}

/**
 * Parser di `git status --porcelain=v2 -z`.
 *
 * In modalità `-z` ogni record è terminato da NUL; le righe di intestazione (`# …`) possono
 * arrivare NUL-separate o newline-separate secondo la versione di Git: entrambe le forme sono
 * gestite. Per le rinominazioni, il path originale è il token successivo.
 */
export function parseStatus(raw: string): WorkingTree {
	const tree: WorkingTree = {
		oid: null,
		branch: null,
		upstream: null,
		ahead: 0,
		behind: 0,
		entries: [],
	};

	const tokens = raw.split("\x00");
	for (let i = 0; i < tokens.length; i++) {
		const token = tokens[i]!;
		if (!token) continue;

		const lines = token.split("\n");
		let cursor = 0;
		while (cursor < lines.length && lines[cursor]!.startsWith("# ")) {
			readHeader(tree, lines[cursor]!.slice(2));
			cursor++;
		}
		if (cursor >= lines.length) continue;

		const entry = readEntry(lines.slice(cursor).join("\n"), tokens, i);
		if (entry) {
			tree.entries.push(entry);
			if (entry.consumedNext) i++;
		}
	}

	return tree;
}

function readHeader(tree: WorkingTree, header: string): void {
	const [key, ...rest] = header.split(" ");
	const value = rest.join(" ");
	switch (key) {
		case "branch.oid":
			tree.oid = value === "(initial)" ? null : value;
			break;
		case "branch.head":
			tree.branch = value === "(detached)" ? null : value;
			break;
		case "branch.upstream":
			tree.upstream = value;
			break;
		case "branch.ab": {
			const ahead = /\+(\d+)/.exec(value)?.[1];
			const behind = /-(\d+)/.exec(value)?.[1];
			tree.ahead = Number(ahead ?? 0);
			tree.behind = Number(behind ?? 0);
			break;
		}
	}
}

interface EntryWithNext extends StatusEntry {
	consumedNext: boolean;
}

function readEntry(
	line: string,
	tokens: string[],
	index: number
): EntryWithNext | null {
	const consumed: EntryWithNext = {
		path: "",
		origPath: null,
		index: ".",
		worktree: ".",
		kind: "changed",
		label: "",
		consumedNext: false,
	};

	if (line.startsWith("? ")) {
		consumed.path = line.slice(2);
		consumed.kind = "untracked";
		consumed.label = "Non tracciato";
		return consumed;
	}
	if (line.startsWith("! ")) {
		consumed.path = line.slice(2);
		consumed.kind = "ignored";
		consumed.label = "Ignorato";
		return consumed;
	}

	if (line.startsWith("1 ")) {
		// 1 XY sub mH mI mW hH hI path
		const parts = line.split(" ");
		if (parts.length < 9) return null;
		const xy = parts[1]!;
		consumed.index = xy[0]!;
		consumed.worktree = xy[1]!;
		consumed.path = parts.slice(8).join(" ");
	} else if (line.startsWith("2 ")) {
		// 2 XY sub mH mI mW hH hI Xscore path  (origPath nel token successivo)
		const parts = line.split(" ");
		if (parts.length < 10) return null;
		const xy = parts[1]!;
		consumed.index = xy[0]!;
		consumed.worktree = xy[1]!;
		consumed.path = parts.slice(9).join(" ");
		consumed.origPath = tokens[index + 1] ?? null;
		consumed.consumedNext = true;
	} else if (line.startsWith("u ")) {
		// u XY sub m1 m2 m3 mW h1 h2 h3 path
		const parts = line.split(" ");
		if (parts.length < 11) return null;
		const xy = parts[1]!;
		consumed.index = xy[0]!;
		consumed.worktree = xy[1]!;
		consumed.path = parts.slice(10).join(" ");
		consumed.kind = "unmerged";
		consumed.label = "Conflitto";
		return consumed;
	} else {
		return null;
	}

	consumed.kind = kindOf(consumed.index, consumed.worktree);
	consumed.label = describe(consumed.index, consumed.worktree);
	return consumed;
}
