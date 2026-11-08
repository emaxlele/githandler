import assert from "node:assert/strict";
import { test } from "node:test";

import { attachRefs, parseLog, parseRefs } from "../src/core/log.ts";

const raw = [
	"aaaa1111\x00\x00Ana\x00ana@example.com\x001700000000\x00Primo commit\x1e",
	"bbbb2222\x00aaaa1111\x00Bob\x00bob@example.com\x001700000100\x00Secondo commit con spazi\x1e",
	"cccc3333\x00bbbb2222 aaaa1111\x00Cy\x00cy@example.com\x001700000200\x00Merge\x1e",
].join("\n");

test("parseLog legge hash, parent, autore, timestamp e oggetto", () => {
	const commits = parseLog(raw);
	assert.equal(commits.length, 3);

	assert.deepEqual(commits[0]!.parents, []);
	assert.equal(commits[0]!.author, "Ana");
	assert.equal(commits[0]!.subject, "Primo commit");
	assert.equal(commits[0]!.timestamp, 1700000000);

	assert.deepEqual(commits[1]!.parents, ["aaaa1111"]);
	assert.equal(commits[1]!.subject, "Secondo commit con spazi");

	assert.deepEqual(commits[2]!.parents, ["bbbb2222", "aaaa1111"]);
});

test("parseLog scarta i record troncati invece di inventare dati", () => {
	const commits = parseLog(
		"aaaa1111\x00\x00Ana\x1e\nbbbb2222\x00\x00Bob\x00b\x001\x00ok\x1e"
	);
	assert.equal(commits.length, 1);
	assert.equal(commits[0]!.sha, "bbbb2222");
});

test("parseRefs distingue locali, remoti e tag", () => {
	const refs = parseRefs(
		[
			"refs/heads/main\x00sha1\x00origin/main\x00[ahead 2, behind 1]\x00*\x1e",
			"refs/remotes/origin/main\x00sha1\x00\x00\x00 \x1e",
			"refs/remotes/origin/HEAD\x00sha1\x00\x00\x00 \x1e",
			"refs/tags/v1.0\x00sha2\x00\x00\x00 \x1e",
		].join("\n")
	);

	assert.equal(refs.length, 3);
	assert.deepEqual(
		refs.map((ref) => [ref.short, ref.kind, ref.current]),
		[
			["main", "local", true],
			["origin/main", "remote", false],
			["v1.0", "tag", false],
		]
	);
	assert.equal(refs[0]!.upstream, "origin/main");
	assert.equal(refs[0]!.ahead, 2);
	assert.equal(refs[0]!.behind, 1);
});

test("attachRefs collega le decorazioni per SHA", () => {
	const commits = parseLog(raw);
	const refs = parseRefs(
		"refs/heads/main\x00bbbb2222\x00\x00\x00*\x1e\nrefs/tags/v1\x00aaaa1111\x00\x00\x00 \x1e"
	);
	attachRefs(commits, refs);

	assert.deepEqual(commits[0]!.refs, [
		{ kind: "tag", name: "v1", label: "v1" },
	]);
	assert.deepEqual(
		commits[1]!.refs.map((ref) => ref.kind),
		["head"]
	);
	assert.deepEqual(commits[2]!.refs, []);
});
