# Notifiche CI dalla barra di sistema

> Un'icona nella barra di sistema e un avviso quando un workflow del repository attivo fallisce,
> senza tenere la finestra davanti. Creato il 2026-11-09.

## Obiettivo

Chi lancia i controlli e passa ad altro vuole sapere subito se qualcosa si è rotto. L'app ha già la
finestra delle GitHub Actions, ma chiede di essere aperta. Questa fase aggiunge un'icona con un menu
minimo e una notifica quando un'esecuzione **diventa** un errore; quello che era già rosso all'avvio
non produce una raffica di avvisi.

Fuori perimetro: notifiche da GitLab/Gitea/Bitbucket (le esecuzioni che l'app legge sono quelle di
GitHub, come la finestra dedicata) e azioni sulla notifica oltre all'apertura della finestra.

## Contesto

-   `src/core/actions.ts` e `src/main/actions.ts`: `WorkflowRun` e `listWorkflowRuns(root)`, con il
    contesto del repository (remoto `origin`, account scelto, token) e timeout.
-   `src/main/index.ts`: `activeRoot` è il repository della scheda attiva; `window` è la finestra
    principale; `shotsMode` spegne tutto ciò che non è deterministico negli screenshot.
-   `src/main/settings.ts`: `loadSettings`, per la lingua di icona e notifiche (`auto` → sistema).
-   `build/icon.svg` è il logo; l'icona della barra è un PNG 32×32 ricavato da quello.

## Passi

-   [x] `src/core/ci.ts`: `CiState` (`seen`, `seeded`), `isCiFailure` (`failure`, `timed_out`,
        `startup_failure`, `action_required`), `newFailures` (primo giro silenzioso, un avviso per
        transizione, mappa ricostruita a ogni giro).
-   [x] `src/main/tray.ts`: `startCiNotifier({ getRoot, showWindow, disabled })` con icona, menu
        («Mostra», «Controlla adesso», interruttore, «Esci»), polling ogni due minuti, notifica con
        clic che riporta la finestra, errori su stderr una volta sola.
-   [x] Icona `build/tray.png` (`convert -background none build/icon.svg -resize 32x32 -depth 8`),
        copiata in `dist/` da `esbuild.mjs` e quindi inclusa nel pacchetto `.deb`.
-   [x] Collegamento in `src/main/index.ts`: avvio dopo `createWindow`, `stop` su `before-quit`,
        controllo immediato quando un repository diventa attivo (`openBackend`, `git:use`), spento in
        `shotsMode`.
-   [x] Test `tests/ci.test.mts` (4 casi).
-   [x] README (italiano e inglese), CHANGELOG, registro, TODO, ROADMAP.

## Rischi

-   **Rate limit**: una chiamata ogni due minuti per il repository attivo, la stessa che fa la
    finestra delle Actions quando la si apre. Nessun polling in background con la finestra chiusa
    perché su Linux `window-all-closed` chiude l'app.
-   **Senza barra di sistema** (sessioni minimali, GNOME senza estensione): `new Tray` può fallire;
    l'errore va su stderr e l'app continua senza icona.
-   **Lingua**: icona e notifiche leggono `Settings.locale` all'avvio; cambiare lingua dall'app
    ricarica la finestra, non il processo, quindi l'icona resta nella lingua di partenza fino al
    riavvio. È un limite noto, non un errore.
-   **Doppioni**: la mappa ricorda l'esito già visto; una stessa esecuzione non avvisa due volte.

## Verifica

```bash
npm run typecheck && npm test && npm run build
# avvio con icona e polling attivi, su un repository senza remoto:
timeout 15 ./node_modules/.bin/electron . --user-data-dir=/tmp/githandler-traytest \
  --ozone-platform=headless --no-sandbox --repo /tmp/gitsearch
```

L'errore atteso («origin non è un repository su un servizio web») compare **una volta** su stderr:
significa che il polling è partito e che la deduplica funziona. La resa grafica dell'avviso va vista
su un desktop con la barra di sistema; i test coprono la regola che decide quando avvisare.

## Prompt per riprendere

> In `~/Projects/githandler` leggi `docs/plans/2026-11-09-notifiche-ci.md`. Le notifiche CI dal tray
> sono fatte (GitHub, primo giro silenzioso, avviso una volta sola). La roadmap è chiusa per le fasi
> 1–4: la prossima voce è nella sezione «Daily quality» (rete con avanzamento da `git`, stash
> parziale, temi). Regole: codice in inglese, UI bilingue via `src/renderer/i18n.ts`, nessun nome di
> altri client Git. Verifica con `npm run typecheck && npm test && npm run build`, aggiorna registro,
> CHANGELOG e TODO.
