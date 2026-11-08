/**
 * Impostazioni dell'applicazione, condivise fra UI e server MCP.
 *
 * I permessi dell'API sono la parte che conta: il server espone solo i tool consentiti qui, e il
 * default è **spento**. Un agente non può chiamare più di quello che l'app gli mette a
 * disposizione: non esiste un percorso che aggiri questa lista.
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

export interface Settings {
	api: ApiPolicy;
	/** prima di cancellare un file non tracciato ne conserva una copia (annullabile) */
	trashUntracked: boolean;
}

export function defaultSettings(): Settings {
	return {
		api: { mode: "off", tools: [] },
		trashUntracked: true,
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

/**
 * Normalizza un valore già decodificato, senza fidarsi: campi ignoti si scartano, valori non
 * validi tornano al default. Un oggetto corrotto deve spegnere l'API, non aprirla.
 */
export function normalizeSettings(data: unknown): Settings {
	const fallback = defaultSettings();
	if (typeof data !== "object" || data === null) return fallback;

	const record = data as Record<string, unknown>;
	const apiRaw =
		typeof record.api === "object" && record.api !== null
			? (record.api as Record<string, unknown>)
			: {};

	const mode = isApiMode(apiRaw.mode) ? apiRaw.mode : fallback.api.mode;
	const tools = Array.isArray(apiRaw.tools)
		? [...new Set(apiRaw.tools.filter(isApiTool))]
		: [];

	return {
		api: { mode, tools },
		trashUntracked:
			typeof record.trashUntracked === "boolean"
				? record.trashUntracked
				: fallback.trashUntracked,
	};
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
