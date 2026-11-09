import assert from "node:assert/strict";
import { test } from "node:test";

import { catalogue, resolveLocale, setLocale, t } from "../src/renderer/i18n.ts";

/**
 * The catalogue is the only source of user-visible English text, so it must stay complete and
 * consistent. `setLocale` only touches the DOM when a document exists, which lets these tests run
 * under Node.
 */

test("italiano: il testo passa invariato", () => {
	setLocale("it");
	assert.equal(t("Apri"), "Apri");
	assert.equal(t("Nessun repository aperto."), "Nessun repository aperto.");
	assert.equal(t("testo che non esiste"), "testo che non esiste");
});

test("inglese: traduzione esatta e testo sconosciuto invariato", () => {
	setLocale("en");
	assert.equal(t("Apri"), "Open");
	assert.equal(t("Nessun repository aperto."), "No repository open.");
	assert.equal(t("testo che non esiste"), "testo che non esiste");
	setLocale("it");
});

test("inglese: i segnaposto seguono l'ordine dei valori", () => {
	setLocale("en");
	assert.equal(
		t("Merge di origin/main nel ramo attuale"),
		"Merge origin/main into the current branch"
	);
	assert.equal(
		t("Destinazione: /home/user/repo"),
		"Destination: /home/user/repo"
	);
	setLocale("it");
});

test("il catalogo non ha voci vuote e i segnaposto tornano", () => {
	for (const [key, value] of Object.entries(catalogue())) {
		assert.ok(key.trim().length > 0, "chiave vuota");
		assert.ok(value.trim().length > 0, `traduzione vuota per «${key}»`);
		const keySlots = new Set(key.match(/\{\d+\}/g) ?? []);
		for (const slot of keySlots) {
			assert.ok(
				value.includes(slot),
				`«${key}» perde il segnaposto ${slot} nella traduzione`
			);
		}
	}
});

test("lingua automatica: la preferenza esplicita vince", () => {
	assert.equal(resolveLocale("it"), "it");
	assert.equal(resolveLocale("en"), "en");
});
