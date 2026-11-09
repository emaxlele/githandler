import { readFile, writeFile } from "node:fs/promises";
import { basename, join } from "node:path";

import {
	parseFeed,
	sha256Hex,
	verifyRelease,
	type DownloadedUpdate,
	type UpdateFeed,
	type UpdateRelease,
} from "../core/update.ts";

/**
 * Aggiornamenti: leggere un feed firmato, scaricare il pacchetto e verificarlo.
 *
 * La regola è quella di `src/core/update.ts` e non si aggira qui: l'indirizzo del feed deve essere
 * `https`, la firma Ed25519 deve combaciare e il digest del file scaricato deve essere quello
 * dichiarato. Il pacchetto verificato viene solo **aperto** con l'installatore del sistema: nessuna
 * scrittura al posto dell'utente, nessun avvio automatico di un file scaricato.
 */

/** Dimensione massima accettata per un pacchetto: un aggiornamento più grande è un errore. */
export const UPDATE_MAX_BYTES = 512 * 1024 * 1024;

/** Oltre questo tempo il feed o il pacchetto si considerano irraggiungibili. */
export const UPDATE_TIMEOUT_MS = 30_000;

function assertHttps(url: string): void {
	if (!/^https:\/\/[^\s]+$/i.test(url))
		throw new Error(
			"Il feed degli aggiornamenti deve essere un indirizzo https."
		);
}

/** Legge il feed: nessuna fiducia nel contenuto, solo nella firma di ogni release. */
export async function fetchFeed(feedUrl: string): Promise<UpdateFeed> {
	assertHttps(feedUrl);
	let response: Response;
	try {
		response = await fetch(feedUrl, {
			signal: AbortSignal.timeout(UPDATE_TIMEOUT_MS),
			headers: { accept: "application/json" },
		});
	} catch (error) {
		throw new Error(
			`Feed degli aggiornamenti non raggiungibile: ${
				error instanceof Error ? error.message : String(error)
			}`
		);
	}
	if (!response.ok)
		throw new Error(
			`Feed degli aggiornamenti: ${response.status} ${response.statusText}`
		);
	const payload = await response.json().catch(() => null);
	return parseFeed(payload);
}

/**
 * Scarica il pacchetto e lo verifica due volte: la firma dice che la release è nostra, il digest
 * dice che il file è quello firmato. Il file nasce in `directory` solo dopo i due controlli.
 */
export async function downloadUpdate(
	release: UpdateRelease,
	publicKeyPem: string,
	directory: string
): Promise<DownloadedUpdate> {
	if (!verifyRelease(release, publicKeyPem))
		throw new Error(
			"La firma della release non corrisponde alla chiave dell'applicazione."
		);

	let response: Response;
	try {
		response = await fetch(release.url, {
			signal: AbortSignal.timeout(UPDATE_TIMEOUT_MS),
		});
	} catch (error) {
		throw new Error(
			`Pacchetto non raggiungibile: ${
				error instanceof Error ? error.message : String(error)
			}`
		);
	}
	if (!response.ok)
		throw new Error(`Pacchetto: ${response.status} ${response.statusText}`);

	const declared = Number(response.headers.get("content-length") ?? "0");
	if (declared > UPDATE_MAX_BYTES)
		throw new Error("Il pacchetto supera la dimensione massima accettata.");

	const bytes = new Uint8Array(await response.arrayBuffer());
	if (bytes.byteLength > UPDATE_MAX_BYTES)
		throw new Error("Il pacchetto supera la dimensione massima accettata.");
	if (sha256Hex(bytes) !== release.sha256.toLowerCase())
		throw new Error(
			"Il pacchetto scaricato non ha il digest dichiarato: download interrotto o file sostituito."
		);

	// Il nome viene dall'indirizzo, ridotto alla sola parte finale: il resto lo decide l'app.
	const name = basename(new URL(release.url).pathname).replace(
		/[^\w.+-]/g,
		"_"
	);
	const path = join(directory, name || `githandler-${release.version}`);
	await writeFile(path, bytes);
	return { path, bytes: bytes.byteLength, release };
}

/** Legge la chiave pubblica dell'applicazione; `null` quando gli aggiornamenti non sono firmati. */
export async function readUpdateKey(path: string): Promise<string | null> {
	try {
		const text = await readFile(path, "utf8");
		return text.includes("BEGIN PUBLIC KEY") ? text : null;
	} catch {
		return null;
	}
}
