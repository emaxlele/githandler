import assert from "node:assert/strict";
import { test } from "node:test";

import { graphWidth, layoutGraph } from "../src/core/graph.ts";

test("storia lineare: una sola corsia, nessun merge", () => {
	const rows = layoutGraph([
		{ sha: "c3", parents: ["c2"] },
		{ sha: "c2", parents: ["c1"] },
		{ sha: "c1", parents: [] },
	]);

	assert.deepEqual(
		rows.map((row) => row.lane),
		[0, 0, 0]
	);
	assert.deepEqual(rows[0]!.after, ["c2"]);
	assert.deepEqual(rows[1]!.after, ["c1"]);
	assert.deepEqual(rows[2]!.after, []);
	assert.equal(rows[2]!.outgoing.length, 0);
	assert.equal(graphWidth(rows), 1);
});

test("merge a due parent: la seconda linea apre una corsia e converge", () => {
	const rows = layoutGraph([
		{ sha: "m", parents: ["a", "b"] },
		{ sha: "a", parents: ["root"] },
		{ sha: "b", parents: ["root"] },
		{ sha: "root", parents: [] },
	]);

	assert.equal(rows[0]!.lane, 0);
	assert.deepEqual(rows[0]!.after, ["a", "b"]);
	assert.deepEqual(rows[0]!.outgoing, [1]);

	assert.equal(rows[1]!.lane, 0);
	assert.deepEqual(rows[2]!.lane, 1);

	// il root è atteso da due corsie: entrambe si chiudono sul medesimo pallino
	assert.deepEqual(rows[3]!.incoming, [0, 1]);
	assert.equal(rows[3]!.lane, 0);
	assert.deepEqual(rows[3]!.after, []);
	assert.equal(graphWidth(rows), 2);
});

test("commit non collegati aprono corsie indipendenti", () => {
	const rows = layoutGraph([
		{ sha: "t1", parents: ["p1"] },
		{ sha: "t2", parents: ["p2"] },
		{ sha: "p2", parents: [] },
		{ sha: "p1", parents: [] },
	]);

	assert.equal(rows[0]!.lane, 0);
	assert.equal(rows[1]!.lane, 1);
	assert.deepEqual(rows[1]!.before, ["p1"]);
	assert.deepEqual(rows[1]!.after, ["p1", "p2"]);
	assert.deepEqual(rows[2]!.after, ["p1"]);
	assert.deepEqual(rows[3]!.after, []);
});

test("octopus: tre parent producono tre corsie", () => {
	const rows = layoutGraph([
		{ sha: "o", parents: ["a", "b", "c"] },
		{ sha: "a", parents: [] },
		{ sha: "b", parents: [] },
		{ sha: "c", parents: [] },
	]);

	assert.deepEqual(rows[0]!.outgoing, [1, 2]);
	assert.equal(rows[0]!.after.length, 3);
	assert.equal(graphWidth(rows), 3);
});
