import assert from "node:assert/strict";
import { test } from "node:test";

import {
	assertBranchRef,
	createPullPayload,
	createPullUrl,
	parsePullRequest,
	parsePullRequests,
	pullRequestLabel,
	pullWebUrl,
	pullsPageUrl,
	pullsUrl,
} from "../src/core/pulls.ts";
import type { Account, ProviderId } from "../src/core/providers.ts";

/**
 * Le differenze fra i quattro servizi stanno tutte qui: si provano gli indirizzi, i corpi delle
 * richieste e le risposte vere (ridotte ai campi che si leggono), senza rete.
 */

function account(provider: ProviderId): Account {
	const bases: Record<ProviderId, [string, string]> = {
		github: ["github.com", "https://api.github.com"],
		gitlab: ["gitlab.com", "https://gitlab.com/api/v4"],
		gitea: ["git.example.org", "https://git.example.org/api/v1"],
		bitbucket: ["bitbucket.org", "https://api.bitbucket.org/2.0"],
	};
	const [host, apiBase] = bases[provider];
	return {
		id: `${provider}:${host}:demo`,
		provider,
		label: "",
		host,
		apiBase,
		username: "demo",
		addedAt: 0,
		oauthClientId: "",
	};
}

test("l'elenco cambia indirizzo secondo il servizio", () => {
	assert.equal(
		pullsUrl(account("github"), "emaxlele", "githandler", 10),
		"https://api.github.com/repos/emaxlele/githandler/pulls?state=open&per_page=10",
	);
	assert.equal(
		pullsUrl(account("gitlab"), "gruppo", "progetto", 10),
		"https://gitlab.com/api/v4/projects/gruppo%2Fprogetto/merge_requests?state=opened&per_page=10",
	);
	assert.equal(
		pullsUrl(account("gitea"), "demo", "repo", 10),
		"https://git.example.org/api/v1/repos/demo/repo/pulls?state=open&limit=10",
	);
	assert.equal(
		pullsUrl(account("bitbucket"), "demo", "repo", 10),
		"https://api.bitbucket.org/2.0/repositories/demo/repo/pullrequests?state=OPEN&pagelen=10",
	);
	// il limite si porta dentro l'intervallo che i servizi accettano
	assert.match(pullsUrl(account("github"), "a", "b", 0), /per_page=1$/);
	assert.match(pullsUrl(account("github"), "a", "b", 500), /per_page=100$/);
});

test("la creazione ha l'indirizzo e il corpo del servizio", () => {
	assert.equal(
		createPullUrl(account("github"), "a", "b"),
		"https://api.github.com/repos/a/b/pulls",
	);
	assert.equal(
		createPullUrl(account("gitlab"), "a", "b"),
		"https://gitlab.com/api/v4/projects/a%2Fb/merge_requests",
	);
	assert.equal(
		createPullUrl(account("bitbucket"), "a", "b"),
		"https://api.bitbucket.org/2.0/repositories/a/b/pullrequests",
	);

	const input = {
		title: "  Correggi il parser  ",
		body: "  Spiega il perché.  ",
		source: "feature/parser",
		target: "main",
	};
	assert.deepEqual(createPullPayload(account("github"), input), {
		title: "Correggi il parser",
		body: "Spiega il perché.",
		head: "feature/parser",
		base: "main",
	});
	assert.deepEqual(createPullPayload(account("gitlab"), input), {
		title: "Correggi il parser",
		description: "Spiega il perché.",
		source_branch: "feature/parser",
		target_branch: "main",
	});
	assert.deepEqual(createPullPayload(account("bitbucket"), input), {
		title: "Correggi il parser",
		description: "Spiega il perché.",
		source: { branch: { name: "feature/parser" } },
		destination: { branch: { name: "main" } },
	});
});

test("un ramo o un titolo che l'API rifiuterebbe si ferma prima", () => {
	assert.throws(
		() =>
			createPullPayload(account("github"), {
				title: "   ",
				body: "",
				source: "a",
				target: "b",
			}),
		/titolo/,
	);
	assert.throws(
		() =>
			createPullPayload(account("github"), {
				title: "x",
				body: "",
				source: "main",
				target: "main",
			}),
		/stesso/,
	);
	for (const bad of ["", "-x", "a..b", "con spazio", "a\nb", "x~1"]) {
		assert.throws(() => assertBranchRef(bad), /non valido/, bad);
	}
	assert.equal(assertBranchRef(" feature/parser "), "feature/parser");
});

test("GitHub: numero, autore, draft e stato", () => {
	const pulls = parsePullRequests(account("github"), "a", "b", [
		{
			number: 12,
			title: "Risolvi i conflitti",
			user: { login: "emaxlele" },
			state: "open",
			draft: true,
			head: { ref: "conflitti" },
			base: { ref: "main" },
			updated_at: "2026-11-09T08:00:00Z",
			html_url: "https://github.com/a/b/pull/12",
		},
		{
			number: 7,
			title: "Vecchia",
			user: { login: "altro" },
			state: "closed",
			merged_at: "2026-11-01T10:00:00Z",
			head: { ref: "vecchia" },
			base: { ref: "main" },
			updated_at: "2026-11-01T10:00:00Z",
			html_url: "https://github.com/a/b/pull/7",
		},
		{ number: "non un numero", title: "rotta" },
	]);

	assert.equal(pulls.length, 2);
	assert.deepEqual(pulls[0], {
		number: 12,
		title: "Risolvi i conflitti",
		author: "emaxlele",
		state: "open",
		draft: true,
		source: "conflitti",
		target: "main",
		updatedAt: "2026-11-09T08:00:00Z",
		url: "https://github.com/a/b/pull/12",
	});
	// unita a un commit: `merged_at` vale più dello stato
	assert.equal(pulls[1]!.state, "merged");
});

