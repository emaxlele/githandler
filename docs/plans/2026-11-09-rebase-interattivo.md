# Rebase interattivo

## Obiettivo

Riscrivere una serie di commit locali — riordinarli, unirli, rinominarli o toglierli — da una
finestra dell'app, senza terminale e senza inviare niente al remoto.

## Contesto

-   Git fa il lavoro con `git rebase -i <base>`: il piano è il file `git-rebase-todo` che
    `GIT_SEQUENCE_EDITOR` può sostituire. L'editor è un piccolo script in una cartella temporanea
    che copia il piano preparato; nessun input dell'utente passa per la shell.
-   `reword` non richiede un editor per ogni commit: nel todo diventa `pick` seguito da
    `exec git commit --amend --no-verify -F <messaggio>`, con il messaggio completo in un file
    temporaneo.
-   `squash` apre l'editor del messaggio: `GIT_EDITOR=true` lascia il messaggio combinato di Git.
-   La regola del piano è pura (`src/core/rebase.ts`), i comandi restano nel main.
-   L'operazione è già coperta dal journal di undo: `#record` conserva HEAD prima del rebase e
    `#finalizeUndo` scrive il nuovo HEAD, così `Undo` riporta indietro tutto.

## Passi

-   [x] `src/core/rebase.ts`: azioni, `validateRebaseSteps`, `assertPlanCovers`, `rebaseTodo`,
        `rebasePlanArgs`, `parseRebaseCandidates`, `subjectOf`.
-   [x] Backend `rebaseCandidates` (antenato, primo commit, merge, limite di 50) e
        `rebaseInteractive` (SHA risolti, HEAD invariato, voce di undo, editor temporaneo).
-   [x] IPC, preload, tipi condivisi.
-   [x] Dialog «Rebase interattivo», voce nel menu del commit e nella palette, riordino, select per
        azione, textarea per reword, i18n.
-   [x] Test `tests/rebase.test.mts` (piano puro e repository reale con undo).
-   [x] README (IT/EN), CHANGELOG, TODO, ROADMAP, registro attività e scenari di screenshot.

## Rischi

-   Un rebase riscrive la storia: il piano copre **tutti** i commit dell'intervallo e un commit
    omesso è un errore, non un drop implicito.
-   I merge nell'intervallo verrebbero appiattiti: vengono rifiutati con un messaggio esplicito.
-   Se la storia cambia tra anteprima e applicazione, il backend rifiuta il piano e chiede di
    riaprirlo.
-   `reword` salta gli hook del commit (`--no-verify`): il contenuto non cambia, si riscrive solo il
    messaggio.

## Verifica

```bash
npm run typecheck && npm test && npm run build
GITHANDLER_LOCALE=en npm run shots -- --repo /tmp/gitdemo --shots-output /tmp/shots/app.png
```

## Resume prompt

Leggi `docs/plans/2026-11-09-rebase-interattivo.md`. Il rebase interattivo è completo: la finestra
elenca i commit, il piano è validato in `src/core/rebase.ts`, il backend rifiuta merge, commit fuori
dall'intervallo e HEAD cambiato. Se riprendi, verifica che un drop non perda gli altri commit, che
reword conservi il corpo e che `Undo` riporti la storia di prima. Poi passa al prossimo elemento di
`TODO.md`.
