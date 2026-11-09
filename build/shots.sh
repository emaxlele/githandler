#!/usr/bin/env bash
# Screenshot della UI senza display, con un profilo Electron usa-e-getta.
#
#   npm run shots -- --repo /tmp/gitdemo
#
# Il profilo separato (`--user-data-dir`) è indispensabile: con quello predefinito la modalità
# screenshot aprirebbe il repository di prova nella stessa finestra dell'utente e ne
# sovrascriverebbe le schede salvate in `localStorage["githandler.sessions"]`.
set -euo pipefail

repo="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$repo"

npm run --silent build

profile="$(mktemp -d /tmp/githandler-shots.XXXXXX)"
cleanup() { rm -rf "$profile"; }
trap cleanup EXIT

node_modules/.bin/electron . \
	--shots \
	--user-data-dir="$profile" \
	--ozone-platform=headless \
	--ozone-override-screen-size=1440,940 \
	--disable-gpu \
	--no-sandbox \
	"$@"
