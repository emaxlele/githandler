import assert from "node:assert/strict";
import { test } from "node:test";

import {
	ProgressReader,
	parseProgressLine,
	type NetworkProgress,
} from "../src/core/network.ts";

test("una riga di avanzamento diventa fase, percentuale e dettaglio", () => {
	assert.deepEqual(
		parseProgressLine(
			"Receiving objects:  42% (420/1000), 1.20 MiB | 2.00 MiB/s"
		),
		{
			phase: "Receiving objects",
			percent: 42,
			detail: "420/1000 · 1.20 MiB | 2.00 MiB/s",
		}
	);
	assert.deepEqual(
		parseProgressLine("Resolving deltas: 100% (8/8), done."),
		{
			phase: "Resolving deltas",
			percent: 100,
			detail: "8/8 · done.",
		}
	);
});

test("il prefisso remote non cambia il passo e le righe estranee si scartano", () => {
	assert.equal(
		parseProgressLine("remote: Counting objects: 3% (3/100)")?.phase,
		"Counting objects"
	);
	for (const line of [
		"",
		"remote: Enumerating objects: 5, done.",
		"From github.com:org/repo",
		"fatal: repository not found",
		"  \r",
	]) {
		assert.equal(parseProgressLine(line), null, JSON.stringify(line));
	}
});

test("percentuali fuori intervallo e colori ANSI non sorprendono", () => {
	assert.equal(parseProgressLine("Writing objects: 140%")?.percent, 100);
	assert.equal(parseProgressLine("Writing objects: -4%"), null);
	assert.equal(
		parseProgressLine("\u001b[32mCompressing objects: 7%\u001b[0m")
			?.phase,
		"Compressing objects"
	);
});

test("i pezzi arrivano anche quando la riga è divisa o aggiornata con \\r", () => {
	const seen: NetworkProgress[] = [];
	const reader = new ProgressReader((progress) => seen.push(progress));
	reader.push("Receiving obj");
	reader.push("ects:  1% (1/100)\rReceiving objects:  2% (2/100)\n");
	reader.push("Resolving deltas: 50% (1/2)");
	assert.deepEqual(
		seen.map((progress) => progress.percent),
		[1, 2]
	);

	// l'ultima riga senza separatore esiste solo alla chiusura
	reader.end();
	assert.equal(seen.length, 3);
	assert.equal(seen[2]!.phase, "Resolving deltas");
	assert.equal(seen[2]!.percent, 50);
});

test("un output senza righe complete non produce eventi", () => {
	const seen: NetworkProgress[] = [];
	const reader = new ProgressReader((progress) => seen.push(progress));
	reader.push("remote: nothing to report\r");
	reader.push("\r\n\n");
	reader.end();
	assert.deepEqual(seen, []);
});
