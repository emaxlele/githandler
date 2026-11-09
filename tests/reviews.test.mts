import assert from "node:assert/strict";
import { test } from "node:test";

import {
	approvePayload,
	approveUrl,
	parseReviewSummary,
	reviewActionRequest,
	reviewsUrl,
	supportsReviewAction,
} from "../src/core/reviews.ts";
import type { Account, ProviderId } from "../src/core/providers.ts";

/**
 * Revisioni di una pull request: indirizzi per i quattro servizi, corpo delle richieste e risposte
 * vere ridotte ai campi che si leggono, senza rete.
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

test("lo stato e l'approvazione cambiano indirizzo secondo il servizio", () => {
	assert.equal(
		reviewsUrl(account("github"), "emaxlele", "githandler", 7),
		"https://api.github.com/repos/emaxlele/githandler/pulls/7/reviews?per_page=100"
	);
	assert.equal(
		reviewsUrl(account("gitea"), "demo", "repo", 7),
		"https://git.example.org/api/v1/repos/demo/repo/pulls/7/reviews?limit=100"
	);
	assert.equal(
		reviewsUrl(account("gitlab"), "gruppo", "progetto", 7),
		"https://gitlab.com/api/v4/projects/gruppo%2Fprogetto/merge_requests/7/approvals"
	);
	assert.equal(
		reviewsUrl(account("bitbucket"), "demo", "repo", 7),
		"https://api.bitbucket.org/2.0/repositories/demo/repo/pullrequests/7"
	);
	assert.throws(() => reviewsUrl(account("github"), "a", "b", 0));

	assert.equal(
		approveUrl(account("github"), "o", "r", 3),
		"https://api.github.com/repos/o/r/pulls/3/reviews"
	);
	assert.equal(
		approveUrl(account("gitea"), "o", "r", 3),
		"https://git.example.org/api/v1/repos/o/r/pulls/3/reviews"
	);
	assert.equal(
		approveUrl(account("gitlab"), "o", "r", 3),
		"https://gitlab.com/api/v4/projects/o%2Fr/merge_requests/3/approve"
	);
	assert.equal(
		approveUrl(account("bitbucket"), "o", "r", 3),
		"https://api.bitbucket.org/2.0/repositories/o/r/pullrequests/3/approve"
	);
	assert.throws(() => approveUrl(account("github"), "o", "r", -1));
});

test("solo GitHub e Gitea vogliono un corpo per approvare", () => {
	assert.deepEqual(approvePayload(account("github")), { event: "APPROVE" });
	// Gitea si aspetta il participio, GitHub l'imperativo
	assert.deepEqual(approvePayload(account("gitea")), { event: "APPROVED" });
	assert.equal(approvePayload(account("gitlab")), null);
	assert.equal(approvePayload(account("bitbucket")), null);
});

test("solo le azioni che il servizio offre all'autore sono proposte", () => {
	// GitLab non ha lo stato «modifiche richieste»
	assert.equal(supportsReviewAction("gitlab", "request-changes"), false);
	for (const provider of ["github", "gitea", "bitbucket"] as const) {
		assert.equal(supportsReviewAction(provider, "request-changes"), true);
	}

	// GitHub e Gitea richiedono permessi da maintainer per dismissare una review
	assert.equal(supportsReviewAction("github", "withdraw-approval"), false);
	assert.equal(supportsReviewAction("gitea", "withdraw-approval"), false);
	assert.equal(supportsReviewAction("gitlab", "withdraw-approval"), true);
	assert.equal(supportsReviewAction("bitbucket", "withdraw-approval"), true);
});

test("chiedere modifiche usa la review dove esiste, l'endpoint dedicato su Bitbucket", () => {
	assert.deepEqual(
		reviewActionRequest(
			account("github"),
			"o",
			"r",
			5,
			"request-changes",
			"  manca il test  "
		),
		{
			url: "https://api.github.com/repos/o/r/pulls/5/reviews",
			method: "POST",
			body: { event: "REQUEST_CHANGES", body: "manca il test" },
		}
	);
	assert.deepEqual(
		reviewActionRequest(
			account("gitea"),
			"o",
			"r",
			5,
			"request-changes",
			"manca il test"
		),
		{
			url: "https://git.example.org/api/v1/repos/o/r/pulls/5/reviews",
			method: "POST",
			body: { event: "REQUEST_CHANGES", body: "manca il test" },
		}
	);
	// Bitbucket non allega il testo e ha un verbo suo
	assert.deepEqual(
		reviewActionRequest(
			account("bitbucket"),
			"o",
			"r",
			5,
			"request-changes",
			"ignorato"
		),
		{
			url: "https://api.bitbucket.org/2.0/repositories/o/r/pullrequests/5/request-changes",
			method: "POST",
			body: null,
		}
	);

	// il servizio che non ha lo stato non produce una richiesta
	assert.equal(
		reviewActionRequest(account("gitlab"), "o", "r", 5, "request-changes", "x"),
		null
	);
});

test("il messaggio di «chiedi modifiche» è obbligatorio e limitato", () => {
	assert.throws(
		() =>
			reviewActionRequest(account("github"), "o", "r", 5, "request-changes", "   "),
		/motivo delle modifiche/
	);
	assert.throws(
		() =>
			reviewActionRequest(
				account("gitea"),
				"o",
				"r",
				5,
				"request-changes",
				"x".repeat(60_001)
			),
		/60\.000/
	);
	// il numero resta validato prima della rete
	assert.throws(() =>
		reviewActionRequest(account("github"), "o", "r", 0, "request-changes", "x")
	);
});

test("ritirare l'approvazione è un POST su GitLab e un DELETE su Bitbucket", () => {
	assert.deepEqual(
		reviewActionRequest(account("gitlab"), "gruppo", "progetto", 9, "withdraw-approval"),
		{
			url: "https://gitlab.com/api/v4/projects/gruppo%2Fprogetto/merge_requests/9/unapprove",
			method: "POST",
			body: null,
		}
	);
	assert.deepEqual(
		reviewActionRequest(account("bitbucket"), "o", "r", 9, "withdraw-approval"),
		{
			url: "https://api.bitbucket.org/2.0/repositories/o/r/pullrequests/9/approve",
			method: "DELETE",
			body: null,
		}
	);
	assert.equal(
		reviewActionRequest(account("github"), "o", "r", 9, "withdraw-approval"),
		null
	);
	assert.equal(
		reviewActionRequest(account("gitea"), "o", "r", 9, "withdraw-approval"),
		null
	);
});

test("le approvazioni si leggono da tutte e quattro le risposte", () => {
	assert.deepEqual(
		parseReviewSummary(
			account("github"),
			[
				{ user: { login: "anna" }, state: "APPROVED" },
				{ user: { login: "bruno" }, state: "COMMENTED" },
				// la stessa persona non conta due volte, anche con più review
				{ user: { login: "anna" }, state: "APPROVED" },
			],
			"anna"
		),
		{
			count: 1,
			approvers: ["anna"],
			approved: true,
			changesRequested: [],
		}
	);
	assert.deepEqual(
		parseReviewSummary(
			account("github"),
			[
				{ user: { login: "anna" }, state: "APPROVED" },
				{ user: { login: "bruno" }, state: "DISMISSED" },
			],
			"demo"
		),
		{
			count: 1,
			approvers: ["anna"],
			approved: false,
			changesRequested: [],
		}
	);

	assert.deepEqual(
		parseReviewSummary(
			account("gitea"),
			[
				{ user: { login: "carla" }, state: "APPROVED", dismissed: false },
				{ user: { login: "dario" }, state: "APPROVED", dismissed: true },
				{ user: { login: "emma" }, state: "REQUEST_CHANGES" },
			],
			"carla"
		),
		{
			count: 1,
			approvers: ["carla"],
			approved: true,
			changesRequested: ["emma"],
		}
	);

	assert.deepEqual(
		parseReviewSummary(
			account("gitlab"),
			{
				approved_by: [
					{ user: { username: "anna" } },
					{ user: { username: "bruno" } },
				],
			},
			"bruno"
		),
		{
			count: 2,
			approvers: ["anna", "bruno"],
			approved: true,
			changesRequested: [],
		}
	);
	// alcune versioni restituiscono la persona senza l'involucro `user`
	assert.deepEqual(
		parseReviewSummary(
			account("gitlab"),
			{ approved_by: [{ username: "anna" }] },
			"demo"
		),
		{
			count: 1,
			approvers: ["anna"],
			approved: false,
			changesRequested: [],
		}
	);

	assert.deepEqual(
		parseReviewSummary(
			account("bitbucket"),
			{
				participants: [
					{ user: { nickname: "anna" }, approved: true },
					{ user: { display_name: "Bruno" }, approved: false },
				],
			},
			"Anna"
		),
		{
			count: 1,
			approvers: ["anna"],
			approved: true,
			changesRequested: [],
		}
	);
});

test("l'ultima review di ogni persona decide lo stato", () => {
	// chi ha approvato e poi chiesto modifiche non è più un'approvazione
	assert.deepEqual(
		parseReviewSummary(
			account("github"),
			[
				{ user: { login: "anna" }, state: "APPROVED" },
				{ user: { login: "anna" }, state: "CHANGES_REQUESTED" },
			],
			"demo"
		),
		{
			count: 0,
			approvers: [],
			approved: false,
			changesRequested: ["anna"],
		}
	);
	// e il contrario vale ugualmente
	assert.deepEqual(
		parseReviewSummary(
			account("github"),
			[
				{ user: { login: "anna" }, state: "CHANGES_REQUESTED" },
				{ user: { login: "anna" }, state: "APPROVED" },
			],
			"anna"
		),
		{
			count: 1,
			approvers: ["anna"],
			approved: true,
			changesRequested: [],
		}
	);
	// una review ritirata dal servizio non conta
	assert.deepEqual(
		parseReviewSummary(
			account("gitea"),
			[
				{ user: { login: "anna" }, state: "APPROVED", dismissed: false },
				{ user: { login: "bruno" }, state: "CHANGES_REQUESTED", dismissed: true },
			],
			"demo"
		),
		{
			count: 1,
			approvers: ["anna"],
			approved: false,
			changesRequested: [],
		}
	);
});

test("Bitbucket riporta le modifiche richieste nei partecipanti", () => {
	assert.deepEqual(
		parseReviewSummary(
			account("bitbucket"),
			{
				participants: [
					{ user: { nickname: "anna" }, state: "changes_requested" },
					// un'approvazione precedente non vale più dopo la richiesta di modifiche
					{ user: { nickname: "bruno" }, approved: true },
				],
			},
			"demo"
		),
		{
			count: 1,
			approvers: ["bruno"],
			approved: false,
			changesRequested: ["anna"],
		}
	);
});

test("una risposta vuota o malformata non è un'approvazione", () => {
	const empty = {
		count: 0,
		approvers: [],
		approved: false,
		changesRequested: [],
	};
	for (const provider of ["github", "gitlab", "gitea", "bitbucket"] as const) {
		assert.deepEqual(parseReviewSummary(account(provider), null, "demo"), empty);
		assert.deepEqual(
			parseReviewSummary(account(provider), "strano", "demo"),
			empty
		);
	}
});
