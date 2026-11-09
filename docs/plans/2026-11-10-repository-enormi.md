# Repository che hanno superato il layout misurato

## Obiettivo

Il pannello della salute dice quanto è grande il repository e avvisa quando supera le dimensioni per
cui l'applicazione è stata misurata, senza aggiungere un costo all'aggiornamento automatico.

## Contesto

-   `src/core/health.ts` conteneva solo `assessHealth` su ref, stash, submodule e HEAD staccato. È
    puro TypeScript, quindi resta testabile con oggetti.
-   `src/main/backend.ts` -> `health()` metteva insieme `refresh()`, `stashList()` e `submodules()` in
    parallelo; `src/renderer/app.ts` -> `renderHealth` disegna le righe e conta le segnalazioni.
-   `docs/backend-performance.md` è la fonte delle soglie: 50.000 commit e 100.000 file sono le
    dimensioni provate dal benchmark, con il refresh sotto i 200 ms.
-   `bench/bench.mts` non misurava il costo dei due conteggi.

## Scelte

-   **Soglie dal documento, non inventate**: `LARGE_HISTORY_COMMITS = 50_000` e
    `LARGE_WORKTREE_FILES = 100_000`, con il confronto **strettamente maggiore**: alla soglia esatta
    il repository rientra ancora nel misurato.
-   **La misura è un ingresso di `assessHealth`** (`scale?: HealthScale`), non una lettura nascosta:
    il core resta puro e i test possono fissare i numeri. Senza misura `scale` è `{0, 0}` e
    `outgrown` è `false`.
-   **Il costo lo paga chi apre il pannello**: `measureScale()` in `src/main/backend.ts` lancia
    `rev-list --count HEAD` e `ls-files` in parallelo alle altre letture del pannello. Non entra in
    `refresh()`, che gira a ogni evento del filesystem.
-   **`outgrown` conta come segnalazione**: il pannello non dice più «a posto» e il contatore la
    include, perché è un'informazione che cambia cosa aspettarsi, non un errore.
-   **Numeri formattati con la lingua scelta** (`toLocaleString(localeTag())`), etichette dal
    catalogo i18n.

## Passi

-   [x] Core: `HealthScale`, le due soglie, `scale` e `outgrown` nel report, `clean` che li considera.
-   [x] Backend: `measureScale()` con i due comandi, in parallelo dentro `health()`.
-   [x] Renderer: riga «Repository molto grande» con i due conteggi e il motivo; contatore aggiornato.
-   [x] Catalogo inglese delle stringhe nuove.
-   [x] Test: soglia esatta, una dimensione oltre, l'altra oltre, assenza di misura; il test col
        repository vero controlla i conteggi letti da Git.
-   [x] Benchmark: riga `dimensioni (pannello salute)`; misura a 50.000/100.000 = **210 ms**.
-   [x] Documentazione: README (italiano e inglese), `docs/backend-performance.md` (riga in tabella e
        nota), CHANGELOG, TODO, ROADMAP, registro attività.

## Rischi

-   `rev-list --count HEAD` su un repository senza commit fallisce: `allowFailure` restituisce 0 e
    nessuna segnalazione, che è il comportamento giusto.
-   Il conteggio dei file tracciati non dice quanto è grande il _working tree_ reale né quanto costa
    `git status`: la soglia parla di quello che l'app disegna, non del disco.
-   Un repository enorme con poche migliaia di commit non supera nessuna delle due soglie anche se
    il checkout è lento: la misura è deliberatamente a due dimensioni sole.

## Verifica

```bash
npm run typecheck && npm test && npm run build
npm run bench -- --commits 50000 --files 100000
```

## Resume prompt

The repository health panel in GitHandler now reports the size of the repository:
`src/core/health.ts` exports `LARGE_HISTORY_COMMITS` (50,000), `LARGE_WORKTREE_FILES` (100,000),
`HealthScale` and puts `scale` and `outgrown` in the report (the comparison is strictly greater,
`clean` includes `!outgrown`). `src/main/backend.ts` -> `measureScale()` runs `git rev-list --count
HEAD` and `git ls-files` in parallel inside `health()`, never in `refresh()`. The renderer shows a
"Very large repository" row with the two localised counts. Verify with `npm run typecheck && npm test
&& npm run build` and `npm run bench -- --commits 50000 --files 100000`.
