#!/usr/bin/env bash
# Build a Flatpak bundle (x86_64) with the Electron runtime inside.
#
#   ./build/package-flatpak.sh   → release/GitHandler-<version>-x86_64.flatpak
#
# flatpak-builder reads build/githandler.flatpak.yml. The manifest is copied next to the sources
# this script generates — the payload tarball, the desktop entry, the AppStream metadata — so
# build/ stays free of binaries. The Electron runtime comes from the Electron2 base app, which
# also ships zypak: inside the sandbox the Chromium sandbox stays on.
#
# Needs flatpak and flatpak-builder, plus the runtime and the base app:
#   flatpak install flathub org.freedesktop.Sdk//24.08 org.electronjs.Electron2.BaseApp//24.08
set -euo pipefail

repo="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$repo"

version="$(node -p "require('./package.json').version")"
arch="$(uname -m)"
root="$(mktemp -d)"
trap 'rm -rf "$root"' EXIT

echo "build dei bundle"
npm run --silent build

electron="node_modules/electron/dist"
if [ ! -x "$electron/electron" ]; then
	echo "githandler: runtime Electron assente, esegui npm install" >&2
	exit 1
fi

for tool in flatpak flatpak-builder; do
	if ! command -v "$tool" >/dev/null 2>&1; then
		echo "githandler: $tool non trovato; installalo dal gestore pacchetti della distribuzione" >&2
		exit 1
	fi
done

# ── sorgenti del manifest ────────────────────────────────────────────────────
src="$root/src"
install -d "$src/payload/resources/app"

cp -a "$electron/." "$src/payload/"
rm -f "$src/payload/resources/default_app.asar"
cp -a dist "$src/payload/resources/app/dist"
node -e '
	const fs = require("node:fs");
	const pkg = JSON.parse(fs.readFileSync("package.json", "utf8"));
	const out = { name: pkg.name, productName: pkg.productName, version: pkg.version, description: pkg.description, main: pkg.main, license: pkg.license };
	fs.writeFileSync(process.argv[1], JSON.stringify(out, null, "\t") + "\n");
' "$src/payload/resources/app/package.json"

# The payload is one archive: the manifest unpacks it under /app/githandler.
tar -cf "$src/githandler.tar" -C "$src/payload" .

install -m 644 build/githandler.flatpak.yml "$src/githandler.flatpak.yml"
install -m 755 build/githandler-flatpak.sh "$src/githandler-flatpak.sh"
install -m 644 build/icon.svg "$src/githandler.svg"
install -m 644 build/icon-256.png "$src/githandler-256.png"
install -m 644 LICENSE "$src/LICENSE"

cat >"$src/githandler.desktop" <<'DESKTOP'
[Desktop Entry]
Type=Application
Version=1.0
Name=GitHandler
GenericName=Git Client
Comment=Client Git desktop: grafo della storia, diff, staging, commit
Exec=githandler %U
Icon=io.github.emaxlele.GitHandler
Terminal=false
Categories=Development;RevisionControl;
Keywords=git;repository;diff;commit;branch;
StartupWMClass=githandler
StartupNotify=true
DESKTOP

# AppStream metadata: the software centre reads it. Version and date come from package.json so
# the file cannot go stale in the build directory.
node -e '
	const fs = require("node:fs");
	const pkg = JSON.parse(fs.readFileSync("package.json", "utf8"));
	const date = new Date().toISOString().slice(0, 10);
	const xml = `<?xml version="1.0" encoding="UTF-8"?>
<component type="desktop-application">
	<id>io.github.emaxlele.GitHandler</id>
	<name>GitHandler</name>
	<summary>${pkg.description}</summary>
	<metadata_license>CC0-1.0</metadata_license>
	<project_license>${pkg.license}</project_license>
	<content_rating type="oars-1.1"/>
	<launchable type="desktop-id">io.github.emaxlele.GitHandler.desktop</launchable>
	<releases>
		<release version="${pkg.version}" date="${date}"/>
	</releases>
</component>
`;
	fs.writeFileSync(process.argv[1], xml);
' "$src/githandler.metainfo.xml"

# ── build e bundle ───────────────────────────────────────────────────────────
mkdir -p release
out="release/GitHandler-${version}-${arch}.flatpak"

flatpak-builder --force-clean --repo "$root/repo" \
	--install-deps-from=flathub \
	"$root/build" "$src/githandler.flatpak.yml"
flatpak build-bundle "$root/repo" "$out" io.github.emaxlele.GitHandler

echo "creato: $out ($(du -h "$out" | cut -f1))"
