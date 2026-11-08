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

export const API_TOOLS = [
	"repo_status",
	"history",
	"show_commit",
	"worktree_diff",
	"blame",
] as const;

export type ApiTool = (typeof API_TOOLS)[number];

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

export interface Settings {
	api: ApiPolicy;
	trash: TrashSettings;
	/**
	 * Cartella da cui partono i dialog «Apri», «Crea» e «Clona». Non è un limite: da lì si può
	 * navigare ovunque. `null` = home dell'utente.
	 */
	defaultRoot: string | null;
}

export const MEBIBYTE = 1024 * 1024;

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
		trash: { ...TRASH_DEFAULTS },
		defaultRoot: null,
	};
}

export function isApiTool(value: unknown): value is ApiTool {
	return (
		typeof value === "string" &&
		(API_TOOLS as readonly string[]).includes(value)
	);
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

	return {
		api: { mode, tools },
		defaultRoot,
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

/** Il tool è esposto? `access` distingue i tool di lettura da eventuali tool che scrivono. */
export function isToolAllowed(
	policy: ApiPolicy,
	tool: ApiTool,
	access: "read" | "write" = "read"
): boolean {
	if (policy.mode === "off") return false;
	if (policy.mode === "all") return true;
	if (policy.mode === "read") return access === "read";
	return policy.tools.includes(tool);
}

/** Nomi dei tool esposti, per la UI e per `tools/list`. */
export function allowedTools(policy: ApiPolicy): ApiTool[] {
	return API_TOOLS.filter((tool) => isToolAllowed(policy, tool));
}
