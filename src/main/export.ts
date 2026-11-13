import { stat, unlink } from "node:fs/promises";

import { isAbsolutePath } from "../core/paths.ts";
import { runGit } from "./git.ts";

/**
 * Esportare il contenuto di HEAD in un archivio zip.
 *
 * `git archive` lo sa già fare e rispetta `export-ignore` e i filtri del repository: nessuna
 * dipendenza nuova, nessuna seconda implementazione di zip. Quello che **non** finisce
 * nell'archivio sono i file non tracciati e le modifiche non committate: il comando si chiama
 * «Esporta HEAD» e non «copia del working tree».
 */

export async function exportArchive(
	root: string,
	destination: string,
	ref = "HEAD"
): Promise<{ bytes: number }> {
	if (!isAbsolutePath(destination))
		throw new Error(`Destinazione non assoluta: ${destination}`);
	// `-o` scrive il file dal processo git: nessun buffer in memoria, quindi nessun tetto di 64 MiB
	await runGit(
		root,
		["archive", "--format=zip", `--output=${destination}`, ref],
		{ timeoutMs: 300_000 }
	);
	try {
		const info = await stat(destination);
		return { bytes: info.size };
	} catch (error) {
		// un archivio non scritto non deve restare lì a metà
		await unlink(destination).catch(() => undefined);
		throw error;
	}
}
