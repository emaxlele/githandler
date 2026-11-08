#!/usr/bin/env bash
# Installazione locale (Ubuntu/GNOME) senza pacchetto .deb e senza sudo.
#
# Crea:
#   ~/.local/bin/gitlattice                                   launcher (ricompila e apre)
#   ~/.local/share/applications/gitlattice.desktop            voce nel menu applicazioni
#   ~/.local/share/icons/hicolor/scalable/apps/gitlattice.svg icona
#
# Idempotente: rilanciato aggiorna i file esistenti.
set -euo pipefail

repo="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
bin="$HOME/.local/bin"
apps="$HOME/.local/share/applications"
icons="$HOME/.local/share/icons/hicolor/scalable/apps"

if [ ! -d "$repo/node_modules" ]; then
	echo "gitlattice: eseguo npm install in $repo" >&2
	(cd "$repo" && npm install)
fi
(cd "$repo" && npm run --silent build)

mkdir -p "$bin" "$apps" "$icons"

cat >"$bin/gitlattice" <<LAUNCHER
#!/usr/bin/env bash
# Avvio locale di GitLattice dall'albero dei sorgenti ($repo).
# Ricompila il bundle (esbuild, ~200 ms) e apre la finestra sull'ultima versione del codice.
set -euo pipefail

app="\${GITLATTICE_HOME:-$repo}"

if [ ! -d "\$app/node_modules" ]; then
	echo "gitlattice: dipendenze mancanti, eseguo npm install in \$app" >&2
	(cd "\$app" && npm install)
fi

(cd "\$app" && npm run --silent build)

# AppArmor su Ubuntu blocca il sandbox di Chromium: senza --no-sandbox la finestra non parte.
exec "\$app/node_modules/.bin/electron" "\$app" --no-sandbox "\$@"
LAUNCHER
chmod 755 "$bin/gitlattice"

cat >"$apps/gitlattice.desktop" <<DESKTOP
[Desktop Entry]
Type=Application
Version=1.0
Name=GitLattice
GenericName=Git Client
Comment=Client Git desktop: grafo della storia, diff, staging, commit
Exec=$bin/gitlattice
Icon=gitlattice
Terminal=false
Categories=Development;RevisionControl;
Keywords=git;repository;diff;commit;branch;
StartupWMClass=gitlattice
StartupNotify=true
DESKTOP
chmod 644 "$apps/gitlattice.desktop"

install -m 644 "$repo/build/icon.svg" "$icons/gitlattice.svg"

update-desktop-database "$apps" 2>/dev/null || true
gtk-update-icon-cache -f -t "$HOME/.local/share/icons/hicolor" 2>/dev/null || true

echo "installato:"
echo "  $bin/gitlattice"
echo "  $apps/gitlattice.desktop"
echo "  $icons/gitlattice.svg"
echo "apri GitLattice dal menu applicazioni, oppure esegui: gitlattice"
