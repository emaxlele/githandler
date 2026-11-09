/**
 * Impostazioni dell'applicazione, condivise fra UI e server MCP.
 *
 * I permessi dell'API sono la parte che conta: il server espone solo i tool consentiti qui, e il
 * default è **spento**. Un agente non può chiamare più di quello che l'app gli mette a
 * disposizione: non esiste un percorso che aggiri questa lista.
 *
 * La seconda parte riguarda la copia di sicurezza dei file non tracciati scartati: cosa salvare,
 * quanto per singola operazione e quanto in totale. I valori arrivano da un file che l'utente può
 * modificare a mano, quindi vengono sempre normalizzati e limitati a un intervallo sensato.
 */

/** Tool che leggono soltanto: sono quelli esposti in modalità `read`. */
export const API_READ_TOOLS = [
	"repo_status",
	"history",
	"show_commit",
	"worktree_diff",
	"blame",
] as const;

/** Tool che modificano il repository: vanno abilitati uno per uno, mai con la sola lettura. */
export const API_WRITE_TOOLS = [
	"stage",
	"unstage",
	"commit",
	"create_branch",
	"checkout_branch",
] as const;

export const API_TOOLS = [...API_READ_TOOLS, ...API_WRITE_TOOLS] as const;

export type ApiTool = (typeof API_TOOLS)[number];

/** Un tool di scrittura non è mai implicito: `read` non lo espone e `custom` lo elenca a parte. */
export function isWriteTool(tool: ApiTool): boolean {
	return (API_WRITE_TOOLS as readonly string[]).includes(tool);
}

/** `off` = nessun tool; `read` = solo i tool di lettura; `all` = tutto; `custom` = lista scelta. */
export type ApiMode = "off" | "read" | "all" | "custom";

export interface ApiPolicy {
	mode: ApiMode;
	/** usata solo con `mode: "custom"` */
	tools: ApiTool[];
}

export interface TrashSettings {
	/** prima di cancellare un file non tracciato ne conserva una copia (annullabile) */
	enabled: boolean;
	/** tetto per singola operazione */
	maxBytes: number;
	/** tetto di file per singola operazione */
	maxFiles: number;
	/** spazio totale conservato: oltre, si eliminano le voci più vecchie */
	quotaBytes: number;
}

/** Language of the user interface: `auto` follows the system. */
export type LocalePreference = "auto" | "it" | "en";

/** Window colours: `auto` follows the system, `oled` keeps true blacks. */
export type ThemePreference = "auto" | "dark" | "light" | "oled";

/** Vertical rhythm: `compact` tightens rows and bars, useful on small screens. */
export type DensityPreference = "comfortable" | "compact";

/** Zoom of the whole window, applied by the main process. */
export type FontScalePreference = "small" | "normal" | "large";

export interface AppearanceSettings {
	theme: ThemePreference;
	density: DensityPreference;
	fontScale: FontScalePreference;
	/** Colori della sintassi nel diff; spegnerli lascia il testo, toglie solo i colori. */
	syntax: boolean;
}

export interface UpdatesSettings {
	/**
	 * Indirizzo `https` del feed firmato delle release. Vuoto = aggiornamenti spenti: l'app non
	 * contatta nessun server finché l'utente non lo configura.
	 */
	feedUrl: string;
}

export interface Settings {
	api: ApiPolicy;
	locale: LocalePreference;
	appearance: AppearanceSettings;
	trash: TrashSettings;
	/**
	 * Cartella da cui partono i dialog «Apri», «Crea» e «Clona». Non è un limite: da lì si può
	 * navigare ovunque. `null` = home dell'utente.
	 */
	defaultRoot: string | null;
	/**
	 * Account scelto a mano per un repository, per root assoluto: `{ "/percorso/repo": "id" }`.
	 * Serve quando due account stanno sullo stesso host e il remoto non basta a distinguerli.
	 */
	repoAccounts: Record<string, string>;
	updates: UpdatesSettings;
}

export const MEBIBYTE = 1024 * 1024;

/** Zoom factors used by the main process; a stored value is never taken as a number. */
export const FONT_SCALE_FACTORS: Record<FontScalePreference, number> = {
	small: 0.9,
	normal: 1,
	large: 1.12,
};

