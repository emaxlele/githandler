/**
 * Pull request / merge request: indirizzi, parser e corpi delle richieste nel core, rete nel main.
 *
 * I quattro servizi chiamano la stessa cosa in modi diversi: GitHub, Gitea e Bitbucket dicono «pull
 * request», GitLab «merge request»; il numero è `number`, `iid` o `id`. Qui si nasconde la differenza
 * e si tiene una sola forma, che è quella che la UI disegna e che il main riempie con la rete.
 */

import type { Account, ProviderId } from "./providers.ts";

export interface PullRequest {
	/** numero nella pagina del servizio (`number`, `iid` o `id`) */
	number: number;
	title: string;
	author: string;
	state: "open" | "closed" | "merged";
	draft: boolean;
	source: string;
	target: string;
	updatedAt: string;
	/** pagina web della pull request, sempre sull'host dell'account */
	url: string;
}

/** Elenco delle aperte, con la parola e la pagina web del servizio. */
export interface PullList {
	provider: ProviderId;
	/** la parola del servizio: «pull request» o «merge request» */
	label: string;
	/** pagina web che elenca le richieste */
	webUrl: string;
	pulls: PullRequest[];
}

export interface NewPullRequest {
	title: string;
	body: string;
	source: string;
	target: string;
}

function asRecord(value: unknown): Record<string, unknown> | null {
	return typeof value === "object" && value !== null
		? (value as Record<string, unknown>)
		: null;
}

function text(value: unknown): string {
	return typeof value === "string" ? value : "";
}

function apiBase(account: Account): string {
	return account.apiBase.replace(/\/+$/, "");
}

function perPage(limit: number): number {
	return Math.max(1, Math.min(100, Math.round(limit)));
}

/** `namespace/name` come lo vuole l'API del servizio. */
function projectPath(
	account: Account,
	namespace: string,
	name: string
): string {
	if (account.provider === "gitlab")
		return encodeURIComponent(`${namespace}/${name}`);
	return `${namespace}/${name}`;
}

/** Indirizzo che elenca le pull request aperte. */
export function pullsUrl(
	account: Account,
	namespace: string,
	name: string,
	limit = 30
): string {
	const base = apiBase(account);
	const size = perPage(limit);
	if (account.provider === "gitlab")
		return `${base}/projects/${projectPath(
			account,
			namespace,
			name
		)}/merge_requests?state=opened&per_page=${size}`;
	if (account.provider === "bitbucket")
		return `${base}/repositories/${projectPath(
			account,
			namespace,
			name
		)}/pullrequests?state=OPEN&pagelen=${size}`;
	if (account.provider === "gitea")
		return `${base}/repos/${projectPath(
			account,
			namespace,
			name
		)}/pulls?state=open&limit=${size}`;
	return `${base}/repos/${projectPath(
		account,
		namespace,
		name
	)}/pulls?state=open&per_page=${size}`;
}

/** Indirizzo per creare una pull request: la risposta è la richiesta appena aperta. */
export function createPullUrl(
	account: Account,
	namespace: string,
	name: string
): string {
	const base = apiBase(account);
	if (account.provider === "gitlab")
		return `${base}/projects/${projectPath(
			account,
			namespace,
			name
		)}/merge_requests`;
	if (account.provider === "bitbucket")
		return `${base}/repositories/${projectPath(
			account,
			namespace,
			name
		)}/pullrequests`;
	return `${base}/repos/${projectPath(account, namespace, name)}/pulls`;
}

/**
 * Nome di ramo che l'API può ricevere: niente spazi né caratteri di controllo, niente trattino
 * iniziale (diventerebbe un'opzione) e nessuna risalita di percorso.
 */
