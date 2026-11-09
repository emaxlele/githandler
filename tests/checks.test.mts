import assert from "node:assert/strict";
import { test } from "node:test";

import {
	assertCommitSha,
	checksUrl,
	parseChecks,
	summarizeChecks,
} from "../src/core/checks.ts";
import type { Account, ProviderId } from "../src/core/providers.ts";

/**
 * I controlli arrivano in quattro forme: si provano indirizzi e parser sulle risposte vere ridotte,
 * senza rete, e la regola dell'esito complessivo (basta un rosso per non essere verdi).
 */

const SHA = "c0ffee1234567890abcdefabcdefabcdefabcdef12";

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

test("l'indirizzo dei controlli cambia secondo il servizio", () => {
	assert.equal(
		checksUrl(account("github"), "a", "b", SHA, 10),
		`https://api.github.com/repos/a/b/commits/${SHA}/check-runs?per_page=10`,
	);
	assert.equal(
		checksUrl(account("gitlab"), "gruppo", "progetto", SHA, 10),
		`https://gitlab.com/api/v4/projects/gruppo%2Fprogetto/repository/commits/${SHA}/statuses?per_page=10`,
	);
	assert.equal(
		checksUrl(account("gitea"), "demo", "repo", SHA, 10),
		`https://git.example.org/api/v1/repos/demo/repo/commits/${SHA}/statuses?limit=10`,
	);
	assert.equal(
		checksUrl(account("bitbucket"), "demo", "repo", SHA, 10),
		`https://api.bitbucket.org/2.0/repositories/demo/repo/commit/${SHA}/statuses?pagelen=10`,
	);
});

test("uno SHA che non è uno SHA si ferma prima dell'indirizzo", () => {
	for (const bad of ["", "-x", "../../etc/passwd", "zzz", "123456"]) {
		assert.throws(() => assertCommitSha(bad), /SHA/, bad);
	}
	assert.equal(assertCommitSha(`  ${SHA.toUpperCase()}  `), SHA.toUpperCase());
	// il limite del numero di controlli resta dentro l'intervallo dei servizi
	assert.match(checksUrl(account("github"), "a", "b", SHA, 0), /per_page=1$/);
	assert.match(checksUrl(account("github"), "a", "b", SHA, 500), /per_page=100$/);
});

test("GitHub: check run, bozza e indirizzi", () => {
	const runs = parseChecks(account("github"), {
		total_count: 3,
		check_runs: [
			{
				name: "CI / test",
				status: "completed",
				conclusion: "success",
				details_url: "https://github.com/a/b/runs/1",
			},
			{
				name: "CI / lint",
				status: "completed",
				conclusion: "failure",
				html_url: "https://github.com/a/b/runs/2",
				output: { title: "3 errori" },
			},
			{
				name: "CI / build",
				status: "in_progress",
				conclusion: null,
				details_url: "https://evil.example.org/run",
			},
		],
	});

	assert.equal(runs.length, 3);
	assert.deepEqual(runs[0], {
		name: "CI / test",
		state: "ok",
		url: "https://github.com/a/b/runs/1",
		detail: "",
	});
	assert.equal(runs[1]!.state, "failed");
	assert.equal(runs[1]!.detail, "3 errori");
	assert.equal(runs[2]!.state, "pending");
	// un indirizzo su un altro host non si apre
	assert.equal(runs[2]!.url, "");
});

test("GitLab: elenco di status della pipeline", () => {
	const runs = parseChecks(account("gitlab"), [
		{ name: "rspec", status: "success", target_url: "https://gitlab.com/a/b/-/jobs/1" },
		{ name: "rubocop", status: "failed", description: "offese trovate" },
		{ name: "deploy", status: "manual" },
	]);
	assert.deepEqual(
		runs.map((run) => [run.name, run.state]),
		[
			["rspec", "ok"],
			["rubocop", "failed"],
			["deploy", "neutral"],
		],
	);
	assert.equal(runs[1]!.detail, "offese trovate");
});

test("Gitea: `statuses` con contesto", () => {
	const runs = parseChecks(account("gitea"), {
		state: "failure",
		statuses: [
			{ context: "ci/test", status: "success", target_url: "https://git.example.org/x" },
			{ context: "ci/lint", status: "failure" },
			{ context: "ci/skip", status: "warning" },
		],
	});
	assert.deepEqual(
		runs.map((run) => run.state),
		["ok", "failed", "neutral"],
	);
});

test("Bitbucket: `values` con stato in maiuscolo", () => {
	const runs = parseChecks(account("bitbucket"), {
		values: [
			{ key: "PIPE", name: "pipeline", state: "SUCCESSFUL", url: "https://bitbucket.org/x" },
			{ key: "BUILD", state: "FAILED", description: "test rossi" },
			{ key: "DEPLOY", state: "INPROGRESS" },
			{ key: "OLD", state: "STOPPED" },
		],
	});
	assert.deepEqual(
		runs.map((run) => run.state),
		["ok", "failed", "pending", "neutral"],
	);
	assert.equal(runs[1]!.name, "BUILD");
});

test("una risposta vuota o malformata non è un errore", () => {
	assert.deepEqual(parseChecks(account("github"), null), []);
	assert.deepEqual(parseChecks(account("github"), { check_runs: [null, 7, {}] }), []);
	assert.deepEqual(parseChecks(account("gitlab"), { values: [] }), []);
});

test("l'esito complessivo è il peggiore, e senza controlli è `none`", () => {
	const run = (state: "ok" | "failed" | "pending" | "neutral") => ({
		name: state,
		state,
		url: "",
		detail: "",
	});

	assert.equal(summarizeChecks([]).state, "none");
	assert.equal(summarizeChecks([run("ok"), run("ok")]).state, "ok");
	assert.equal(
		summarizeChecks([run("ok"), run("pending"), run("failed")]).state,
		"failed",
	);
	assert.equal(summarizeChecks([run("ok"), run("pending")]).state, "pending");
	// solo neutrali e saltati: non è verde, ma non è nemmeno un errore
	assert.equal(
		summarizeChecks([run("neutral"), run("neutral")]).state,
		"neutral",
	);

	const summary = summarizeChecks([run("ok"), run("failed"), run("pending")]);
	assert.equal(summary.total, 3);
	assert.equal(summary.ok, 1);
	assert.equal(summary.failed, 1);
	assert.equal(summary.pending, 1);
});
