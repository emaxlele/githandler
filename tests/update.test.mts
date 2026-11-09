import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { generateKeyPairSync, sign } from "node:crypto";
import { test } from "node:test";

import {
	canonicalRelease,
	checkUpdate,
	compareVersions,
	isNewer,
	parseFeed,
	pickRelease,
	sha256Hex,
	verifyRelease,
	type UpdateRelease,
} from "../src/core/update.ts";
import { downloadUpdate, fetchFeed } from "../src/main/update.ts";

/**
 * Aggiornamenti firmati: confronto delle versioni, lettura del feed e verifica della firma, con
 * una coppia di chiavi Ed25519 generata qui. Nessuna rete e nessuna chiave reale.
 */

const KEYS = generateKeyPairSync("ed25519");
const OTHER = generateKeyPairSync("ed25519");
const PUBLIC_PEM = KEYS.publicKey
	.export({ type: "spki", format: "pem" })
	.toString();
const OTHER_PUBLIC_PEM = OTHER.publicKey
	.export({ type: "spki", format: "pem" })
	.toString();

function release(overrides: Partial<UpdateRelease> = {}): UpdateRelease {
	return {
		version: "0.11.0",
		url: "https://example.org/githandler_0.11.0_amd64.deb",
		sha256: "a".repeat(64),
		signature: "",
		...overrides,
	};
}

function signed(overrides: Partial<UpdateRelease> = {}): UpdateRelease {
	const base = release(overrides);
	return {
		...base,
		signature: sign(
			null,
			Buffer.from(canonicalRelease(base), "utf8"),
			KEYS.privateKey
		).toString("base64"),
	};
}

test("le versioni si confrontano a segmenti, e il suffisso precede la definitiva", () => {
	assert.equal(compareVersions("0.10.0", "0.10.0"), 0);
	assert.equal(compareVersions("1.2", "1.2.0"), 0);
	assert.equal(compareVersions("0.10.0", "0.11.0"), -1);
	assert.equal(compareVersions("0.11.0", "0.10.9"), 1);
	assert.equal(compareVersions("1.0.0", "0.99.99"), 1);
	assert.equal(compareVersions("0.11.0-beta.1", "0.11.0"), -1);
	assert.equal(compareVersions("0.11.0", "0.11.0-beta.1"), 1);
	assert.equal(compareVersions("0.11.0-beta.2", "0.11.0-beta.10"), -1);
	assert.equal(compareVersions("0.11.0-beta.1", "0.11.0-rc.1"), -1);
	// una `v` iniziale è come non ci fosse
	assert.equal(compareVersions("v1.0.0", "1.0.0"), 0);

	assert.equal(isNewer("0.11.0", "0.10.0"), true);
	assert.equal(isNewer("0.10.0", "0.10.0"), false);
	assert.throws(() => compareVersions("ultima", "0.10.0"), /non valida/);
});

test("il feed scarta le voci incomplete e gli indirizzi non https", () => {
	const feed = parseFeed({
		releases: [
			signed({ version: "0.11.0" }),
			signed({ version: "0.12.0" }),
			// scartate: indirizzo in chiaro, digest corto, firma con spazi, versione assente
			signed({ version: "0.13.0", url: "http://example.org/a.deb" }),
			signed({ version: "0.14.0", sha256: "abc" }),
			{ ...signed({ version: "0.15.0" }), signature: "due pezzi" },
			{ url: "https://example.org/b.deb", sha256: "b".repeat(64) },
			// la stessa versione due volte: vale la prima
			signed({ version: "0.11.0", url: "https://example.org/doppia.deb" }),
		],
	});
	assert.deepEqual(
		feed.releases.map((item) => item.version),
		["0.11.0", "0.12.0"]
	);
	assert.equal(
		feed.releases[0]!.url,
		"https://example.org/githandler_0.11.0_amd64.deb"
	);

	// un file corrotto non è un errore da mostrare: è un feed vuoto
	assert.deepEqual(parseFeed(null), { releases: [] });
	assert.deepEqual(parseFeed("strano"), { releases: [] });
	assert.deepEqual(parseFeed({ releases: "no" }), { releases: [] });
	// anche la forma senza involucro
	assert.equal(parseFeed([signed()]).releases.length, 1);
});

