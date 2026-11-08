import type { Commit, Decoration, RefInfo } from "./types.ts";

/**
 * Separatori scelti per non collidere con nomi, email o messaggi:
 * \x00 fra i campi, \x1e fra i record. Git aggiunge un \n fra un record e l'altro.
 */
export const LOG_FORMAT = "%H%x00%P%x00%an%x00%ae%x00%at%x00%s%x1e";

export interface RawLogOptions {
	limit?: number;
	/** quanti commit saltare: serve al caricamento progressivo */
	skip?: number;
	all?: boolean;
}

export function logArgs(options: RawLogOptions = {}): string[] {
	const limit = options.limit ?? 5000;
	const skip = options.skip ?? 0;
	const args = ["log", "--date-order", `-n${limit}`];
	if (skip > 0) args.push(`--skip=${skip}`);
	// `--all` prende ogni ref e HEAD; i nostri ref di servizio (snapshot e trash) non sono storia
	// del progetto e non devono comparire né nella UI né nel conteggio.
	if (options.all !== false) args.push("--exclude=refs/githandler/*", "--all");
	args.push(`--pretty=format:${LOG_FORMAT}`);
	return args;
}

export function parseLog(raw: string): Commit[] {
	const commits: Commit[] = [];
	for (const chunk of raw.split("\x1e")) {
		const record = chunk.replace(/^\n+/, "");
		if (!record) continue;
		const fields = record.split("\x00");
		// Un record troncato (output interrotto) viene scartato invece di produrre dati falsi.
		if (fields.length < 6) continue;
		const [sha, parents, author, email, timestamp, subject] = fields as [
			string,
			string,
			string,
			string,
			string,
			string
		];
		if (!/^[0-9a-f]{7,64}$/.test(sha)) continue;
		commits.push({
			sha,
			parents: parents ? parents.split(" ").filter(Boolean) : [],
			author,
			email,
			timestamp: Number(timestamp) || 0,
			subject,
			refs: [],
		});
	}
	return commits;
}

/** `git for-each-ref`: una riga per ref, campi separati da NUL, record da \x1e. */
export const REFS_FORMAT =
	"%(refname)%00%(objectname)%00%(upstream:short)%00%(upstream:track)%00%(HEAD)%1e";

export function refsArgs(): string[] {
	return [
		"for-each-ref",
		`--format=${REFS_FORMAT}`,
		"refs/heads",
		"refs/remotes",
		"refs/tags",
	];
}

export function parseRefs(raw: string): RefInfo[] {
	const refs: RefInfo[] = [];
	for (const chunk of raw.split("\x1e")) {
		const record = chunk.replace(/^\n+/, "");
		if (!record) continue;
		const [full, sha, upstream, track, head] = record.split("\x00");
		if (!full || !sha) continue;

		let kind: RefInfo["kind"];
		let short: string;
		if (full.startsWith("refs/heads/")) {
			kind = "local";
			short = full.slice("refs/heads/".length);
		} else if (full.startsWith("refs/remotes/")) {
			kind = "remote";
			short = full.slice("refs/remotes/".length);
			if (short.endsWith("/HEAD")) continue;
		} else if (full.startsWith("refs/tags/")) {
			kind = "tag";
			short = full.slice("refs/tags/".length);
		} else {
			continue;
		}

		refs.push({
			name: full,
			short,
			kind,
			sha,
			upstream: upstream ? upstream : null,
			ahead: Number(/ahead (\d+)/.exec(track ?? "")?.[1] ?? 0),
			behind: Number(/behind (\d+)/.exec(track ?? "")?.[1] ?? 0),
			current: head === "*",
		});
	}
	return refs;
}

/**
 * Attacca le decorazioni ai commit per SHA invece di leggere `%D`:
 * il nome breve di un ref remoto è ambiguo ("feature/x" può essere locale), lo SHA no.
 */
export function attachRefs(commits: Commit[], refs: RefInfo[]): void {
	const bySha = new Map<string, Decoration[]>();
	for (const ref of refs) {
		const list = bySha.get(ref.sha) ?? [];
		if (ref.kind === "local" && ref.current) {
			// HEAD e il ramo corrente sono lo stesso ref: una sola etichetta.
			list.push({ kind: "head", name: ref.short, label: ref.short });
			bySha.set(ref.sha, list);
			continue;
		}
		list.push({
			kind: ref.kind,
			name: ref.short,
			label: ref.short,
		});
		bySha.set(ref.sha, list);
	}
	for (const commit of commits) {
		commit.refs = bySha.get(commit.sha) ?? [];
	}
}

/** Normalizza un timestamp Unix in millisecondi per il renderer. */
export function timestampMs(timestamp: number): number {
	return timestamp * 1000;
}
