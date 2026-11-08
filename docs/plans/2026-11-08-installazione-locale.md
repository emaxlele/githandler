# Installazione locale su Ubuntu (v0.5 → .deb)

> Obiettivo: aprire GitHandler dal menu applicazioni su questa macchina, senza pacchetto `.deb` e
> senza sudo. Ultimo aggiornamento: 2026-11-08

## Contesto

Il packaging `.deb` con profilo AppArmor è in milestone 4 e richiede una macchina pulita per la
verifica. Nel frattempo l'app si usa dall'albero dei sorgenti: `./build/install-local.sh` compila i
bundle e scrive tre file nel profilo utente.

| Cosa           | Dove                                                        |
| -------------- | ----------------------------------------------------------- |
| Launcher       | `~/.local/bin/githandler`                                   |
| Voce nel menu  | `~/.local/share/applications/githandler.desktop`            |
| Icona          | `~/.local/share/icons/hicolor/scalable/apps/githandler.svg` |
| Sorgente icona | `build/icon.svg` (nel repo, riusata dal `.deb`)             |

Il launcher ricompila con esbuild (~200 ms) a ogni avvio: il menu apre sempre il codice corrente.
`--no-sandbox` è obbligatorio perché AppArmor su Ubuntu 24.04 blocca il sandbox di Chromium.

## Passi

-   [x] Icona SVG coerente col tema dell'app (lane blu/verde/viola su `#0d1017`), verificata in
        Chromium — ImageMagick non è un riferimento valido per l'SVG
-   [x] `build/install-local.sh` idempotente: launcher + `.desktop` + icona, `update-desktop-database`
        e `gtk-update-icon-cache`
-   [x] `desktop-file-validate` pulito, `StartupWMClass=githandler` allineato a `package.json`
-   [x] Avvio reale verificato (finestra Wayland, titolo `githandler`), screenshot della UI rigenerati
        con `--shots`
-   [x] README, CHANGELOG, TODO e registro aggiornati
-   [ ] `.deb` con profilo AppArmor e verifica su macchina pulita (milestone 4)

## Rischi

-   Il launcher dipende dal percorso del repo (`GITHANDLER_HOME` come override) e da `node_modules`:
    se il repo si sposta, va rilanciato `install-local.sh`.
-   `--no-sandbox` è accettabile per un'app locale che carica solo file propri, ma non è la
    configurazione da spedire nel `.deb`: lì serve il profilo AppArmor.

## Verifica

```bash
./build/install-local.sh
desktop-file-validate ~/.local/share/applications/githandler.desktop
~/.local/bin/githandler --repo ~/Projects/AI_Knowledge   # finestra con titolo githandler
```

## Prompt per riprendere

> Nel repo `~/Projects/githandler` leggi `docs/plans/2026-11-08-installazione-locale.md`,
> `TODO.md` (milestone 4) e `docs/registro-attivita.md`. L'installazione locale con
> `build/install-local.sh` è fatta e verificata; resta il packaging `.deb` con profilo AppArmor
> (`electron-builder`), icona da `build/icon.svg`, e verifica su macchina pulita. Aggiorna
> CHANGELOG, TODO e registro e committa.
