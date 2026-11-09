#!/bin/sh
# Launcher inside the Flatpak sandbox.
#
# The Flatpak runtime already provides user namespaces, so the Chromium sandbox works; zypak
# keeps it working by giving Electron the process model it expects inside the sandbox. The
# per-app temporary directory is required because the sandbox has no /tmp of its own.
set -eu

export TMPDIR="${XDG_RUNTIME_DIR}/app/${FLATPAK_ID:-io.github.emaxlele.GitHandler}"

exec zypak-wrapper /app/githandler/electron /app/githandler/resources/app "$@"
