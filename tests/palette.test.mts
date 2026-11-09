import assert from "node:assert/strict";
import { test } from "node:test";

import { rankPalette } from "../src/core/palette.ts";

const entries = [
	{ text: "Apri un repository…" },
	{ text: "Nuovo ramo" },
	{ text: "Cerca nella storia" },
	{ text: "Annulla l'ultima operazione" },
	{ text: "Fetch" },
];

const labels = (query: string): string[] =>
	rankPalette(entries, query).map((entry) => entry.text);

test("query vuota: l'ordine dato resta", () => {
	assert.deepEqual(labels(""), entries.map((entry) => entry.text));
	assert.deepEqual(labels("   "), entries.map((entry) => entry.text));
});

test("prefisso e parola intera vengono prima", () => {
	assert.equal(labels("ramo")[0], "Nuovo ramo");
	assert.equal(labels("fetch")[0], "Fetch");
	assert.equal(labels("apri")[0], "Apri un repository…");
});

test("sottosequenza: poche lettere trovano il comando", () => {
	assert.equal(labels("nuora")[0], "Nuovo ramo");
	assert.equal(labels("cersto")[0], "Cerca nella storia");
});

test("caratteri fuori ordine non trovano niente", () => {
	assert.deepEqual(labels("zzz"), []);
	assert.deepEqual(labels("xyz"), []);
});

test("accenti e maiuscole non contano", () => {
	const italian = [{ text: "Perché è così" }, { text: "Altre voci" }];
	assert.equal(rankPalette(italian, "perche")[0]!.text, "Perché è così");
	assert.equal(rankPalette(italian, "PERCHE")[0]!.text, "Perché è così");
});

test("a parità di punteggio vale l'ordine di partenza", () => {
	const same = [{ text: "beta" }, { text: "beta" }];
	assert.deepEqual(rankPalette(same, "beta"), same);
});
