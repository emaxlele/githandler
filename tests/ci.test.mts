import assert from "node:assert/strict";
import { test } from "node:test";

import { createCiState, isCiFailure, newFailures } from "../src/core/ci.ts";
import type { WorkflowRun } from "../src/core/actions.ts";

/**
 * Le notifiche si provano sulla regola pura: primo giro silenzioso, poi un avviso per ogni
 * esecuzione che diventa un errore, mai due volte lo stesso esito.
 */

function run(id: string, conclusion: string | null): WorkflowRun {
	return {
		id,
		name: `CI ${id}`,
		branch: "main",
		event: "push",
		status: conclusion ? "completed" : "in_progress",
		conclusion,
		createdAt: "2026-11-09T10:00:00Z",
		url: `https://github.com/a/b/actions/runs/${id}`,
	};
}

test("solo gli esiti rossi meritano un avviso", () => {
	assert.equal(isCiFailure("failure"), true);
	assert.equal(isCiFailure("timed_out"), true);
	assert.equal(isCiFailure("startup_failure"), true);
	assert.equal(isCiFailure("action_required"), true);
	assert.equal(isCiFailure("success"), false);
	assert.equal(isCiFailure("skipped"), false);
	assert.equal(isCiFailure("cancelled"), false);
	assert.equal(isCiFailure(null), false);
});

test("il primo giro è una fotografia: nessun avviso per il passato", () => {
	const state = createCiState();
	assert.deepEqual(newFailures(state, [run("1", "failure")]), []);
	// anche un repository senza esecuzioni non rende il secondo giro un primo giro
	const empty = createCiState();
	assert.deepEqual(newFailures(empty, []), []);
	assert.deepEqual(newFailures(empty, [run("1", "failure")]), [run("1", "failure")]);
});

test("un'esecuzione che passa da in corso a errore avvisa una volta sola", () => {
	const state = createCiState();
	newFailures(state, [run("1", null)]);
	const first = newFailures(state, [run("1", "failure")]);
	assert.deepEqual(first.map((entry) => entry.id), ["1"]);
	assert.deepEqual(newFailures(state, [run("1", "failure")]), []);
	// tornare verde e poi di nuovo rosso è un fatto nuovo
	newFailures(state, [run("1", "success")]);
	assert.deepEqual(
		newFailures(state, [run("1", "failure")]).map((entry) => entry.id),
		["1"],
	);
});

test("una nuova esecuzione fallita avvisa, un successo no", () => {
	const state = createCiState();
	newFailures(state, [run("1", "success")]);
	const found = newFailures(state, [
		run("1", "success"),
		run("2", "failure"),
		run("3", "success"),
	]);
	assert.deepEqual(found.map((entry) => entry.id), ["2"]);
	// l'esecuzione sparita non resta nella mappa: non cresce senza limite
	newFailures(state, [run("2", "failure")]);
	assert.equal(state.seen.size, 1);
});
