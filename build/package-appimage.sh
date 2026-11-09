#!/usr/bin/env bash
# Build a self-contained AppImage (x86_64) with the Electron runtime inside.
#
#   ./build/package-appimage.sh   → release/GitHandler-<version>-x86_64.AppImage
#
# The image mounts read-only, so the setuid Chromium sandbox cannot be used: the launcher
# falls back to --no-sandbox only where Ubuntu restricts unprivileged user namespaces.
# APPIMAGETOOL can point at a different appimagetool binary.
set -euo pipefail

repo="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$repo"

version="$(node -p "require('./package.json').version")"
arch="$(uname -m)"
tool="${APPIMAGETOOL:-appimagetool}"
root="$(mktemp -d)"
trap 'rm -rf "$root"' EXIT

echo "build dei bundle"
npm run --silent build

electron="node_modules/electron/dist"
if [ ! -x "$electron/electron" ]; then
	echo "githandler: runtime Electron assente, esegui npm install" >&2
	exit 1
fi

if ! command -v "$tool" >/dev/null 2>&1 && [ ! -x "$tool" ]; then
	echo "githandler: appimagetool non trovato; imposta APPIMAGETOOL=/percorso/appimagetool" >&2
	exit 1
fi

appdir="$root/GitHandler.AppDir"
app="$appdir/opt/githandler"
install -d "$app/resources/app"

cp -a "$electron/." "$app/"
rm -f "$app/resources/default_app.asar"

cp -a dist "$app/resources/app/dist"
node -e '
	const fs = require("node:fs");
	const pkg = JSON.parse(fs.readFileSync("package.json", "utf8"));
	const out = { name: pkg.name, productName: pkg.productName, version: pkg.version, description: pkg.description, main: pkg.main, license: pkg.license };
	fs.writeFileSync(process.argv[1], JSON.stringify(out, null, "\t") + "\n");
' "$app/resources/app/package.json"

# La chiave pubblica degli aggiornamenti firmati viaggia con l'app, se il progetto ne ha una.
if [ -f build/update-key.pub ]; then
	install -Dm644 build/update-key.pub "$app/resources/app/build/update-key.pub"
fi

cat >"$appdir/AppRun" <<'APPRUN'
#!/usr/bin/env bash
set -euo pipefail

here="$(dirname "$(readlink -f "$0")")"
app="$here/opt/githandler"
args=()

# The image is read-only: the setuid sandbox is unavailable. Where Ubuntu restricts user
# namespaces, Chromium has to run without its sandbox; elsewhere the namespace sandbox works.
if [ ! -u "$app/chrome-sandbox" ] &&
	[ "$(cat /proc/sys/kernel/apparmor_restrict_unprivileged_userns 2>/dev/null || echo 0)" = "1" ]; then
	args+=(--no-sandbox)
fi

exec "$app/electron" "$app/resources/app" "${args[@]}" "$@"
APPRUN
chmod 755 "$appdir/AppRun"

cat >"$appdir/githandler.desktop" <<'DESKTOP'
[Desktop Entry]
Type=Application
Version=1.0
Name=GitHandler
GenericName=Git Client
Comment=Client Git desktop: grafo della storia, diff, staging, commit
Exec=githandler %U
Icon=githandler
Terminal=false
Categories=Development;RevisionControl;
Keywords=git;repository;diff;commit;branch;
StartupWMClass=githandler
StartupNotify=true
DESKTOP
chmod 644 "$appdir/githandler.desktop"

install -m 644 build/icon.svg "$appdir/githandler.svg"
install -m 644 build/icon-256.png "$appdir/githandler.png"

mkdir -p release
out="release/GitHandler-${version}-${arch}.AppImage"

ARCH="$arch" APPIMAGE_EXTRACT_AND_RUN=1 "$tool" --no-appstream "$appdir" "$out" >/dev/null

chmod 755 "$out"
echo "creato: $out ($(du -h "$out" | cut -f1))"