export function assertBranchRef(name: string): string {
	const trimmed = name.trim();
	if (
		!trimmed ||
		trimmed.length > 250 ||
		trimmed.startsWith("-") ||
		trimmed.includes("..") ||
		/[\x00-\x20\x7f~^:?*[\\]/.test(trimmed)
	) {
		throw new Error(`Nome di ramo non valido: ${name}`);
	}
	return trimmed;
}

/** Corpo della richiesta di creazione, nella forma del servizio. */
export function createPullPayload(
	account: Account,
	input: NewPullRequest
): Record<string, unknown> {
	const title = input.title.trim();
	if (!title) throw new Error("Il titolo della pull request è vuoto.");
	const source = assertBranchRef(input.source);
	const target = assertBranchRef(input.target);
	if (source === target)
		throw new Error(
			"Il ramo di partenza e quello di arrivo sono lo stesso."
		);
	const body = input.body.trim();

	if (account.provider === "gitlab")
		return {
			title,
			description: body,
			source_branch: source,
			target_branch: target,
		};
	if (account.provider === "bitbucket")
		return {
			title,
			description: body,
			source: { branch: { name: source } },
			destination: { branch: { name: target } },
		};
	return { title, body, head: source, base: target };
}

/** Pagina web che elenca le pull request del repository. */
export function pullsPageUrl(
	account: Account,
	namespace: string,
	name: string
): string {
	const base = `https://${account.host}/${namespace}/${name}`;
	if (account.provider === "gitlab") return `${base}/-/merge_requests`;
	if (account.provider === "bitbucket") return `${base}/pull-requests`;
	return `${base}/pulls`;
}

/**
 * Pagina web di una pull request. Un indirizzo che arriva dall'API si accetta solo se resta
 * sull'host dell'account: aprire `file://` o un altro dominio dal contenuto di una risposta non è
 * qualcosa che l'app deve fare.
 */
export function pullWebUrl(
	account: Account,
	namespace: string,
	name: string,
	number: number,
	fromApi?: string
): string {
	if (fromApi) {
		try {
			const url = new URL(fromApi);
			if (url.protocol === "https:" && url.hostname === account.host)
				return url.toString();
		} catch {
			// indirizzo non valido: si usa quello costruito qui
		}
	}
	const base = `https://${account.host}/${namespace}/${name}`;
	if (account.provider === "gitlab")
		return `${base}/-/merge_requests/${number}`;
	if (account.provider === "bitbucket")
		return `${base}/pull-requests/${number}`;
	return `${base}/pull/${number}`;
}

interface RawPull {
	number: unknown;
	title: unknown;
	author: string;
	state: unknown;
	draft: unknown;
	source: unknown;
	target: unknown;
	updatedAt: unknown;
	url: string;
	merged: boolean;
}

function normalizedState(
	value: unknown,
	merged: boolean
): PullRequest["state"] {
	if (merged) return "merged";
	const state = text(value).toLowerCase();
	if (state === "merged") return "merged";
	if (state === "open" || state === "opened") return "open";
	return "closed";
}

function assemble(
	account: Account,
	namespace: string,
	name: string,
	raw: RawPull
): PullRequest | null {
	const number =
		typeof raw.number === "number"
			? raw.number
			: Number.parseInt(text(raw.number), 10);
	if (!Number.isInteger(number) || number <= 0) return null;
	const title = text(raw.title).trim();
	if (!title) return null;
	const source = text(raw.source).trim();
	const target = text(raw.target).trim();
	return {
		number,
		title,
		author: raw.author.trim(),
		state: normalizedState(raw.state, raw.merged),
		draft: raw.draft === true,
		source,
		target,
		updatedAt: text(raw.updatedAt),
		url: pullWebUrl(account, namespace, name, number, raw.url),
	};
}

/** Legge una pull request dalla risposta di qualsiasi dei quattro servizi. */
function parseOne(
	account: Account,
	namespace: string,
	name: string,
	value: unknown
): PullRequest | null {
	const entry = asRecord(value);
	if (!entry) return null;

	if (account.provider === "gitlab") {
		const author = asRecord(entry.author);
		return assemble(account, namespace, name, {
			number: entry.iid,
			title: entry.title,
			author: text(author?.username) || text(author?.name),
			state: entry.state,
			draft: entry.draft ?? entry.work_in_progress,
			source: entry.source_branch,
			target: entry.target_branch,
			updatedAt: entry.updated_at,
			url: text(entry.web_url),
			merged: text(entry.state).toLowerCase() === "merged",
		});
	}

	if (account.provider === "bitbucket") {
		const author = asRecord(entry.author);
		const source = asRecord(asRecord(entry.source)?.branch);
		const destination = asRecord(asRecord(entry.destination)?.branch);
		const links = asRecord(asRecord(entry.links)?.html);
		return assemble(account, namespace, name, {
			number: entry.id,
			title: entry.title,
			author: text(author?.display_name) || text(author?.nickname),
			state: entry.state,
			draft: entry.draft,
			source: source?.name,
			target: destination?.name,
			updatedAt: entry.updated_on,
			url: text(links?.href),
			merged: text(entry.state).toUpperCase() === "MERGED",
		});
	}

	// GitHub e Gitea condividono quasi tutto: `user`, `head.ref`, `base.ref`, `html_url`
	const user = asRecord(entry.user);
	const head = asRecord(entry.head);
	const base = asRecord(entry.base);
	return assemble(account, namespace, name, {
		number: entry.number,
		title: entry.title,
		author: text(user?.login) || text(user?.username),
		state: entry.state,
		draft: entry.draft,
		source: head?.ref ?? entry.head,
		target: base?.ref ?? entry.base,
		updatedAt: entry.updated_at,
		url: text(entry.html_url),
		merged: entry.merged === true || text(entry.merged_at).length > 0,
	});
}

/** Le pull request della risposta, dalla più recente; le voci malformate si scartano. */
export function parsePullRequests(
	account: Account,
	namespace: string,
	name: string,
	payload: unknown
): PullRequest[] {
	const record = asRecord(payload);
	const list = Array.isArray(payload)
		? payload
		: Array.isArray(record?.values)
		? (record!.values as unknown[])
		: [];
	const pulls: PullRequest[] = [];
	for (const item of list) {
		const parsed = parseOne(account, namespace, name, item);
		if (parsed) pulls.push(parsed);
	}
	// dalla più recente; una data mancante non sposta la voce e non rompe l'ordinamento
	const when = (value: string): number => {
		const parsed = Date.parse(value);
		return Number.isFinite(parsed) ? parsed : -Infinity;
	};
	pulls.sort((a, b) => {
		const left = when(a.updatedAt);
		const right = when(b.updatedAt);
		if (left === right) return 0;
		return right - left;
	});
	return pulls;
}

/** Una sola pull request, dalla risposta della creazione. */
export function parsePullRequest(
	account: Account,
	namespace: string,
	name: string,
	payload: unknown
): PullRequest {
	const parsed = parseOne(account, namespace, name, payload);
	if (!parsed)
		throw new Error(
			"Il servizio non ha restituito una pull request riconoscibile."
		);
	return parsed;
}

/** Nome da usare nell'interfaccia: GitLab le chiama merge request. */
export function pullRequestLabel(provider: ProviderId): string {
	return provider === "gitlab" ? "merge request" : "pull request";
}