export const APPEARANCE_DEFAULTS: AppearanceSettings = {
	theme: "auto",
	density: "comfortable",
	fontScale: "normal",
	syntax: true,
};

/** Valori usati quando il file manca o un campo non è valido. */
export const TRASH_DEFAULTS = {
	enabled: true,
	maxBytes: 25 * MEBIBYTE,
	maxFiles: 2000,
	quotaBytes: 5 * 1024 * MEBIBYTE,
} as const;

/** Intervalli accettati: un limite a zero trasformerebbe la sicurezza in una cancellazione. */
export const TRASH_RANGES = {
	maxBytes: { min: MEBIBYTE, max: 1024 * MEBIBYTE },
	maxFiles: { min: 1, max: 100_000 },
	quotaBytes: { min: MEBIBYTE, max: 50 * 1024 * MEBIBYTE },
} as const;

export interface TrashUsage {
	bytes: number;
	files: number;
	/** scarti ancora annullabili che hanno una copia */
	entries: number;
}

export function defaultSettings(): Settings {
	return {
		api: { mode: "off", tools: [] },
		locale: "auto",
		appearance: { ...APPEARANCE_DEFAULTS },
		trash: { ...TRASH_DEFAULTS },
		defaultRoot: null,
		repoAccounts: {},
		updates: { feedUrl: "" },
	};
}

export function isApiTool(value: unknown): value is ApiTool {
	return (
		typeof value === "string" &&
		(API_TOOLS as readonly string[]).includes(value)
	);
}

export function isLocalePreference(value: unknown): value is LocalePreference {
	return value === "auto" || value === "it" || value === "en";
}

export function isThemePreference(value: unknown): value is ThemePreference {
	return (
		value === "auto" ||
		value === "dark" ||
		value === "light" ||
		value === "oled"
	);
}

export function isDensityPreference(
	value: unknown
): value is DensityPreference {
	return value === "comfortable" || value === "compact";
}

export function isFontScalePreference(
	value: unknown
): value is FontScalePreference {
	return value === "small" || value === "normal" || value === "large";
}

/** Appearance arrives from a hand-editable file: unknown values fall back one by one. */
export function normalizeAppearance(data: unknown): AppearanceSettings {
	const record = asRecord(data);
	return {
		theme: isThemePreference(record?.theme)
			? record.theme
			: APPEARANCE_DEFAULTS.theme,
		density: isDensityPreference(record?.density)
			? record.density
			: APPEARANCE_DEFAULTS.density,
		fontScale: isFontScalePreference(record?.fontScale)
			? record.fontScale
			: APPEARANCE_DEFAULTS.fontScale,
		syntax:
			typeof record?.syntax === "boolean"
				? record.syntax
				: APPEARANCE_DEFAULTS.syntax,
	};
}

export function isApiMode(value: unknown): value is ApiMode {
	return (
		value === "off" ||
		value === "read" ||
		value === "all" ||
		value === "custom"
	);
}

/** Numero intero dentro l'intervallo; un valore assente o non numerico torna al default. */
function clampInt(
	value: unknown,
	range: { min: number; max: number },
	fallback: number
): number {
	if (typeof value !== "number" || !Number.isFinite(value)) return fallback;
	return Math.min(range.max, Math.max(range.min, Math.round(value)));
}

function asRecord(value: unknown): Record<string, unknown> | null {
	return typeof value === "object" && value !== null
		? (value as Record<string, unknown>)
		: null;
}

/**
 * Normalizza un valore già decodificato, senza fidarsi: campi ignoti si scartano, valori non
 * validi tornano al default. Un oggetto corrotto deve spegnere l'API, non aprirla.
 *
 * Migrazione: il formato v0.4 aveva `trashUntracked` come booleano. Se `trash` manca, quel campo
 * decide solo l'accensione; i limiti nuovi prendono i default.
 */
