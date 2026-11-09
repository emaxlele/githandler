import assert from "node:assert/strict";
import { test } from "node:test";

import {
	commentPayload,
	commentsUrl,
	parseComments,
} from "../src/core/comments.ts";
import type { Account, ProviderId } from "../src/core/providers.ts";

/**
 * La conversazione di una pull request: indirizzi per i quattro servizi, corpo del commento e
 * risposte vere ridotte ai campi che si leggono, senza rete.
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

test("la conversazione cambia indirizzo secondo il servizio", () => {
	assert.equal(
		commentsUrl(account("github"), "emaxlele", "githandler", 7),
		"https://api.github.com/repos/emaxlele/githandler/issues/7/comments?per_page=50"
	);
	assert.equal(
		commentsUrl(account("gitlab"), "gruppo", "progetto", 7),
		"https://gitlab.com/api/v4/projects/gruppo%2Fprogetto/merge_requests/7/notes?sort=asc&order_by=created_at&per_page=50"
	);
	assert.equal(
		commentsUrl(account("gitea"), "demo", "repo", 7),
		"https://git.example.org/api/v1/repos/demo/repo/issues/7/comments?limit=50"
	);
	assert.equal(
		commentsUrl(account("bitbucket"), "demo", "repo", 7),
		"https://api.bitbucket.org/2.0/repositories/demo/repo/pullrequests/7/comments?pagelen=50"
	);
	// un numero non valido non diventa un indirizzo
	assert.throws(() => commentsUrl(account("github"), "a", "b", 0));
	assert.throws(() => commentsUrl(account("github"), "a", "b", 1.5));
	// il limite resta dentro l'intervallo che i servizi accettano
	assert.match(
		commentsUrl(account("github"), "a", "b", 1, 500),
		/per_page=100$/
	);
});

test("il corpo del commento si adatta al servizio e non parte vuoto", () => {
	assert.deepEqual(commentPayload(account("github"), "  ciao  "), {
		body: "ciao",
	});
	assert.deepEqual(commentPayload(account("gitlab"), "ciao"), {
		body: "ciao",
	});
	assert.deepEqual(commentPayload(account("bitbucket"), " ciao "), {
		content: { raw: "ciao" },
	});
	assert.throws(() => commentPayload(account("github"), "   "));
	assert.throws(() => commentPayload(account("github"), "a".repeat(60_001)));
});

test("i commenti si leggono da tutte e quattro le risposte", () => {
	assert.deepEqual(
		parseComments(account("github"), [
			{
				id: 12,
				user: { login: "anna" },
				body: "  Primo commento\n",
				created_at: "2026-11-08T10:00:00Z",
				html_url: "https://github.com/o/r/pull/1#issuecomment-12",
			},
			{
				id: 13,
				user: { login: "bruno" },
				body: "Secondo",
				created_at: "2026-11-09T09:00:00Z",
			},
		]),
		[
			{
				id: "12",
				author: "anna",
				body: "Primo commento",
				createdAt: "2026-11-08T10:00:00Z",
				url: "https://github.com/o/r/pull/1#issuecomment-12",
			},
			{
				id: "13",
				author: "bruno",
				body: "Secondo",
				createdAt: "2026-11-09T09:00:00Z",
				url: "",
			},
		]
	);

	assert.deepEqual(
		parseComments(account("gitlab"), [
			// le azioni automatiche e le note di sistema non sono conversazione
			{
				id: 1,
				system: true,
				body: "added 1 commit",
				created_at: "2026-11-08T09:00:00Z",
			},
			{
				id: 2,
				author: { username: "anna", name: "Anna" },
				body: "LGTM",
				created_at: "2026-11-08T10:00:00Z",
			},
		]).map((comment) => [comment.id, comment.author, comment.body]),
		[["2", "anna", "LGTM"]]
	);

	assert.deepEqual(
		parseComments(account("gitea"), [
			{
				id: 4,
				user: { login: "carla" },
				body: "Grazie",
				created_at: "2026-11-08T11:00:00Z",
				html_url: "https://git.example.org/demo/repo/issues/3#issuecomment-4",
			},
		]).map((comment) => [comment.id, comment.author, comment.body]),
		[["4", "carla", "Grazie"]]
	);

	assert.deepEqual(
		parseComments(account("bitbucket"), {
			values: [
				{
					id: 9,
					user: { display_name: "Dario" },
					content: { raw: "Prima" },
					created_on: "2026-11-08T12:00:00Z",
					links: { html: { href: "https://bitbucket.org/demo/repo/pull-requests/3#comment-9" } },
				},
				// commento in revisione e commento cancellato: fuori dalla conversazione
				{
					id: 10,
					parent: { id: 9 },
					user: { display_name: "Dario" },
					content: { raw: "Su una riga" },
					created_on: "2026-11-08T12:01:00Z",
				},
				{
					id: 11,
					deleted: true,
					user: { display_name: "Dario" },
					content: { raw: "" },
					created_on: "2026-11-08T12:02:00Z",
				},
			],
		}),
		[
			{
				id: "9",
				author: "Dario",
				body: "Prima",
				createdAt: "2026-11-08T12:00:00Z",
				url: "https://bitbucket.org/demo/repo/pull-requests/3#comment-9",
			},
		]
	);
});

test("un commento senza testo o malformato si scarta, l'ordine resta cronologico", () => {
	const parsed = parseComments(account("github"), [
		{ id: 1, user: { login: "a" }, body: "secondo", created_at: "2026-11-09T10:00:00Z" },
		{ id: 2, user: { login: "b" }, body: "primo", created_at: "2026-11-08T10:00:00Z" },
		{ id: 3, user: { login: "c" }, body: "   ", created_at: "2026-11-09T11:00:00Z" },
		{ user: { login: "d" }, body: "senza id", created_at: "2026-11-09T12:00:00Z" },
		"riga",
		null,
	]);
	assert.deepEqual(
		parsed.map((comment) => comment.body),
		["primo", "secondo"]
	);
	// una lista assente non è un errore
	assert.deepEqual(parseComments(account("github"), null), []);
});
