# Stash nella barra laterale, selezione multipla e azioni sulla selezione del diff (2026-11-12)

Stato: **completato**. Verifica finale: `npm run typecheck && npm test && npm run build` (309 test),
più una prova end-to-end con CDP (14 controlli) su un repository temporaneo.

## Obiettivo

Tre richieste arrivate insieme:

1.  **Gli stash si vedono nella barra laterale**, in una sezione richiudibile aperta di default, con un
    contatore; clic (o tasto destro) su una voce apre un menu con Applica / Pop / Elimina. La lista
    esce dalla finestra dello stash, che resta il posto dove lo stash si _crea_.
2.  **In Changes si possono scegliere più file**: clic semplice (uno), Ctrl+clic (uno in più o uno in
    meno), Shift+clic (intervallo dal file toccato prima). I pulsanti della riga e il menu del tasto
    destro agiscono su tutta la scelta: stage, unstage, scarto e stash di più file in un colpo solo.
3.  **Nel diff, sulle righe o sull'hunk scelti**: Stage, Unstage, **Stash** e **Scarta**, senza
    passare dal file intero. Stage e Unstage esistono già; il nuovo è lo stash e lo scarto parziali.

## Contesto

-   `src/core/patch.ts` costruisce una patch applicabile a partire da una selezione di hunk/righe
    (`buildPatch`, `HunkSelection`, direzioni `stage`/`unstage`) e `patchTargetsOnly` impedisce che una
    patch costruita male tocchi altri file. Il diff (`src/renderer/diff-view.ts`) sa già emettere i
    pulsanti per hunk e le righe selezionabili; gli eventi sono delegati in `app.ts`
    (`ui.changesDiff` → `applyPartial`).
-   `git stash push -- <path>` salva i file indicati e lascia gli altri; `stashList` legge lo stack.
    Lo stash _parziale_ non ha un equivalente portabile: `git stash push --staged` esiste da Git 2.35
    e il progetto dichiara 2.23 come minimo.
-   Lo scarto ha già una rete di sicurezza: `discard` registra una voce di annullamento con lo snapshot
    del working tree (`git stash create`). Lo scarto parziale usa lo stesso meccanismo.
-   Regola di progetto: le azioni distruttive chiedono conferma e dicono cosa si perde e cosa resta
    recuperabile; i path che arrivano dalla finestra restano dentro il repository (`assertSafePath`).
-   Lezione della correzione precedente: la barra laterale si ridisegna anche quando la scheda attiva
    cambia senza un aggiornamento del repository, quindi i dati per repository (stash, scelta
    dell'account) si tengono **per root** e si rileggono in `renderSession`.

## Passi

-   [x] Core (`src/core/patch.ts`): `complementSelection(file, selection)` — la selezione opposta.
-   [x] Core (`src/core/patch.ts`): `revertPatch(file, selection)` — la patch che, applicata al
        contrario al file com'è adesso, toglie solo la parte scelta. Le aggiunte non scelte restano
        come contesto, le rimozioni non scelte non compaiono: è la forma che serve per non portare via
        le altre modifiche dello stesso hunk.
-   [x] Main (`src/main/backend.ts`): - `stashPatch(path, message, selected, revert)`: la voce di stash si costruisce con un
        **indice temporaneo** (`read-tree HEAD` + `apply --cached`), due `commit-tree` e
        `git stash store`, perché `--staged` non è disponibile ovunque; poi le righe scelte escono
        dal file con `git apply --reverse` della patch di ripristino. Se il file non torna
        indietro, `stash drop` toglie la voce appena creata. - `discardPatch(path, patch, mode)`: `stash create` per l'annullamento, `git apply --reverse`
        al working tree (e all'indice quando il diff mostrato è quello in stage), voce «discard»
        nel journal come per lo scarto intero.
-   [x] Contratto: due metodi in `src/shared/api.ts`, due canali, preload, handler in
        `src/main/index.ts`.
-   [x] Finestra, sezione stash: markup `#section-stash` nella barra laterale (dopo «All Commits»), con
        contatore; `renderStashes()` alimentato da `stashList()` per repository; clic e tasto destro
        aprono lo stesso menu (Applica / Pop / Elimina…); la lista esce dal dialog `#stash-dialog`.
-   [x] Finestra, selezione multipla: `changeChosen` (Set di path, lato attivo), `changeAnchor` per
        l'intervallo, classi `.is-selected` (file di cui si vede il diff) e `.is-chosen` (gli altri
        scelti); i pulsanti di riga e il menu del tasto destro agiscono sulla scelta quando la riga ne
        fa parte; le voci del menu dicono quanti file sono; i path spariti si tolgono dalla scelta a
        ogni snapshot.
-   [x] Finestra, diff: menu `⋯` dell'hunk con Stage/Unstage, **Metti nello stash** (solo lato non in
        stage e solo se il file non ha nulla in stage, perché lo stash partirebbe dal file intero) e
        **Scarta…** con conferma.
