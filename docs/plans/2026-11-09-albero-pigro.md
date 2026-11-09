# Albero dei file pigro

## Obiettivo

Nel File Tree, oltre all'elenco dei soli file toccati, mostrare l'albero completo del commit o di
HEAD leggendo una cartella alla volta, con lo stesso diff a destra e lo stesso stato dei file.

## Contesto

-   `git ls-tree -z <ref> -- <cartella>/` restituisce solo il livello richiesto: è la base per un
    albero pigro. La radice è il percorso vuoto, altrimenti il ramo finale `/` è obbligatorio per
    elencare il contenuto di una cartella invece della cartella stessa.
-   Un repository senza commit non ha `HEAD`: `allowFailure` restituisce un elenco vuoto.
-   Il parser è puro e sta in `src/core/tree.ts`; il comando e il filesystem restano nel main.
-   La vista normale continua a usare `buildTree` sui file dello snapshot: il cambio è un pulsante,
    non un secondo albero sempre presente.

## Passi

-   [x] `src/core/tree.ts`: `parseTreeEntries` e `sortTreeEntries` (cartelle prima).
-   [x] Backend `treeEntries(ref, path)`, IPC, preload e tipi condivisi; radice vuota, `HEAD`,
        `assertSafePath`, elenco vuoto senza commit.
-   [x] Renderer: `treeAll`, `lazyTree`, `lazyExpanded`, `lazyLoading`; `renderLazyTree`,
        `loadTreeDir`, `treeStatus`; il clic su una cartella espande o chiude, su un file apre il diff.
-   [x] Pulsante «Tutti i file» / «Modifiche», titolo e i18n.
-   [x] Cache scartata cambiando commit o quando HEAD si muove.
-   [x] Test `tests/tree.test.mts` (parser, cartella annidata, percorso non valido, repository vuoto).
-   [x] README (IT/EN), CHANGELOG, TODO, ROADMAP, registro attività e scenario di screenshot.

## Rischi

-   L'albero legge HEAD, non il disco: i file non tracciati non compaiono in «Tutti i file». In
    «Modifiche» restano elencati e il badge di stato continua a funzionare.
-   Le cartelle lette sono in memoria per la vista corrente: cambiando commit si riparte dalla radice,
    così non si mostrano file di un commit diverso.
-   Una cartella molto grande costa una richiesta sola; l'apertura resta sotto il secondo su un
    repository di prova. Non è stata fatta una misura su un repository enorme.

## Verifica

```bash
npm run typecheck && npm test && npm run build
GITHANDLER_LOCALE=en npm run shots -- --repo /tmp/gitdemo --shots-output /tmp/shots/app.png
```

## Resume prompt

Leggi `docs/plans/2026-11-09-albero-pigro.md`. L'albero pigro è completo: «Tutti i file» legge una
cartella alla volta con `git ls-tree -z`, «Modifiche» torna all'elenco dei file toccati, e le cartelle
lette si scartano cambiando commit. Se riprendi, verifica che una cartella annidata si apra e chiuda,
che un repository senza commit mostri l'albero vuoto e che il clic su un file apra il diff giusto. Poi
passa al prossimo elemento di `TODO.md`.
