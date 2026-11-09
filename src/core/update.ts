/**
 * Aggiornamenti firmati: un file JSON con le release, una firma per ciascuna e il digest del
 * pacchetto.
 *
 * Il feed dice solo cosa esiste; la fiducia arriva dalla firma. Ogni release viene firmata sul
 * testo canonico (`canonicalRelease`: versione, indirizzo e digest, una riga ciascuno) con una
 * chiave **Ed25519**, e il pacchetto scaricato deve avere il digest dichiarato. La chiave pubblica
 * non viaggia con il feed: sta accanto all'applicazione, altrimenti chi controlla il feed potrebbe
 * firmare da solo.
 *
 * Niente rete qui: il parser, il confronto delle versioni e la verifica si provano con oggetti e
 * con una coppia di chiavi generate nel test.
 */

import { createHash, createPublicKey, verify } from "node:crypto";

/** Il formato del testo firmato: cambiarlo invalida le firme esistenti, quindi è versionato. */
const CANONICAL_HEADER = "githandler-update/1";

export interface UpdateRelease {
	/** versione dell'applicazione, senza `v`: `0.11.0` */
	version: string;
	/** indirizzo del pacchetto, solo `https` */
	url: string;
	/** digest SHA-256 del pacchetto, esadecimale minuscolo */
	sha256: string;
	/** firma Ed25519 del testo canonico, base64 */
	signature: string;
	/** cosa cambia, mostrato all'utente */
	notes?: string;
	/** data di pubblicazione `YYYY-MM-DD`, informativa */
	date?: string;
}

export interface UpdateFeed {
	/** dalla più vecchia alla più recente, come nel file */
	releases: UpdateRelease[];
}

interface ParsedVersion {
	core: number[];
	/** suffisso di pre-rilascio, `null` quando la versione è definitiva */
	pre: string | null;
}

function asRecord(value: unknown): Record<string, unknown> | null {
	return typeof value === "object" && value !== null
		? (value as Record<string, unknown>)
		: null;
}

function text(value: unknown): string {
	return typeof value === "string" ? value.trim() : "";
}

/** `0.11.0`, `1.2.3-beta.1`: segmenti numerici e un eventuale suffisso. */
function parseVersion(input: string): ParsedVersion | null {
	const match = /^v?(\d+(?:\.\d+)*)(?:-([0-9A-Za-z.-]+))?$/.exec(
		input.trim()
	);
	if (!match) return null;
	return {
		core: match[1]!.split(".").map((part) => Number.parseInt(part, 10)),
		pre: match[2] ?? null,
	};
}

/**
 * Confronto fra due versioni: negativo se `a` precede `b`, zero se sono la stessa.
 *
 * I segmenti mancanti valgono zero (`1.2` = `1.2.0`); una versione con suffisso precede la stessa
 * versione definitiva, e i suffissi si confrontano a pezzi, con i numeri prima del testo.
 */
export function compareVersions(a: string, b: string): number {
	const left = parseVersion(a);
	const right = parseVersion(b);
	if (!left) throw new Error(`Versione non valida: ${a}`);
	if (!right) throw new Error(`Versione non valida: ${b}`);

	const length = Math.max(left.core.length, right.core.length);
	for (let index = 0; index < length; index++) {
		const difference = (left.core[index] ?? 0) - (right.core[index] ?? 0);
		if (difference !== 0) return difference < 0 ? -1 : 1;
	}

	if (left.pre === right.pre) return 0;
	if (left.pre === null) return 1;
	if (right.pre === null) return -1;

	const leftParts = left.pre.split(".");
	const rightParts = right.pre.split(".");
	const parts = Math.max(leftParts.length, rightParts.length);
	for (let index = 0; index < parts; index++) {
		const one = leftParts[index];
		const two = rightParts[index];
		if (one === undefined) return -1;
		if (two === undefined) return 1;
		const oneNumber = /^\d+$/.test(one);
		const twoNumber = /^\d+$/.test(two);
		if (oneNumber && twoNumber) {
			const difference = Number(one) - Number(two);
			if (difference !== 0) return difference < 0 ? -1 : 1;
			continue;
		}
		// un identificatore numerico precede sempre uno testuale
		if (oneNumber !== twoNumber) return oneNumber ? -1 : 1;
		if (one !== two) return one < two ? -1 : 1;
	}
	return 0;
}

