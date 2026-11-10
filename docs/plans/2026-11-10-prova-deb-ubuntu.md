# Prova del pacchetto `.deb` come un utente Ubuntu (2026-11-10)

## Obiettivo

Installare GitHandler sulla macchina come farebbe un utente Ubuntu: `apt` con il `.deb`, senza
launcher compilato dal sorgente, e verificare che l'app parta con il profilo AppArmor caricato e il
sandbox attivo.

## Contesto

-   `build/package-deb.sh` (`npm run deb`) costruisce `release/githandler_<versione>_amd64.deb` con il
    runtime Electron dentro, il launcher in `/usr/bin/githandler`, la voce nel menu, l'icona e il
    profilo AppArmor in `/etc/apparmor.d/githandler`, che `postinst` carica con `apparmor_parser -r`.
-   Si vuole riprodurre l'utente vero, quindi va **rimossa** l'installazione da sorgente
    (`build/install-local.sh`): `~/.local/bin/githandler`, la voce in
    `~/.local/share/applications/githandler.desktop` e l'icona utente coprono il pacchetto, perché
    `~/.local/bin` precede `/usr/bin` nel `PATH` e la voce utente precede quella di sistema.
-   `package.json` era a **0.10.0** mentre tutto il lavoro del giorno è sotto `[Non rilasciato]`: il
    pacchetto va costruito con la versione vera (0.12.0), altrimenti si prova un'app che non esiste e
    il controllo aggiornamenti confronta numeri sbagliati.
-   Nella shell dell'agente `sudo` non funziona (`no_new_privs`): il passo di installazione lo esegue
    l'utente, il resto è automatizzabile.

## Passi

-   [x] Bump a 0.12.0: `package.json`, CHANGELOG (sezione di rilascio datata), riferimenti di versione
        nei due README.
-   [x] `npm run deb`, poi ispezione senza privilegi: `dpkg-deb -I`, `dpkg-deb -c`,
        `desktop-file-validate` sulla voce estratta. Due difetti trovati e corretti nello script:
        `git` non era fra le dipendenze e le righe unite perdevano lo spazio dopo la virgola.
-   [x] Rimozione dell'installazione utente (launcher, `desktop`, icona): fatta, `githandler` non è
        più nel `PATH`.
-   [ ] `sudo apt install ./release/githandler_0.12.0_amd64.deb` (passo dell'utente: la shell
        dell'agente gira con `no_new_privs`, `sudo` risponde «flag is set»).
-   [ ] Verifica: `command -v githandler` → `/usr/bin/githandler`, `aa-status` con il profilo
        `githandler`, avvio senza `--no-sandbox`, voce nel menu.
-   [x] Registro attività aggiornato con l'esito (sezione 2026-11-10).

## Rischi

-   Il profilo AppArmor copre `/opt/githandler/electron`: se il percorso cambia, il sandbox ricade
    sull'helper setuid e poi su `--no-sandbox`. Il launcher dice quale dei tre sta usando solo
    indirettamente (assenza di `--no-sandbox` nei `ps`).
-   Togliendo i file utente non resta nessun `githandler` fino all'installazione: si ripristina con
    `bash build/install-local.sh`.
-   Il pacchetto è `amd64`: su ARM non si installa.

## Verifica

```bash
npm run typecheck && npm test && npm run build
npm run deb
dpkg-deb -I release/githandler_0.12.0_amd64.deb
dpkg-deb -c release/githandler_0.12.0_amd64.deb | grep -E 'apparmor|usr/bin|\.desktop|chrome-sandbox'
```

Dopo l'installazione: `githandler --ozone-platform=headless` per un avvio senza display, `aa-status`
per il profilo, `cat /proc/sys/kernel/apparmor_restrict_unprivileged_userns` per sapere se il sandbox
dipende dall'helper setuid.

**Fatto in un container `ubuntu:24.04` pulito** (utente non privilegiato `prova`, `xvfb-run` per il
display virtuale):

-   `apt-get install ./githandler_0.12.0_amd64.deb` installa la 0.12.0, tira dentro git e le librerie
    GTK, e lascia `chrome-sandbox` **4755 root**: il bit setuid arriva intatto.
-   `githandler --repo … --shots --shots-output …` parte da `/usr/bin/githandler` **senza**
    `--no-sandbox`, apre la finestra e produce **36 screenshot** (`shot-changes.png` 52 KB), uscita 0.
-   `apt-get purge githandler` non lascia niente: `/opt/githandler`, `/usr/bin/githandler`,
    `/etc/apparmor.d/githandler` e la voce nel menu spariscono.

Due cose imparate, da tenere presenti:

-   In un container Docker la sandbox di Chromium non riesce a creare i namespace senza
    `--cap-add=SYS_ADMIN` e `--security-opt seccomp=unconfined`: l'errore
    (`Failed to move to new namespace … Operation not permitted`) è del container, non del pacchetto.
    Con quei permessi, e con `xvfb-run`, l'app parte normalmente.
-   Il container non ha `apparmor_parser`, quindi `postinst` non carica il profilo: è il ripiego
    previsto (resta l'helper setuid). Il profilo si prova solo sul sistema vero, ed è il motivo per
    cui resta il passo di installazione sul computer dell'utente.

## Resume prompt

GitHandler was still only installed from source (`~/.local/bin/githandler`), so the `.deb` had never
been tried. This plan installs it the way an Ubuntu user would: version bumped to 0.12.0, package
built with `npm run deb`, user-level launcher and desktop entry removed, then
`sudo apt install ./release/githandler_0.12.0_amd64.deb` run by the user (the agent shell has
`no_new_privs` and cannot use sudo). Verify the AppArmor profile is loaded, the app starts without
`--no-sandbox`, and `apt purge` leaves nothing behind; then record the outcome in
`docs/registro-attivita.md`.