export function normalizeSettings(data: unknown): Settings {
	const fallback = defaultSettings();
	const record = asRecord(data);
	if (!record) return fallback;

	const apiRaw = asRecord(record.api) ?? {};

	const mode = isApiMode(apiRaw.mode) ? apiRaw.mode : fallback.api.mode;
	const tools = Array.isArray(apiRaw.tools)
		? [...new Set(apiRaw.tools.filter(isApiTool))]
		: [];

	const updatesRaw = asRecord(record.updates);
	const trashRaw = asRecord(record.trash);
	const legacyEnabled =
		typeof record.trashUntracked === "boolean"
			? record.trashUntracked
			: undefined;
	const enabled =
		trashRaw && typeof trashRaw.enabled === "boolean"
			? trashRaw.enabled
			: legacyEnabled ?? fallback.trash.enabled;

	const defaultRoot = normalizeDirectory(record.defaultRoot);
	const repoAccounts = normalizeRepoAccounts(record.repoAccounts);

	return {
		api: { mode, tools },
		locale: isLocalePreference(record.locale)
			? record.locale
			: fallback.locale,
		appearance: normalizeAppearance(record.appearance),
		defaultRoot,
		repoAccounts,
		updates: { feedUrl: normalizeFeedUrl(updatesRaw?.feedUrl) },
		trash: {
			enabled,
			maxBytes: clampInt(
				trashRaw?.maxBytes,
				TRASH_RANGES.maxBytes,
				fallback.trash.maxBytes
			),
			maxFiles: clampInt(
				trashRaw?.maxFiles,
				TRASH_RANGES.maxFiles,
				fallback.trash.maxFiles
			),
			quotaBytes: clampInt(
				trashRaw?.quotaBytes,
				TRASH_RANGES.quotaBytes,
				fallback.trash.quotaBytes
			),
		},
	};
}

/** Feed degli aggiornamenti: solo `https`, tutto il resto vale «spento». */
function normalizeFeedUrl(value: unknown): string {
	if (typeof value !== "string") return "";
	const trimmed = value.trim();
	if (!/^https:\/\/[^\s]+$/i.test(trimmed)) return "";
	return trimmed.length > 2048 ? "" : trimmed;
}

/**
 * Una cartella di partenza: path assoluto, senza caratteri di controllo. Un valore relativo o vuoto
 * torna al default (`null` = home), perché un path relativo dipenderebbe dalla cartella di lavoro.
 */
function normalizeDirectory(value: unknown): string | null {
	if (typeof value !== "string") return null;
	const trimmed = value.trim();
	if (!trimmed || !trimmed.startsWith("/") || /[\x00\r\n]/.test(trimmed))
		return null;
	return trimmed.replace(/\/+$/, "") || "/";
}

/**
 * Scelte di account per repository: chiave = root assoluto, valore = id dell'account. Un id è
 * `provider:host:utente`, senza spazi: tutto il resto si scarta invece di indovinare.
 */
function normalizeRepoAccounts(value: unknown): Record<string, string> {
	const record = asRecord(value);
	if (!record) return {};
	const out: Record<string, string> = {};
	for (const [key, accountId] of Object.entries(record)) {
		if (typeof accountId !== "string") continue;
		const root = normalizeDirectory(key);
		const id = accountId.trim();
		if (!root) continue;
		if (!id || id.length > 300 || /[\x00-\x1f]/.test(id)) continue;
		out[root] = id;
	}
	return out;
}

export function parseSettings(raw: string): Settings {
	if (!raw.trim()) return defaultSettings();
	try {
		return normalizeSettings(JSON.parse(raw));
	} catch {
		return defaultSettings();
	}
}

export function serializeSettings(settings: Settings): string {
	return `${JSON.stringify(settings, null, "\t")}\n`;
}

/** Il tool è esposto con questa policy? La distinzione lettura/scrittura la decide il tool. */
export function isToolAllowed(policy: ApiPolicy, tool: ApiTool): boolean {
	if (policy.mode === "off") return false;
	if (policy.mode === "all") return true;
	if (policy.mode === "read") return !isWriteTool(tool);
	return policy.tools.includes(tool);
}

/** Nomi dei tool esposti, per la UI e per `tools/list`. */
export function allowedTools(policy: ApiPolicy): ApiTool[] {
	return API_TOOLS.filter((tool) => isToolAllowed(policy, tool));
}
