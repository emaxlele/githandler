#!/usr/bin/env bash
# Installazione locale (Ubuntu/GNOME) senza pacchetto .deb e senza sudo.
#
# Crea:
#   ~/.local/bin/githandler                                   launcher (ricompila e apre)
#   ~/.local/share/applications/githandler.desktop            voce nel menu applicazioni
#   ~/.local/share/icons/hicolor/scalable/apps/githandler.svg icona
#
# Idempotente: rilanciato aggiorna i file esistenti.
set -euo pipefail

repo="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
bin="$HOME/.local/bin"
apps="$HOME/.local/share/applications"
icons="$HOME/.local/share/icons/hicolor/scalable/apps"

if [ ! -d "$repo/node_modules" ]; then
	echo "githandler: eseguo npm install in $repo" >&2
	(cd "$repo" && npm install)
fi
(cd "$repo" && npm run --silent build)

mkdir -p "$bin" "$apps" "$icons"

cat >"$bin/githandler" <<LAUNCHER
#!/usr/bin/env bash
# Avvio locale di GitHandler dall'albero dei sorgenti ($repo).
# Ricompila il bundle (esbuild, ~200 ms) e apre la finestra sull'ultima versione del codice.
set -euo pipefail

app="\${GITHANDLER_HOME:-$repo}"

if [ ! -d "\$app/node_modules" ]; then
	echo "githandler: dipendenze mancanti, eseguo npm install in \$app" >&2
	(cd "\$app" && npm install)
fi

(cd "\$app" && npm run --silent build)

# AppArmor su Ubuntu blocca il sandbox di Chromium: senza --no-sandbox la finestra non parte.
exec "\$app/node_modules/.bin/electron" "\$app" --no-sandbox "\$@"
LAUNCHER
chmod 755 "$bin/githandler"

cat >"$apps/githandler.desktop" <<DESKTOP
[Desktop Entry]
Type=Application
Version=1.0
Name=GitHandler
GenericName=Git Client
Comment=Client Git desktop: grafo della storia, diff, staging, commit
Exec=$bin/githandler
Icon=githandler
Terminal=false
Categories=Development;RevisionControl;
Keywords=git;repository;diff;commit;branch;
StartupWMClass=githandler
StartupNotify=true
DESKTOP
chmod 644 "$apps/githandler.desktop"

install -m 644 "$repo/build/icon.svg" "$icons/githandler.svg"

update-desktop-database "$apps" 2>/dev/null || true
gtk-update-icon-cache -f -t "$HOME/.local/share/icons/hicolor" 2>/dev/null || true

echo "installato:"
echo "  $bin/githandler"
echo "  $apps/githandler.desktop"
echo "  $icons/githandler.svg"
echo "apri GitHandler dal menu applicazioni, oppure esegui: githandler"
