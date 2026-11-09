import assert from "node:assert/strict";
import { test } from "node:test";

import {
	approvePayload,
	approveUrl,
	parseReviewSummary,
	reviewsUrl,
} from "../src/core/reviews.ts";
import type { Account, ProviderId } from "../src/core/providers.ts";

/**
 * Approvazione di una pull request: indirizzi per i quattro servizi, corpo della richiesta e
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
		{ count: 1, approvers: ["anna"], approved: true }
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
		{ count: 1, approvers: ["anna"], approved: false }
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
		{ count: 1, approvers: ["carla"], approved: true }
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
		{ count: 2, approvers: ["anna", "bruno"], approved: true }
	);
	// alcune versioni restituiscono la persona senza l'involucro `user`
	assert.deepEqual(
		parseReviewSummary(
			account("gitlab"),
			{ approved_by: [{ username: "anna" }] },
			"demo"
		),
		{ count: 1, approvers: ["anna"], approved: false }
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
		{ count: 1, approvers: ["anna"], approved: true }
	);
});

test("una risposta vuota o malformata non è un'approvazione", () => {
	for (const provider of ["github", "gitlab", "gitea", "bitbucket"] as const) {
		assert.deepEqual(
			parseReviewSummary(account(provider), null, "demo"),
			{ count: 0, approvers: [], approved: false }
		);
		assert.deepEqual(
			parseReviewSummary(account(provider), "strano", "demo"),
			{ count: 0, approvers: [], approved: false }
		);
	}
});
