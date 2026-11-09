import assert from "node:assert/strict";
import { test } from "node:test";

import {
	canRerunFailed,
	describeRun,
	parseWorkflowRuns,
	workflowRunActionUrl,
	workflowRunsUrl,
} from "../src/core/actions.ts";
import type { Account } from "../src/core/providers.ts";

const account: Account = {
	id: "github:github.com:emaxlele",
	provider: "github",
	label: "",
	host: "github.com",
	apiBase: "https://api.github.com",
	username: "emaxlele",
	addedAt: 1,
	oauthClientId: "",
};

test("indirizzi delle esecuzioni: lista, ri-esecuzione e annullamento", () => {
	assert.equal(
		workflowRunsUrl(account, "emaxlele", "githandler"),
		"https://api.github.com/repos/emaxlele/githandler/actions/runs?per_page=20"
	);
	// il limite viene tenuto dentro l'intervallo accettato dall'API
	assert.match(workflowRunsUrl(account, "o", "r", 0), /per_page=1$/);
	assert.match(workflowRunsUrl(account, "o", "r", 5000), /per_page=100$/);

	assert.equal(
		workflowRunActionUrl(account, "emaxlele", "githandler", "123", "rerun"),
		"https://api.github.com/repos/emaxlele/githandler/actions/runs/123/rerun"
	);
	assert.equal(
		workflowRunActionUrl(
			account,
			"emaxlele",
			"githandler",
			"123",
			"rerun-failed"
		),
		"https://api.github.com/repos/emaxlele/githandler/actions/runs/123/rerun-failed-jobs"
	);
	assert.equal(
		workflowRunActionUrl(account, "emaxlele", "githandler", "123", "cancel"),
		"https://api.github.com/repos/emaxlele/githandler/actions/runs/123/cancel"
	);
	// un id che non è numerico non deve poter diventare un pezzo di percorso
	assert.throws(
		() => workflowRunActionUrl(account, "o", "r", "../altro", "rerun"),
		/Esecuzione non valida/
	);
	assert.throws(
		() => workflowRunActionUrl(account, "o", "r", "12/../x", "cancel"),
		/Esecuzione non valida/
	);
});

test("la lista delle esecuzioni si legge anche quando i campi mancano", () => {
	const runs = parseWorkflowRuns({
		total_count: 3,
		workflow_runs: [
			{
				id: 9001,
				name: "CI",
				head_branch: "main",
				event: "push",
				status: "completed",
				conclusion: "success",
				created_at: "2026-11-09T08:00:00Z",
				html_url: "https://github.com/o/r/actions/runs/9001",
			},
			{
				id: "9002",
				display_title: "senza nome",
				head_branch: "feature/x",
				status: "in_progress",
				conclusion: null,
			},
			// id assente o non numerico: la riga si scarta, non si indovina
			{ name: "senza id", status: "completed" },
			{ id: "abc", name: "id sbagliato" },
			"strano",
		],
	});
	assert.equal(runs.length, 2);
	assert.deepEqual(runs[0], {
		id: "9001",
		name: "CI",
		branch: "main",
		event: "push",
		status: "completed",
		conclusion: "success",
		createdAt: "2026-11-09T08:00:00Z",
		url: "https://github.com/o/r/actions/runs/9001",
	});
	// senza `name` si usa il titolo; lo stato senza conclusione resta `null`
	assert.equal(runs[1]!.name, "senza nome");
	assert.equal(runs[1]!.conclusion, null);
	assert.equal(runs[1]!.branch, "feature/x");

	assert.deepEqual(parseWorkflowRuns(null), []);
	assert.deepEqual(parseWorkflowRuns({ workflow_runs: "x" }), []);
});

test("lo stato mostrato è quello che si vuole leggere", () => {
	assert.equal(
		describeRun({
			id: "1",
			name: "CI",
			branch: "main",
			event: "push",
			status: "completed",
			conclusion: "failure",
			createdAt: "",
			url: "",
		}),
		"failure"
	);
	assert.equal(
		describeRun({
			id: "1",
			name: "CI",
			branch: "main",
			event: "push",
			status: "queued",
			conclusion: null,
			createdAt: "",
			url: "",
		}),
		"queued"
	);
});

test("«riprova i falliti» solo dove c'è un fallimento da riprovare", () => {
	const base = {
		id: "1",
		name: "CI",
		branch: "main",
		event: "push",
		createdAt: "",
		url: "",
	};
	const run = (status: string, conclusion: string | null) => ({
		...base,
		status,
		conclusion,
	});
	assert.equal(canRerunFailed(run("completed", "failure")), true);
	assert.equal(canRerunFailed(run("completed", "timed_out")), true);
	assert.equal(canRerunFailed(run("completed", "startup_failure")), true);
	assert.equal(canRerunFailed(run("completed", "action_required")), true);
	assert.equal(canRerunFailed(run("completed", "success")), false);
	assert.equal(canRerunFailed(run("completed", "cancelled")), false);
	assert.equal(canRerunFailed(run("completed", "skipped")), false);
	// un'esecuzione ancora in corso non ha job falliti da riprovare
	assert.equal(canRerunFailed(run("in_progress", null)), false);
	assert.equal(canRerunFailed(run("queued", "failure")), false);
});
