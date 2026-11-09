# AppImage, pacchetto RPM e profilo AppArmor

## Obiettivo

Distribuire GitHandler anche fuori da Ubuntu: un AppImage portabile, un pacchetto RPM per
Fedora/RHEL/openSUSE e il profilo AppArmor dentro il `.deb`, così il sandbox di Chromium resta
attivo su Ubuntu 24.04+.

## Contesto

-   `build/package-deb.sh` impacchetta Electron in `/opt/githandler` con launcher, voce nel menu,
    icona e documentazione.
-   Il runtime Electron non ha il bit setuid su `chrome-sandbox`; su Ubuntu 24.04+ il sandbox a
    namespace utente è limitato da AppArmor.
-   `appimagetool` e `rpmbuild` non sono dipendenze npm: vanno installati a parte, e lo script deve
    dirlo chiaramente.
-   L'AppImage è montata in sola lettura, quindi non può usare l'helper setuid: là serve il ripiego
    `--no-sandbox` sui sistemi che limitano i namespace.

## Scelte

-   **AppImage**: `build/package-appimage.sh`, icona PNG 256×256 generata da `build/icon.svg`,
    `AppRun` che calcola la propria cartella e passa `--no-sandbox` solo quando il sandbox non può
    funzionare. Output `release/GitHandler-<versione>-x86_64.AppImage`.
-   **RPM**: `build/package-rpm.sh` con uno spec generato al volo, dipendenze ricavate dai soname
    degli ELF, layout identico al `.deb`; output `release/githandler-<versione>-1.<arch>.rpm`.
-   **`.deb`**: `chrome-sandbox` installato 4755 (sandbox primario), profilo AppArmor in
    `/etc/apparmor.d/githandler` come conffile, `postinst` che lo carica e `prerm` che lo scarica.
    Il launcher usa `--no-sandbox` solo se il bit setuid è sparito e i namespace sono limitati.
-   **Licenza nel copyright**: corretto `MIT` in `GPL-3.0-or-later`, coerente con `LICENSE`.

## Passi

-   [x] Script AppImage e icona PNG.
-   [x] Script RPM con spec generato e verifica di modalità, proprietario e dipendenze.
-   [x] Profilo AppArmor, launcher setuid con ripiego e integrazione nel `.deb`.
-   [x] `package.json`: `npm run appimage`, `npm run rpm`.
-   [x] Verifica: AppImage avviata in headless con screenshot; `.deb` ispezionato (setuid, conffile,
        maintainer script); `.rpm` ispezionato; profilo caricato e applicazione avviata.
-   [ ] Prova del solo sandbox su macchina pulita: questa shell eredita un profilo con `userns`,
        quindi non dimostra il caso di un avvio dal menu senza profilo.
-   [x] Documentazione: README italiano e inglese, CHANGELOG, TODO, ROADMAP, registro attività.

## Rischi

-   L'AppImage non può usare il sandbox setuid: sui sistemi con namespace limitati resta
    `--no-sandbox`, dichiarato nel launcher.
-   Il profilo AppArmor è specifico per `/opt/githandler/electron`; un'installazione locale nei
    sorgenti continua a usare il ripiego, e va bene così.
-   Il pacchetto RPM non è installabile su questa macchina: la verifica è strutturale e dei
    metadati, non un'installazione reale.

## Verifica

```bash
npm run typecheck && npm test && npm run build
npm run appimage
npm run rpm
APPIMAGE_EXTRACT_AND_RUN=1 ./release/GitHandler-<versione>-x86_64.AppImage --shots ...
rpm --dbpath "$(mktemp -d)" -qp --queryformat '[%{FILEMODES:perms} %{FILENAMES}\n]' release/*.rpm
```

## Resume prompt

Finish distribution for GitHandler: build an AppImage with `build/package-appimage.sh` and an RPM
with `build/package-rpm.sh`, keep the `.deb` layout, and verify artifacts with the packaged app
headless. The `.deb` must carry `build/githandler.apparmor`, load it in `postinst`, install
`chrome-sandbox` setuid 4755, and let the launcher fall back to `--no-sandbox` only when needed.
Run `npm run typecheck && npm test && npm run build` and update CHANGELOG, TODO, ROADMAP, README
and `docs/registro-attivita.md`.
