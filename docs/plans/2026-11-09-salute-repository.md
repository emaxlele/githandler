# Salute del repository

## Obiettivo

Una finestra di sola lettura che metta insieme i segnali che non fermano il lavoro ma è meglio
vedere: rami divergenti, rami senza upstream, stash dimenticati, submodule non aggiornati e HEAD
staccato.

## Contesto

-   `Snapshot` porta ref (con `upstream`, `ahead`, `behind`), stato e operazione sospesa.
-   `CliGitBackend` sa già leggere stash (`stashList`) e submodule (`submodules`), con i parser nel
    core.
-   La regola non deve dipendere da Git né dalla rete: `assessHealth` riceve dati e `now`, così si
    prova con oggetti qualsiasi e i test restano veloci.
-   Il renderer ha la palette dei comandi e il pattern dei dialog con elenco e stato (`actions-list`).

## Passi

-   [x] `src/core/health.ts`: `HealthInput`, `HealthReport`, `assessHealth`, soglia di 30 giorni.
-   [x] `CliGitBackend.health`: `refresh`, `stashList` e `submodules` in parallelo.
-   [x] Canale `git:health`, preload e tipi in `src/shared/api.ts`.
-   [x] Dialog «Salute del repository», voce nella palette, aggiornamento manuale, i18n.
-   [x] Test `tests/health.test.mts`: casi puri e repository reale con ramo senza upstream.
-   [x] README, CHANGELOG, TODO, ROADMAP, registro attività e scenario di screenshot.

## Rischi

-   `refresh` legge anche la storia: la finestra si apre su richiesta, non a ogni cambio.
-   La soglia degli stash è un promemoria, non una regola di Git; è una costante esportata.
-   La raggiungibilità dei remoti richiederebbe rete: resta fuori e il TODO lo dice.

## Verifica

```bash
npm run typecheck && npm test && npm run build
GITHANDLER_LOCALE=en npm run shots -- --repo /tmp/gitdemo --shots-output /tmp/shots/app.png
```

## Resume prompt

Leggi `docs/plans/2026-11-09-salute-repository.md`. La finestra «Salute del repository» è completa:
`src/core/health.ts` classifica i dati, `CliGitBackend.health` li raccoglie e il dialog li mostra
senza modificare niente. Per riprenderlo: verifica che `diverged` consideri solo rami locali con
`ahead` e `behind` maggiori di zero, che gli stash oltre 30 giorni siano ordinati dal più vecchio e
che i submodule `clean` non compaiano. Poi passa al prossimo elemento di `TODO.md`.