test("la firma copre versione, indirizzo e digest, non le note", () => {
	const item = signed({ notes: "correzioni" });
	assert.equal(verifyRelease(item, PUBLIC_PEM), true);
	// le note non fanno parte del testo firmato: cambiarle non invalida nulla
	assert.equal(verifyRelease({ ...item, notes: "altro" }, PUBLIC_PEM), true);

	// versione, indirizzo o digest diversi cambiano il testo firmato
	assert.equal(verifyRelease({ ...item, version: "0.11.1" }, PUBLIC_PEM), false);
	assert.equal(
		verifyRelease({ ...item, url: "https://example.org/altro.deb" }, PUBLIC_PEM),
		false
	);
	assert.equal(
		verifyRelease({ ...item, sha256: "c".repeat(64) }, PUBLIC_PEM),
		false
	);

	// la chiave sbagliata, una firma malformata o una chiave che non è Ed25519
	assert.equal(verifyRelease(item, OTHER_PUBLIC_PEM), false);
	assert.equal(verifyRelease({ ...item, signature: "non-base64!" }, PUBLIC_PEM), false);
	assert.equal(verifyRelease({ ...item, signature: "" }, PUBLIC_PEM), false);
	assert.equal(
		verifyRelease(item, "non una chiave"),
		false
	);
	const rsa = generateKeyPairSync("rsa", { modulusLength: 2048 });
	assert.equal(
		verifyRelease(
			item,
			rsa.publicKey.export({ type: "spki", format: "pem" }).toString()
		),
		false
	);
});

test("il testo canonico è stabile e porta il digest in minuscolo", () => {
	assert.equal(
		canonicalRelease(
			release({ version: "0.11.0", sha256: "AB".repeat(32) })
		),
		[
			"githandler-update/1",
			"0.11.0",
			"https://example.org/githandler_0.11.0_amd64.deb",
			"ab".repeat(32),
		].join("\n")
	);
});

test("si sceglie la release più recente più nuova di quella installata", () => {
	const feed = parseFeed({
		releases: [
			signed({ version: "0.9.0" }),
			signed({ version: "0.11.0" }),
			signed({ version: "0.10.2" }),
		],
	});
	assert.equal(pickRelease(feed, "0.10.0")?.version, "0.11.0");
	// niente da aggiornare
	assert.equal(pickRelease(feed, "0.11.0"), null);
	assert.equal(pickRelease(feed, "1.0.0"), null);
	// una pre-rilascio non supera la definitiva della stessa versione
	const pre = parseFeed({ releases: [signed({ version: "0.11.0-beta.1" })] });
	assert.equal(pickRelease(pre, "0.11.0"), null);
	assert.equal(pickRelease({ releases: [] }, "0.10.0"), null);
});

test("il digest del pacchetto si calcola sugli stessi byte del file", () => {
	const bytes = Buffer.from("contenuto del pacchetto", "utf8");
	assert.equal(
		sha256Hex(bytes),
		"f7c49625f7390efbd3fcb130b11318c65c2dcb935c9541c031db873cea644555"
	);
	assert.equal(sha256Hex("abc"), sha256Hex(Buffer.from("abc", "utf8")));
	assert.match(sha256Hex(""), /^[0-9a-f]{64}$/);
});

