import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";

const config = await mkdtemp(join(tmpdir(), "githandler-settings-"));
process.env.GITHANDLER_CONFIG_DIR = config;

const {
	allowedTools,
	defaultSettings,
	isToolAllowed,
	normalizeSettings,
	parseSettings,
	serializeSettings,
	MEBIBYTE,
	TRASH_DEFAULTS,
	TRASH_RANGES,
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
	assert.deepEqual(settings.trash, {
		enabled: true,
		maxBytes: 25 * MEBIBYTE,
		maxFiles: 2000,
		quotaBytes: 5 * 1024 * MEBIBYTE,
	});
});

test("un file corrotto o incompleto non apre l'API", () => {
	assert.equal(parseSettings("").api.mode, "off");
	assert.equal(parseSettings("non json").api.mode, "off");
	assert.equal(parseSettings("[]").api.mode, "off");
	assert.equal(parseSettings('{"api":{"mode":"tutto"}}').api.mode, "off");

	const partial = parseSettings('{"api":{"mode":"read"}}');
	assert.equal(partial.api.mode, "read");
	assert.deepEqual(partial.trash, TRASH_DEFAULTS);
});

test("normalizeSettings scarta campi ignoti e duplicati", () => {
	const settings = normalizeSettings({
		api: {
			mode: "custom",
			tools: ["history", "history", "rm_rf", "blame", 42],
			admin: true,
		},
		trash: { enabled: false, maxBytes: 1 },
		shell: "rm -rf /",
	});
	assert.deepEqual(settings.api, {
		mode: "custom",
		tools: ["history", "blame"],
	});
	assert.equal(settings.trash.enabled, false);
	assert.equal(settings.trash.maxBytes, TRASH_RANGES.maxBytes.min);

	assert.equal(normalizeSettings(null).api.mode, "off");
	assert.equal(normalizeSettings({ trash: "sì" }).trash.enabled, true);
});

test("la cartella di base deve essere un path assoluto", () => {
	assert.equal(normalizeSettings(null).defaultRoot, null);
	assert.equal(
		normalizeSettings({ defaultRoot: "/home/mario/Progetti" }).defaultRoot,
		"/home/mario/Progetti"
	);
	// lo slash finale non conta; un path relativo dipenderebbe dalla cartella di lavoro
	assert.equal(
		normalizeSettings({ defaultRoot: "/srv/repo/" }).defaultRoot,
		"/srv/repo"
	);
	for (const bad of ["", "  ", "progetti", "./progetti", "~/progetti", "/a\nb"]) {
		assert.equal(
			normalizeSettings({ defaultRoot: bad }).defaultRoot,
			null,
			JSON.stringify(bad)
		);
	}
});

test("i limiti fuori intervallo vengono riportati dentro, mai a zero", () => {
	const settings = normalizeSettings({
		trash: {
			enabled: true,
			maxBytes: 10 ** 15,
			maxFiles: 0,
			quotaBytes: -5,
		},
	});
	assert.equal(settings.trash.maxBytes, TRASH_RANGES.maxBytes.max);
	assert.equal(settings.trash.maxFiles, TRASH_RANGES.maxFiles.min);
	assert.equal(settings.trash.quotaBytes, TRASH_RANGES.quotaBytes.min);

	const small = normalizeSettings({
		trash: { maxBytes: 1, maxFiles: 1, quotaBytes: 1 },
	});
	// un limite a zero trasformerebbe la rete di sicurezza in una cancellazione
	assert.equal(small.trash.maxBytes, MEBIBYTE);
	assert.equal(small.trash.maxFiles, 1);
	assert.equal(small.trash.quotaBytes, MEBIBYTE);

	const fractional = normalizeSettings({
		trash: { maxBytes: 2.7 * MEBIBYTE, maxFiles: 12.4 },
	});
	assert.equal(fractional.trash.maxBytes, Math.round(2.7 * MEBIBYTE));
	assert.equal(fractional.trash.maxFiles, 12);
});

test("il formato v0.4 migra senza perdere la scelta di accensione", () => {
	const off = parseSettings('{"api":{"mode":"off"},"trashUntracked":false}');
	assert.equal(off.trash.enabled, false);
	assert.equal(off.trash.maxBytes, TRASH_DEFAULTS.maxBytes);

	const on = parseSettings('{"trashUntracked":true}');
	assert.equal(on.trash.enabled, true);

	// il formato nuovo vince su quello vecchio
	const both = parseSettings(
		'{"trashUntracked":false,"trash":{"enabled":true}}'
	);
	assert.equal(both.trash.enabled, true);

	// un valore non booleano non deve spegnere (né accendere) niente a caso
	assert.equal(
		parseSettings('{"trashUntracked":"sì"}').trash.enabled,
		TRASH_DEFAULTS.enabled
	);
});

test("la serializzazione si rilegge uguale", () => {
	const settings = {
		api: { mode: "custom" as const, tools: ["blame" as const] },
		locale: "auto" as const,
		defaultRoot: null,
		trash: {
			enabled: false,
			maxBytes: 50 * MEBIBYTE,
			maxFiles: 500,
			quotaBytes: 2 * 1024 * MEBIBYTE,
		},
		repoAccounts: { "/tmp/repo": "github:github.com:emaxlele" },
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
	assert.equal(settingsDirectory(), join(config, "githandler"));
	assert.equal(settingsFile(), join(config, "githandler", "settings.json"));
});

test("senza file valgono i default; salvare e rileggere conserva i valori", async () => {
	assert.equal((await loadSettings()).api.mode, "off");

	const custom = {
		api: { mode: "custom" as const, tools: ["repo_status" as const] },
		locale: "it" as const,
		defaultRoot: "/tmp/progetti",
		trash: {
			enabled: false,
			maxBytes: 10 * MEBIBYTE,
			maxFiles: 100,
			quotaBytes: 512 * MEBIBYTE,
		},
		repoAccounts: {},
	};
	await saveSettings(custom);
	assert.deepEqual(await loadSettings(), custom);

	const text = await readFile(settingsFile(), "utf8");
	assert.match(text, /"repo_status"/);
	assert.match(text, /"quotaBytes"/);
	const mode = (await stat(settingsFile())).mode & 0o777;
	assert.equal(mode, 0o600);
});

test("un file illeggibile non fa partire l'app con l'API aperta", async () => {
	await mkdir(settingsDirectory(), { recursive: true });
	await writeFile(settingsFile(), "{ rotto", "utf8");
	assert.equal((await loadSettings()).api.mode, "off");
});

test("la lingua accetta solo le scelte previste", () => {
	assert.equal(normalizeSettings({ locale: "en" }).locale, "en");
	assert.equal(normalizeSettings({ locale: "it" }).locale, "it");
	assert.equal(normalizeSettings({ locale: "auto" }).locale, "auto");
	assert.equal(normalizeSettings({ locale: "fr" }).locale, "auto");
	assert.equal(normalizeSettings({}).locale, "auto");
});