test("GitLab: `iid`, merge request e stato `opened`", () => {
	const pulls = parsePullRequests(account("gitlab"), "gruppo", "progetto", [
		{
			iid: 3,
			title: "Aggiungi la palette",
			author: { username: "demo", name: "Demo" },
			state: "opened",
			draft: false,
			source_branch: "palette",
			target_branch: "main",
			updated_at: "2026-11-09T09:00:00Z",
			web_url: "https://gitlab.com/gruppo/progetto/-/merge_requests/3",
		},
		{
			iid: 2,
			title: "Bozza",
			author: { username: "demo" },
			state: "opened",
			work_in_progress: true,
			source_branch: "bozza",
			target_branch: "main",
			updated_at: "2026-11-08T09:00:00Z",
			web_url: "https://gitlab.com/gruppo/progetto/-/merge_requests/2",
		},
	]);
	assert.equal(pulls.length, 2);
	assert.equal(pulls[0]!.source, "palette");
	assert.equal(pulls[0]!.state, "open");
	assert.equal(pulls[1]!.draft, true);
});

test("Bitbucket: `values`, nome visualizzato e stato in maiuscolo", () => {
	const pulls = parsePullRequests(account("bitbucket"), "demo", "repo", {
		values: [
			{
				id: 5,
				title: "Sistema il diff",
				author: { display_name: "Emanuele" },
				state: "MERGED",
				draft: false,
				source: { branch: { name: "diff" } },
				destination: { branch: { name: "main" } },
				updated_on: "2026-11-09T07:00:00Z",
				links: { html: { href: "https://bitbucket.org/demo/repo/pull-requests/5" } },
			},
			{
				id: 4,
				title: "Rifiutata",
				author: { nickname: "demo" },
				state: "DECLINED",
				source: { branch: { name: "x" } },
				destination: { branch: { name: "main" } },
				updated_on: "2026-11-08T07:00:00Z",
			},
		],
	});
	assert.equal(pulls.length, 2);
	assert.equal(pulls[0]!.state, "merged");
	assert.equal(pulls[0]!.author, "Emanuele");
	assert.equal(pulls[1]!.state, "closed");
	assert.equal(pulls[1]!.author, "demo");
	// senza indirizzo nella risposta se ne costruisce uno sull'host dell'account
	assert.equal(
		pulls[1]!.url,
		"https://bitbucket.org/demo/repo/pull-requests/4",
	);
});

test("una risposta con un solo elemento si legge come creazione", () => {
	const pull = parsePullRequest(account("github"), "a", "b", {
		number: 13,
		title: "Nuova",
		user: { login: "demo" },
		state: "open",
		head: { ref: "nuova" },
		base: { ref: "main" },
	});
	assert.equal(pull.number, 13);
	assert.equal(pull.url, "https://github.com/a/b/pull/13");

	assert.throws(
		() => parsePullRequest(account("github"), "a", "b", { nope: true }),
		/riconoscibile/,
	);
	assert.deepEqual(parsePullRequests(account("github"), "a", "b", null), []);
});

test("un indirizzo dell'API su un altro host non si apre", () => {
	const accountGitHub = account("github");
	const pull = parsePullRequest(accountGitHub, "a", "b", {
		number: 9,
		title: "x",
		user: { login: "demo" },
		state: "open",
		head: { ref: "x" },
		base: { ref: "main" },
		html_url: "file:///etc/passwd",
	});
	assert.equal(pull.url, "https://github.com/a/b/pull/9");

	const otherHost = parsePullRequest(accountGitHub, "a", "b", {
		number: 9,
		title: "x",
		user: { login: "demo" },
		state: "open",
		head: { ref: "x" },
		base: { ref: "main" },
		html_url: "https://evil.example.org/a/b/pull/9",
	});
	assert.equal(otherHost.url, "https://github.com/a/b/pull/9");

	assert.equal(
		pullWebUrl(accountGitHub, "a", "b", 9, "https://github.com/a/b/pull/9"),
		"https://github.com/a/b/pull/9",
	);
});

test("l'elenco va dalla più recente e le date mancanti restano al loro posto", () => {
	const pulls = parsePullRequests(account("github"), "a", "b", [
		{
			number: 1,
			title: "senza data",
			state: "open",
			head: { ref: "a" },
			base: { ref: "main" },
		},
		{
			number: 2,
			title: "vecchia",
			state: "open",
			head: { ref: "b" },
			base: { ref: "main" },
			updated_at: "2026-11-01T00:00:00Z",
		},
		{
			number: 3,
			title: "recente",
			state: "open",
			head: { ref: "c" },
			base: { ref: "main" },
			updated_at: "2026-11-09T00:00:00Z",
		},
	]);
	assert.deepEqual(
		pulls.map((pull) => pull.number),
		[3, 2, 1],
	);
});

test("indirizzi web: elenco e nomi per l'interfaccia", () => {
	assert.equal(
		pullsPageUrl(account("github"), "a", "b"),
		"https://github.com/a/b/pulls",
	);
	assert.equal(
		pullsPageUrl(account("gitlab"), "a", "b"),
		"https://gitlab.com/a/b/-/merge_requests",
	);
	assert.equal(
		pullsPageUrl(account("bitbucket"), "a", "b"),
		"https://bitbucket.org/a/b/pull-requests",
	);
	assert.equal(pullRequestLabel("gitlab"), "merge request");
	assert.equal(pullRequestLabel("github"), "pull request");
});
