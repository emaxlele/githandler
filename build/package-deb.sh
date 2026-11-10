#!/usr/bin/env bash
# Pacchetto .deb per Ubuntu 24.04+ (amd64): Electron incluso, nessuna dipendenza npm a runtime.
#
#   ./build/package-deb.sh            → release/githandler_<versione>_<arch>.deb
#
# Il pacchetto installa:
#   /opt/githandler/electron              il runtime Electron
#   /opt/githandler/resources/app/        dist/ e package.json
#   /usr/bin/githandler                   launcher (sandbox setuid, ripiego --no-sandbox solo se serve)
#   /usr/share/applications/githandler.desktop
#   /usr/share/icons/hicolor/scalable/apps/githandler.svg
#   /etc/apparmor.d/githandler          profilo AppArmor (userns per il sandbox)
#   /usr/share/doc/githandler/copyright
set -euo pipefail

repo="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$repo"

version="$(node -p "require('./package.json').version")"
arch="$(dpkg --print-architecture)"
name="githandler_${version}_${arch}"
root="$(mktemp -d)"
trap 'rm -rf "$root"' EXIT

echo "build dei bundle"
npm run --silent build

electron="node_modules/electron/dist"
if [ ! -x "$electron/electron" ]; then
	echo "githandler: runtime Electron assente, esegui npm install" >&2
	exit 1
fi

pkg="$root/$name"
app="$pkg/opt/githandler"

install -d "$pkg/DEBIAN" "$app/resources/app" \
	"$pkg/usr/bin" "$pkg/usr/share/applications" \
	"$pkg/usr/share/icons/hicolor/scalable/apps" "$pkg/usr/share/doc/githandler" \
	"$pkg/etc/apparmor.d"

cp -a "$electron/." "$app/"
rm -f "$app/resources/default_app.asar"
# Il sandbox di Chromium usa l'helper setuid: permette di non passare --no-sandbox.
chmod 4755 "$app/chrome-sandbox"

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

cat >"$pkg/usr/bin/githandler" <<'LAUNCHER'
#!/usr/bin/env bash
# Avvio di GitHandler installato in /opt.
set -euo pipefail

app=/opt/githandler
args=()

# Con l'helper setuid il sandbox funziona anche dove i namespace utente sono limitati;
# senza (per esempio dopo una copia che perde il bit) resta il ripiego --no-sandbox.
if [ ! -u "$app/chrome-sandbox" ] &&
	[ "$(cat /proc/sys/kernel/apparmor_restrict_unprivileged_userns 2>/dev/null || echo 0)" = "1" ]; then
	args+=(--no-sandbox)
fi

exec "$app/electron" "$app/resources/app" "${args[@]}" "$@"
LAUNCHER
chmod 755 "$pkg/usr/bin/githandler"

cat >"$pkg/usr/share/applications/githandler.desktop" <<DESKTOP
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
chmod 644 "$pkg/usr/share/applications/githandler.desktop"

install -m 644 build/icon.svg "$pkg/usr/share/icons/hicolor/scalable/apps/githandler.svg"
install -m 644 build/githandler.apparmor "$pkg/etc/apparmor.d/githandler"

cat >"$pkg/DEBIAN/conffiles" <<'CONFFILES'
/etc/apparmor.d/githandler
CONFFILES
chmod 644 "$pkg/DEBIAN/conffiles"

cat >"$pkg/DEBIAN/postinst" <<'POSTINST'
#!/bin/sh
set -e

if command -v apparmor_parser >/dev/null 2>&1 && [ -f /etc/apparmor.d/githandler ]; then
	if ! apparmor_parser -r /etc/apparmor.d/githandler 2>/dev/null; then
		echo "githandler: profilo AppArmor non caricato; resta il sandbox setuid" >&2
	fi
fi

exit 0
POSTINST
chmod 755 "$pkg/DEBIAN/postinst"

cat >"$pkg/DEBIAN/prerm" <<'PRERM'
#!/bin/sh
set -e

if [ "$1" = "remove" ] || [ "$1" = "purge" ]; then
	if command -v apparmor_parser >/dev/null 2>&1 && [ -f /etc/apparmor.d/githandler ]; then
		apparmor_parser -R /etc/apparmor.d/githandler 2>/dev/null || true
	fi
fi

exit 0
PRERM
chmod 755 "$pkg/DEBIAN/prerm"

{
	echo "Format: https://www.debian.org/doc/packaging-manuals/copyright-format/1.0/"
	echo "Upstream-Name: githandler"
	echo "Source: https://github.com/emaxlele/githandler"
	echo
	echo "Files: *"
	echo "Copyright: 2026 emaxlele"
	echo "License: GPL-3.0-or-later"
	sed 's/^/ /' LICENSE
} >"$pkg/usr/share/doc/githandler/copyright"

# `git` è una dipendenza vera: l'app è solo un'interfaccia sopra il comando. 2.23 è il primo con
# `git switch` e `git restore`, che il backend usa.
#
# Librerie condivise richieste da Electron, con i nomi t64 di Ubuntu 24.04+ e gli
# equivalenti precedenti come alternativa: il pacchetto resta installabile da 22.04 a 26.04.
deps="git (>= 2.23), libasound2t64 | libasound2, libatk1.0-0t64 | libatk1.0-0,
libatk-bridge2.0-0t64 | libatk-bridge2.0-0, libatspi2.0-0t64 | libatspi2.0-0,
libc6, libcairo2, libcups2t64 | libcups2, libdbus-1-3, libdrm2, libexpat1,
libfontconfig1, libfreetype6, libgbm1, libgcc-s1, libgdk-pixbuf-2.0-0,
libglib2.0-0t64 | libglib2.0-0, libgtk-3-0t64 | libgtk-3-0, libnspr4, libnss3,
libpango-1.0-0, libpangocairo-1.0-0, libx11-6, libxcb1, libxcomposite1,
libxdamage1, libxext6, libxfixes3, libxkbcommon0, libxrandr2"
# Le righe vanno unite con uno spazio: `,` senza spazio è tollerato da dpkg ma è un errore di stile.
deps="$(printf '%s' "$deps" | tr '\n' ' ' | sed 's/  */ /g; s/ $//')"

installed_kb="$(du -sk "$pkg" | cut -f1)"

{
	printf 'Package: githandler\n'
	printf 'Version: %s\n' "$version"
	printf 'Section: vcs\n'
	printf 'Priority: optional\n'
	printf 'Architecture: %s\n' "$arch"
	[ -n "$deps" ] && printf 'Depends: %s\n' "$deps"
	printf 'Installed-Size: %s\n' "$installed_kb"
	printf 'Maintainer: emaxlele <emaxlele@users.noreply.github.com>\n'
	printf 'Homepage: https://github.com/emaxlele/githandler\n'
	printf 'Description: Client Git desktop Linux-first\n'
	printf ' Grafo della storia, diff unified e affiancato, staging parziale per hunk e\n'
	printf ' riga, undo generale, recupero dei file non tracciati come oggetti Git,\n'
	printf ' terminale integrato e server MCP con permessi configurabili.\n'
} >"$pkg/DEBIAN/control"

mkdir -p release
out="release/githandler_${version}_${arch}.deb"
dpkg-deb --root-owner-group -Zxz -z1 --build "$pkg" "$out" >/dev/null

echo "creato: $out ($(du -h "$out" | cut -f1))"
dpkg-deb -f "$out" Package Version Architecture Depends
