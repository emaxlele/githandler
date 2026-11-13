import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

import {
	defaultSettings,
	parseSettings,
	serializeSettings,
	type Settings,
} from "../core/settings.ts";

/**
 * Il file delle impostazioni vive fuori dal repository, in una posizione standard:
 *
 *   $GITHANDLER_CONFIG_DIR/githandler/settings.json   (override per test e installazioni portabili)
 *   $XDG_CONFIG_HOME/githandler/settings.json
 *   ~/.config/githandler/settings.json
 *   %APPDATA%\githandler\settings.json          (Windows)
 *
 * Lo legge anche il server MCP, quindi UI e API condividono la stessa policy senza un canale IPC
 * fra processi diversi. Un file assente o corrotto equivale ai default: API spenta.
 */

export function settingsDirectory(): string {
	const override = process.env.GITHANDLER_CONFIG_DIR;
	if (override) return join(override, "githandler");
	if (process.platform === "win32") {
		const roaming = process.env.APPDATA || join(homedir(), "AppData", "Roaming");
		return join(roaming, "githandler");
	}
	const base = process.env.XDG_CONFIG_HOME || join(homedir(), ".config");
	return join(base, "githandler");
}

export function settingsFile(): string {
	return join(settingsDirectory(), "settings.json");
}

export async function loadSettings(): Promise<Settings> {
	try {
		return parseSettings(await readFile(settingsFile(), "utf8"));
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === "ENOENT")
			return defaultSettings();
		throw error;
	}
}

/** Scrittura atomica e permessi stretti: un file a metà non deve poter aprire l'API. */
export async function saveSettings(settings: Settings): Promise<void> {
	const path = settingsFile();
	await mkdir(dirname(path), { recursive: true });
	const temporary = `${path}.tmp`;
	await writeFile(temporary, serializeSettings(settings), {
		encoding: "utf8",
		mode: 0o600,
	});
	await rename(temporary, path);
}
