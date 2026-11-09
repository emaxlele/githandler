import { access, mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";

import { cloneArgs, initArgs, repoNameFromUrl } from "../core/providers.ts";
import type { NetworkProgress } from "../core/network.ts";
import { runGit, runGitStreaming } from "./git.ts";

/**
 * Le due operazioni che partono da una cartella che **non** è ancora un repository: creare e
 * clonare. Non passano dal backend, che ragiona su un repository già aperto; usano `runGit` dalla
 * cartella genitore, così i path restano argomenti e non comandi.
 */

export interface Identity {
	name: string;
	email: string;
}

const LINE_SAFE = /^[^\x00\r\n]+$/;

function assertIdentity(identity: Identity): void {
	if (!LINE_SAFE.test(identity.name) || !identity.name.trim())
		throw new Error("Nome dell'identità non valido.");
	if (!LINE_SAFE.test(identity.email) || !identity.email.includes("@"))
		throw new Error("Email dell'identità non valida.");
}

async function exists(path: string): Promise<boolean> {
	try {
		await access(path);
		return true;
	} catch {
		return false;
	}
}

export async function initRepository(
	dest: string,
	identity: Identity | null
): Promise<void> {
	if (await exists(dest)) throw new Error(`La cartella esiste già: ${dest}`);
	await mkdir(dirname(dest), { recursive: true });
	await runGit(dirname(dest), initArgs(dest), { timeoutMs: 60_000 });
	if (identity) {
		assertIdentity(identity);
		// identità locale al repository: non tocca la configurazione globale dell'utente
		await runGit(dest, ["config", "user.name", identity.name.trim()]);
		await runGit(dest, ["config", "user.email", identity.email.trim()]);
	}
}

/** Cartella in cui finirà il clone: `<genitore>/<nome dall'URL>`. */
export function cloneDestination(parent: string, url: string): string {
	return join(parent, repoNameFromUrl(url));
}

export async function cloneRepository(
	url: string,
	dest: string,
	env: Record<string, string> | null,
	onProgress?: (progress: NetworkProgress) => void
): Promise<void> {
	if (await exists(dest)) throw new Error(`La cartella esiste già: ${dest}`);
	await mkdir(dirname(dest), { recursive: true });
	await runGitStreaming(
		dirname(dest),
		cloneArgs(url, dest),
		{
			timeoutMs: 600_000,
			env: env ?? {},
		},
		onProgress
	);
}
