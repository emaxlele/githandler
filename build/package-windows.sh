#!/usr/bin/env bash
# Pacchetto per Windows (x86_64): cartella portabile con GitHandler.exe dentro.
#
#   ./build/package-windows.sh   → release/GitHandler-<version>-win32-x64.zip
#
# Non è un installer: si scompatta e si lancia. Il runtime Electron per Windows viene scaricato
# dal rilascio ufficiale della stessa versione che il progetto usa su Linux, quindi il pacchetto
# contiene esattamente i file dell'app già impacchettata dal build (dist/ più package.json).
# La firma Authenticode non c'è: Windows mostra l'avviso SmartScreen al primo avvio.
set -euo pipefail

repo="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$repo"

version="$(node -p "require('./package.json').version")"
electron="$(node -p "require('electron/package.json').version")"
name="GitHandler-$version-win32-x64"
root="$(mktemp -d)"
trap 'rm -rf "$root"' EXIT

echo "build dei bundle"
npm run --silent build

cache="${XDG_CACHE_HOME:-$HOME/.cache}/githandler/electron"
archive="$cache/electron-v$electron-win32-x64.zip"
if [ ! -f "$archive" ]; then
	mkdir -p "$cache"
	echo "scarico Electron $electron per Windows"
	curl -sSL --fail -o "$archive.part" \
		"https://github.com/electron/electron/releases/download/v$electron/electron-v$electron-win32-x64.zip"
	mv "$archive.part" "$archive"
fi

app="$root/$name"
mkdir -p "$app"
unzip -q "$archive" -d "$app"
rm -f "$app/resources/default_app.asar"
mv "$app/electron.exe" "$app/GitHandler.exe"

mkdir -p "$app/resources/app"
cp -a dist "$app/resources/app/dist"
node -e '
	const fs = require("node:fs");
	const pkg = JSON.parse(fs.readFileSync("package.json", "utf8"));
	const out = { name: pkg.name, productName: pkg.productName, version: pkg.version, description: pkg.description, main: pkg.main, license: pkg.license };
	fs.writeFileSync(process.argv[1], JSON.stringify(out, null, "\t") + "\n");
' "$app/resources/app/package.json"

if [ -f build/update-key.pub ]; then
	install -Dm644 build/update-key.pub "$app/resources/app/build/update-key.pub"
fi

cat >"$app/LEGGIMI.txt" <<'NOTES'
GitHandler per Windows (portatile)
==================================

Scompatta dove vuoi e avvia GitHandler.exe. Non c'è un installer e non viene
scritto niente fuori dalla cartella, tranne le impostazioni in
%APPDATA%\githandler.

Serve Git per Windows, che porta con sé il bash usato dal terminale integrato
e dalle credenziali: https://git-scm.com/download/win (versione 2.23 o più
recente).

Il file non è firmato: al primo avvio Windows mostra l'avviso SmartScreen.
Verifica l'impronta SHA-256 pubblicata nelle note di rilascio.
NOTES

mkdir -p release
(cd "$root" && zip -qr "$repo/release/$name.zip" "$name")
size="$(du -h "release/$name.zip" | cut -f1)"
echo "creato: release/$name.zip ($size)"