-   [x] Catalogo inglese per tutte le stringhe nuove.
-   [x] Test: core in `tests/patch.test.mts` (complemento e ripristino), backend contro git vero in
        `tests/patch-actions.test.mts` (stash e scarto di una parte **dentro lo stesso hunk**, lato in
        stage, annullamento, rifiuto di una patch che tocca un altro file).
-   [x] Documentazione: CHANGELOG, README italiano e inglese, `docs/registro-attivita.md`, TODO.
-   [x] `npm run typecheck && npm test && npm run build`, più una prova end-to-end con CDP sulle tre
        funzioni e gli screenshot.

## Rischi

-   **Due patch per lo stash parziale**: `selected` costruisce il contenuto dello stash, `revert`
    toglie le stesse righe dal file. Se il file non corrisponde alla patch di ritorno il controllo
    `--check --reverse` si ferma prima di creare la voce, quindi non resta niente a metà.
-   **Una sola aggiunta scelta dentro un hunk che ha anche una rimozione**: la riga aggiunta esce, la
    rimozione resta dov'è (il file non la conteneva più). È il prezzo di agire solo su ciò che è stato
    scelto; il caso è fissato in un test.
-   **Lo stash di righe non è disponibile se il file ha già qualcosa in stage**: la voce del menu è
    disabilitata con il motivo nel tooltip.
-   **Lo scarto parziale del lato in stage** toglie la parte scelta dall'indice e dal disco; se il
    working tree ha altre modifiche sulle stesse righe `git apply --reverse` non combacia e non si
    tocca niente. Il contenuto di prima resta nello stash di annullamento.
-   **La selezione multipla è per lato**: cambiando lista la scelta riparte.
-   Il contatore degli stash si rilegge a ogni aggiornamento del repository e al cambio scheda.

## Verifica

```bash
npm run typecheck && npm test && npm run build
```

Fatto: 309 test verdi (7 con `git` vero nel nuovo `tests/patch-actions.test.mts`, 3 sul core in
`tests/patch.test.mts`). Prova end-to-end con CDP su un repository temporaneo con due stash, cinque
file modificati e due hunk lontani: contatore e menu degli stash, Ctrl e Shift con stage di tre file,
menu dell'hunk, stash parziale (tre voci nello stack, l'altra modifica resta nel file), scarto
parziale e «Annulla». 14 controlli superati; screenshot in `/tmp/opencode/e2e/shots/`.

## Resume prompt

GitHandler now shows the stash stack in the sidebar (collapsible section with a count, click and
right-click opening apply/pop/drop, stash list removed from the stash dialog), lets Changes select
several files with Ctrl and Shift so row buttons and the context menu act on the whole selection, and
adds a `⋯` menu on each diff hunk with put-in-stash and discard for the selected lines or the whole
hunk. Core: `complementSelection` and `revertPatch` in `src/core/patch.ts` (the second one builds the
patch that, reverse-applied to the current file, removes only the chosen part). Backend:
`stashPatch(path, message, selected, revert)` builds the stash entry with a temporary index, two
`commit-tree` calls and `git stash store`, then reverse-applies `revert`; `discardPatch(path, patch,
mode)` records an undo entry and reverse-applies to the worktree (and the index for the staged side).
Remaining work, if any: run `npm run typecheck && npm test && npm run build` and keep the changelog,
both READMEs and `docs/registro-attivita.md` in sync.