/** Il feed si legge come lo pubblica il server: `fetch` sostituito, nessuna rete vera. */
test("il feed si legge dal server e l'aggiornamento si sceglie con le versioni", async () => {
	const original = globalThis.fetch;
	const body = JSON.stringify({ releases: [signed({ version: "0.11.0" })] });
	try {
		globalThis.fetch = (async () =>
			new Response(body, {
				status: 200,
				headers: { "content-type": "application/json" },
			})) as typeof fetch;
		const feed = await fetchFeed("https://example.org/updates.json");
		assert.equal(feed.releases.length, 1);

		const found = checkUpdate(feed, "0.10.0");
		assert.equal(found.current, "0.10.0");
		assert.equal(found.release?.version, "0.11.0");
		assert.equal(checkUpdate(feed, "0.11.0").release, null);

		// un corpo che non è JSON non è un errore da mostrare: è un feed vuoto
		globalThis.fetch = (async () =>
			new Response("<html>manutenzione</html>", { status: 200 })) as typeof fetch;
		assert.deepEqual(await fetchFeed("https://example.org/updates.json"), {
			releases: [],
		});

		// un server che risponde con un errore si legge come tale
		globalThis.fetch = (async () =>
			new Response("no", { status: 503, statusText: "Unavailable" })) as typeof fetch;
		await assert.rejects(
			fetchFeed("https://example.org/updates.json"),
			/503 Unavailable/
		);
	} finally {
		globalThis.fetch = original;
	}
});

/** Il trasporto si prova con `fetch` sostituito: nessuna rete vera, gli stessi controlli. */
test("il pacchetto si scarica solo con firma e digest giusti", async () => {
	const directory = await mkdtemp(join(tmpdir(), "githandler-update-"));
	const original = globalThis.fetch;
	const bytes = Buffer.from("contenuto del pacchetto", "utf8");

	const respond = (body: Uint8Array, status = 200): typeof fetch =>
		(async () =>
			new Response(Buffer.from(body), {
				status,
				headers: { "content-length": String(body.byteLength) },
			})) as typeof fetch;

	try {
		const good = signed({ sha256: sha256Hex(bytes) });
		globalThis.fetch = respond(bytes);
		const downloaded = await downloadUpdate(good, PUBLIC_PEM, directory);
		assert.equal(
			downloaded.path,
			join(directory, "githandler_0.11.0_amd64.deb")
		);
		assert.equal(downloaded.bytes, bytes.byteLength);
		assert.equal(
			await readFile(downloaded.path, "utf8"),
			"contenuto del pacchetto"
		);

		// firma valida, ma il file non ha il digest dichiarato: niente scrittura
		const wrongDigest = signed({ sha256: "b".repeat(64) });
		globalThis.fetch = respond(Buffer.from("altro contenuto"));
		await assert.rejects(
			downloadUpdate(wrongDigest, PUBLIC_PEM, directory),
			/digest/
		);
		// il file verificato di prima non viene sovrascritto dal pacchetto sbagliato
		assert.equal(
			await readFile(
				join(directory, "githandler_0.11.0_amd64.deb"),
				"utf8"
			),
			"contenuto del pacchetto"
		);

		// la firma non torna: il pacchetto non viene nemmeno chiesto
		let called = 0;
		globalThis.fetch = (async () => {
			called++;
			return new Response(bytes, { status: 200 });
		}) as typeof fetch;
		await assert.rejects(
			downloadUpdate(good, OTHER_PUBLIC_PEM, directory),
			/firma/
		);
		assert.equal(called, 0);

		// un errore del server resta un errore, senza file
		globalThis.fetch = respond(Buffer.from("no"), 404);
		await assert.rejects(
			downloadUpdate(good, PUBLIC_PEM, directory),
			/404/
		);

		// il feed in chiaro si rifiuta prima della rete
		called = 0;
		globalThis.fetch = (async () => {
			called++;
			throw new Error("la rete non va contattata");
		}) as typeof fetch;
		await assert.rejects(
			fetchFeed("http://example.org/updates.json"),
			/https/
		);
		assert.equal(called, 0);
	} finally {
		globalThis.fetch = original;
		await rm(directory, { recursive: true, force: true });
	}
});
