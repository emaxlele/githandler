#!/usr/bin/env bash
# Build an .rpm (x86_64) with the Electron runtime inside.
#
#   ./build/package-rpm.sh   → release/githandler-<version>-1.x86_64.rpm
#
# The layout matches the .deb: /opt/githandler, /usr/bin/githandler, desktop entry, icon.
# Dependencies are generated from the ELF sonames, so package names stay correct on Fedora,
# RHEL and openSUSE without a hand-written list.
set -euo pipefail

repo="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$repo"

version="$(node -p "require('./package.json').version")"
arch="$(uname -m)"
top="$(mktemp -d)"
trap 'rm -rf "$top"' EXIT

echo "build dei bundle"
npm run --silent build

electron="node_modules/electron/dist"
if [ ! -x "$electron/electron" ]; then
	echo "githandler: runtime Electron assente, esegui npm install" >&2
	exit 1
fi

install -d "$top/SOURCES" "$top/BUILD" "$top/RPMS" "$top/SRPMS"
sources="$top/SOURCES"

# Package payload: the Electron runtime plus the compiled application.
install -d "$sources/app/resources/app"
cp -a "$electron/." "$sources/app/"
rm -f "$sources/app/resources/default_app.asar"
cp -a dist "$sources/app/resources/app/dist"
node -e '
	const fs = require("node:fs");
	const pkg = JSON.parse(fs.readFileSync("package.json", "utf8"));
	const out = { name: pkg.name, productName: pkg.productName, version: pkg.version, description: pkg.description, main: pkg.main, license: pkg.license };
	fs.writeFileSync(process.argv[1], JSON.stringify(out, null, "\t") + "\n");
' "$sources/app/resources/app/package.json"

# The setuid helper lets Chromium keep its sandbox on Ubuntu 24.04+, where user namespaces
# are restricted. The mode is preserved by rpmbuild.
chmod 4755 "$sources/app/chrome-sandbox"

cat >"$sources/githandler.launcher" <<'LAUNCHER'
#!/usr/bin/env bash
# Launch GitHandler installed under /opt.
set -euo pipefail

app=/opt/githandler
args=()

# With the setuid helper present the Chromium sandbox works even when user namespaces are
# restricted; without it, fall back to --no-sandbox only on those systems.
if [ ! -u "$app/chrome-sandbox" ] &&
	[ "$(cat /proc/sys/kernel/apparmor_restrict_unprivileged_userns 2>/dev/null || echo 0)" = "1" ]; then
	args+=(--no-sandbox)
fi

exec "$app/electron" "$app/resources/app" "${args[@]}" "$@"
LAUNCHER
chmod 755 "$sources/githandler.launcher"

cat >"$sources/githandler.desktop" <<'DESKTOP'
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
chmod 644 "$sources/githandler.desktop"

install -m 644 build/icon.svg "$sources/githandler.svg"

{
	echo "Format: https://www.debian.org/doc/packaging-manuals/copyright-format/1.0/"
	echo "Upstream-Name: githandler"
	echo "Source: https://github.com/emaxlele/githandler"
	echo
	echo "Files: *"
	echo "Copyright: 2026 emaxlele"
	echo "License: GPL-3.0-or-later"
	sed 's/^/ /' LICENSE
} >"$sources/copyright"

today="$(LC_ALL=C date '+%a %b %d %Y')"

cat >"$top/githandler.spec" <<SPEC
Name:           githandler
Version:        $version
Release:        1
Summary:        Client Git desktop Linux-first
License:        GPL-3.0-or-later
URL:            https://github.com/emaxlele/githandler
BuildArch:      $arch
Source0:        app
Source1:        githandler.launcher
Source2:        githandler.desktop
Source3:        githandler.svg
Source4:        copyright

%description
Grafo della storia, diff unified e affiancato, staging parziale per hunk e riga,
undo generale, recupero dei file non tracciati come oggetti Git, terminale
integrato e server MCP con permessi configurabili.

%prep

%build

%install
rm -rf %{buildroot}
mkdir -p %{buildroot}/opt
cp -a %{_sourcedir}/app %{buildroot}/opt/githandler
install -Dm755 %{_sourcedir}/githandler.launcher %{buildroot}/usr/bin/githandler
install -Dm644 %{_sourcedir}/githandler.desktop %{buildroot}/usr/share/applications/githandler.desktop
install -Dm644 %{_sourcedir}/githandler.svg %{buildroot}/usr/share/icons/hicolor/scalable/apps/githandler.svg
install -Dm644 %{_sourcedir}/copyright %{buildroot}/usr/share/doc/githandler/copyright
chmod -R go-w %{buildroot}/opt/githandler

%files
%defattr(-,root,root,-)
/opt/githandler
/usr/bin/githandler
/usr/share/applications/githandler.desktop
/usr/share/icons/hicolor/scalable/apps/githandler.svg
/usr/share/doc/githandler/copyright

%changelog
* $today emaxlele <emaxlele@users.noreply.github.com> - $version-1
- Pacchetto RPM iniziale con runtime Electron incluso.
SPEC

rpmbuild -bb \
	--define "_topdir $top" \
	--define "_build_id_links none" \
	"$top/githandler.spec" >/dev/null

mkdir -p release
built="$(find "$top/RPMS" -name 'githandler-*.rpm' -print -quit)"
if [ -z "$built" ]; then
	echo "githandler: rpmbuild non ha prodotto il pacchetto" >&2
	exit 1
fi
out="release/$(basename "$built")"
cp "$built" "$out"
chmod 644 "$out"
echo "creato: $out ($(du -h "$out" | cut -f1))"
rpm --dbpath "$top/rpmdb" --initdb
rpm --dbpath "$top/rpmdb" -qp --queryformat '%{NAME} %{VERSION}-%{RELEASE} %{ARCH}\n' "$out"
