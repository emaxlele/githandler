#!/usr/bin/env node
// Firma una release per il feed degli aggiornamenti.
//
//   node build/sign-update.mjs <chiave-privata.pem> <pacchetto> <indirizzo-https> [versione]
//
// Stampa la voce JSON da mettere in `releases`: versione (dall'argomento o da package.json), digest
// SHA-256 del pacchetto, firma Ed25519 del testo canonico. La chiave privata resta un file locale e
// non entra mai nel repository: quella pubblica va in `build/update-key.pub`, che si package con
// l'applicazione.
//
// Le note non sono firmate: sono testo informativo, e l'app le mostra soltanto. Gli indirizzi e i
// digest da cui dipende l'aggiornamento, invece, sono coperti dalla firma.
import { readFileSync } from "node:fs";
import { createPrivateKey, sign } from "node:crypto";

import { canonicalRelease, sha256Hex } from "../src/core/update.ts";

const [keyPath, packagePath, url, versionArg] = process.argv.slice(2);
if (!keyPath || !packagePath || !url) {
	console.error(
		"uso: node build/sign-update.mjs <chiave-privata.pem> <pacchetto> <indirizzo-https> [versione]"
	);
	process.exit(2);
}
if (!/^https:\/\/[^\s]+$/.test(url)) {
	console.error("githandler: l'indirizzo deve essere https");
	process.exit(2);
}

const version =
	versionArg ?? JSON.parse(readFileSync("package.json", "utf8")).version;
if (!version) {
	console.error("githandler: versione assente");
	process.exit(2);
}

const sha256 = sha256Hex(readFileSync(packagePath));
const release = { version, url, sha256, signature: "" };
const signature = sign(
	null,
	Buffer.from(canonicalRelease(release), "utf8"),
	createPrivateKey(readFileSync(keyPath, "utf8"))
).toString("base64");

process.stdout.write(
	`${JSON.stringify({ ...release, signature }, null, "\t")}\n`
);
