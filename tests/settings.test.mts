import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";

const config = await mkdtemp(join(tmpdir(), "gitcraft-settings-"));
process.env.GITCRAFT_CONFIG_DIR = config;

const {
	allowedTools,
	defaultSettings,
	isToolAllowed,
	normalizeSettings,
	parseSettings,
	serializeSettings,
} = await import("../src/core/settings.ts");
const { loadSettings, saveSettings, settingsDirectory, settingsFile } =
	await import("../src/main/settings.ts");

after(async () => {
	await rm(config, { recursive: true, force: true });
});

test("il default spegne l'API e accende la copia dei non tracciati", () => {
	const settings = defaultSettings();
	assert.equal(settings.api.mode, "off");
	assert.deepEqual(settings.api.tools, []);
	assert.equal(settings.trashUntracked, true);
});

test("un file corrotto o incompleto non apre l'API", () => {
	assert.equal(parseSettings("").api.mode, "off");
	assert.equal(parseSettings("non json").api.mode, "off");
	assert.equal(parseSettings("[]").api.mode, "off");
	assert.equal(parseSettings('{"api":{"mode":"tutto"}}').api.mode, "off");

	const partial = parseSettings('{"api":{"mode":"read"}}');
	assert.equal(partial.api.mode, "read");
	assert.equal(partial.trashUntracked, true);
});

test("normalizeSettings scarta campi ignoti e duplicati", () => {
	const settings = normalizeSettings({
		api: {
			mode: "custom",
			tools: ["history", "history", "rm_rf", "blame", 42],
			admin: true,
		},
		trashUntracked: false,
		shell: "rm -rf /",
	});
	assert.deepEqual(settings.api, {
		mode: "custom",
		tools: ["history", "blame"],
	});
	assert.equal(settings.trashUntracked, false);

	assert.equal(normalizeSettings(null).api.mode, "off");
	assert.equal(normalizeSettings({ trashUntracked: "sì" }).trashUntracked, true);
});

test("la serializzazione si rilegge uguale", () => {
	const settings = {
		api: { mode: "custom" as const, tools: ["blame" as const] },
		trashUntracked: false,
	};
	assert.deepEqual(parseSettings(serializeSettings(settings)), settings);
});

test("le modalità decidono quali tool sono esposti", () => {
	const off = { mode: "off" as const, tools: [] };
	assert.deepEqual(allowedTools(off), []);
	assert.equal(isToolAllowed(off, "blame"), false);

	const read = { mode: "read" as const, tools: [] };
	assert.equal(allowedTools(read).length, 5);
	assert.equal(isToolAllowed(read, "blame"), true);

	const all = { mode: "all" as const, tools: [] };
	assert.equal(allowedTools(all).length, 5);
	assert.equal(isToolAllowed(all, "blame", "write"), true);

	const custom = { mode: "custom" as const, tools: ["history" as const] };
	assert.deepEqual(allowedTools(custom), ["history"]);
	assert.equal(isToolAllowed(custom, "blame"), false);
});

test("il file delle impostazioni vive nella config dir", () => {
	assert.equal(settingsDirectory(), join(config, "gitcraft"));
	assert.equal(settingsFile(), join(config, "gitcraft", "settings.json"));
});

test("senza file valgono i default; salvare e rileggere conserva i valori", async () => {
	assert.equal((await loadSettings()).api.mode, "off");

	const custom = {
		api: { mode: "custom" as const, tools: ["repo_status" as const] },
		trashUntracked: false,
	};
	await saveSettings(custom);
	assert.deepEqual(await loadSettings(), custom);

	const text = await readFile(settingsFile(), "utf8");
	assert.match(text, /"repo_status"/);
	const mode = (await stat(settingsFile())).mode & 0o777;
	assert.equal(mode, 0o600);
});

test("un file illeggibile non fa partire l'app con l'API aperta", async () => {
	await mkdir(settingsDirectory(), { recursive: true });
	await writeFile(settingsFile(), "{ rotto", "utf8");
	assert.equal((await loadSettings()).api.mode, "off");
});