/** `true` quando `candidate` è una versione successiva a `current`. */
export function isNewer(candidate: string, current: string): boolean {
	return compareVersions(candidate, current) > 0;
}

/**
 * Legge il feed senza fidarsi: le voci incomplete o con indirizzi non `https` si scartano, i campi
 * ignoti si ignorano. Un file corrotto produce un feed vuoto, non un errore da mostrare.
 */
export function parseFeed(value: unknown): UpdateFeed {
	const record = asRecord(value);
	const list = Array.isArray(value)
		? value
		: Array.isArray(record?.releases)
		? record.releases
		: [];

	const releases: UpdateRelease[] = [];
	const seen = new Set<string>();
	for (const item of list) {
		const entry = asRecord(item);
		if (!entry) continue;
		const version = text(entry.version);
		const url = text(entry.url);
		const sha256 = text(entry.sha256).toLowerCase();
		const signature = text(entry.signature);
		if (!version || parseVersion(version) === null) continue;
		if (!/^https:\/\/[^\s]+$/.test(url)) continue;
		if (!/^[0-9a-f]{64}$/.test(sha256)) continue;
		if (!signature || /\s/.test(signature)) continue;
		if (seen.has(version)) continue;
		seen.add(version);
		const notes = text(entry.notes);
		const date = text(entry.date);
		releases.push({
			version,
			url,
			sha256,
			signature,
			...(notes ? { notes } : {}),
			...(date ? { date } : {}),
		});
	}
	return { releases };
}

/** Il testo esatto su cui si calcola la firma: versione, indirizzo e digest. */
export function canonicalRelease(release: UpdateRelease): string {
	return [
		CANONICAL_HEADER,
		release.version,
		release.url,
		release.sha256.toLowerCase(),
	].join("\n");
}

/**
 * Verifica la firma di una release con la chiave pubblica Ed25519 dell'applicazione.
 *
 * Una firma malformata, una chiave di un altro tipo e un testo diverso danno `false`: non c'è un
 * caso in cui un errore di lettura faccia passare un aggiornamento.
 */
export function verifyRelease(
	release: UpdateRelease,
	publicKeyPem: string
): boolean {
	try {
		const key = createPublicKey(publicKeyPem);
		if (key.asymmetricKeyType !== "ed25519") return false;
		return verify(
			null,
			Buffer.from(canonicalRelease(release), "utf8"),
			key,
			Buffer.from(release.signature, "base64")
		);
	} catch {
		return false;
	}
}

/** Digest SHA-256 in esadecimale minuscolo, lo stesso che il feed dichiara. */
export function sha256Hex(data: Uint8Array | string): string {
	return createHash("sha256")
		.update(typeof data === "string" ? Buffer.from(data, "utf8") : data)
		.digest("hex");
}

/** La release più recente più nuova di quella installata, oppure `null`. */
export function pickRelease(
	feed: UpdateFeed,
	currentVersion: string
): UpdateRelease | null {
	let best: UpdateRelease | null = null;
	for (const release of feed.releases) {
		if (!isNewer(release.version, currentVersion)) continue;
		if (!best || compareVersions(release.version, best.version) > 0)
			best = release;
	}
	return best;
}

/** Esito di una ricerca di aggiornamenti, come lo mostra l'interfaccia. */
export interface UpdateCheck {
	/** versione installata, come l'ha dichiarata l'applicazione */
	current: string;
	/** la release più recente più nuova, `null` quando non c'è niente da fare */
	release: UpdateRelease | null;
}

export function checkUpdate(
	feed: UpdateFeed,
	currentVersion: string
): UpdateCheck {
	return {
		current: currentVersion,
		release: pickRelease(feed, currentVersion),
	};
}

/** Un pacchetto scaricato e verificato: la firma e il digest hanno già dato l'ok. */
export interface DownloadedUpdate {
	/** percorso del file nella cartella temporanea dell'applicazione */
	path: string;
	bytes: number;
	release: UpdateRelease;
}
