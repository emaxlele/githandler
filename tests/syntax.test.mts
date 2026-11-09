import assert from "node:assert/strict";
import { test } from "node:test";

import {
	highlightLines,
	languageForPath,
	MAX_SYNTAX_CHARS,
} from "../src/core/syntax.ts";

/**
 * Riconoscimento della lingua e tokenizzazione del diff. I test girano sui parser veri, senza DOM:
 * quello che conta è che l'estensione scelga la sintassi giusta e che ogni intervallo riporti solo
 * classi `tok-…`, perché quelle finiscono dentro l'HTML del diff.
 */

test("l'estensione sceglie la sintassi, il resto resta testo", () => {
	assert.equal(languageForPath("src/app.ts"), "typescript");
	assert.equal(languageForPath("src/app.test.mts"), "typescript");
	assert.equal(languageForPath("web/view.jsx"), "javascript");
	assert.equal(languageForPath("conf/app.jsonc"), "json");
	assert.equal(languageForPath("style/main.scss"), "scss");
	assert.equal(languageForPath("docs/readme.md"), "markdown");
	assert.equal(languageForPath("Makefile"), null);
	assert.equal(languageForPath("LICENSE"), null);
	assert.equal(languageForPath("src/foto.png"), null);
	assert.equal(languageForPath(".gitignore"), null);

	assert.equal(languageForPath("Dockerfile"), "dockerfile");
	assert.equal(languageForPath("docker/Dockerfile.dev"), "dockerfile");
	assert.equal(languageForPath("Gemfile"), "ruby");
});

test("le parole chiave diventano intervalli con classi sicure", () => {
	const [line] = highlightLines("javascript", ["const x = 1; // nota"]);
	assert.ok(line);
	assert.ok(line.length >= 3);

	const keyword = line.find((span) => span.from === 0 && span.to === 5);
	assert.ok(keyword);
	assert.match(keyword.className, /(^| )tok-keyword( |$)/);

	for (const span of line) {
		assert.match(span.className, /^tok-[a-z0-9-]+( tok-[a-z0-9-]+)*$/i);
		assert.ok(span.to > span.from);
	}
});

test("un blocco di commento su più righe resta colorato", () => {
	const spans = highlightLines("javascript", ["/* inizio", "ancora", "fine */"]);
	assert.match(spans[1]![0]!.className, /tok-comment/);
	assert.equal(spans[1]![0]!.from, 0);
	assert.equal(spans[1]![0]!.to, "ancora".length);
});

test("una stringa spezzata fra due righe non perde la seconda parte", () => {
	const spans = highlightLines("typescript", ["const s = `prima", "seconda`;"]);
	assert.ok(spans[1]!.some((span) => /tok-string/.test(span.className)));
});

test("senza lingua, o con un testo enorme, non si tokenizza", () => {
	assert.deepEqual(highlightLines(null, ["const x = 1;"]), [[]]);
	assert.deepEqual(highlightLines("javascript", []), []);

	const huge = "x".repeat(MAX_SYNTAX_CHARS + 1);
	assert.deepEqual(highlightLines("javascript", [huge]), [[]]);
});

test("gli intervalli non escono dalla riga", () => {
	const spans = highlightLines("javascript", ["return 42;", "", "const y = 2;"]);
	spans.forEach((line, index) => {
		const length = ["return 42;", "", "const y = 2;"][index]!.length;
		for (const span of line) {
			assert.ok(span.from >= 0);
			assert.ok(span.to <= length);
		}
	});
	assert.deepEqual(spans[1], []);
});
