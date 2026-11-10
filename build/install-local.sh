#!/usr/bin/env bash
# Installazione locale (Ubuntu/GNOME) senza pacchetto .deb e senza sudo.
#
# Crea:
#   ~/.local/bin/githandler                                   launcher (ricompila e apre)
#   ~/.local/share/applications/githandler.desktop            voce nel menu applicazioni
#   ~/.local/share/icons/hicolor/scalable/apps/githandler.svg icona
#
# Idempotente: rilanciato aggiorna i file esistenti.
#
#   ./build/install-local.sh --remove     toglie i tre file e gli indici che questo script crea
#
# Chi passa al pacchetto `.deb` deve toglierli prima: `~/.local/bin` viene prima di `/usr/bin` nel
# PATH e la voce utente ha la precedenza su quella di sistema.
set -euo pipefail

repo="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
bin="$HOME/.local/bin"
apps="$HOME/.local/share/applications"
icons="$HOME/.local/share/icons/hicolor/scalable/apps"

if [ "${1:-}" = "--remove" ]; then
	rm -f "$bin/githandler" "$apps/githandler.desktop" "$icons/githandler.svg"
	# Le versioni precedenti di questo script generavano un indice delle icone nella home: senza
	# toglierlo, il nome `githandler` continua a puntare al file rimosso e la griglia delle
	# applicazioni mostra una tile vuota anche dopo aver installato il pacchetto.
	rm -f "$HOME/.local/share/icons/hicolor/icon-theme.cache"
	update-desktop-database "$apps" 2>/dev/null || true
	echo "rimosso: $bin/githandler, $apps/githandler.desktop, $icons/githandler.svg"
	exit 0
fi

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

# AppArmor su Ubuntu 24.04+ blocca i namespace utente: solo lì serve --no-sandbox.
args=()
if [ "\$(cat /proc/sys/kernel/apparmor_restrict_unprivileged_userns 2>/dev/null || echo 0)" = "1" ]; then
	args+=(--no-sandbox)
fi

exec "\$app/node_modules/.bin/electron" "\$app" "\${args[@]}" "\$@"
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
# Niente `gtk-update-icon-cache` sulla home: l'indice che crea resta quando i file spariscono e
# copre l'icona del pacchetto. GTK legge la cartella lo stesso, sono tre file.

echo "installato:"
echo "  $bin/githandler"
echo "  $apps/githandler.desktop"
echo "  $icons/githandler.svg"
echo "apri GitHandler dal menu applicazioni, oppure esegui: githandler"
