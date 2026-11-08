# Changelog

## [0.2.1] — 2026-11-08

### Aggiunto

-   `npm run bench`: misura il costo reale del backend su un repository temporaneo — `git log` e
    parsing di 5.000 e 50.000 commit, layout del grafo, `git status` su 100.000 file.
-   `docs/backend-performance.md`: i numeri, il confronto `git` CLI / libgit2 (hook, filtri, LFS,
    sparse checkout) e le soglie oltre le quali ha senso un core nativo.

## [0.2.0] — 2026-11-08

### Aggiunto

-   **Diff affiancato** (prima/dopo) accanto a quello unified, con selettore nella barra delle
    schede; l'accoppiamento riga per riga segue l'ordine di Git (rimozioni contro aggiunte) e le
    parti che cambiano davvero sono evidenziate all'interno della riga. La scelta del formato è
    ricordata fra un avvio e l'altro.

-   **Staging parziale**: ogni hunk del diff di lavoro ha i pulsanti per mettere in stage (o togliere
    dallo stage) il singolo hunk; cliccando i numeri di riga si sceglie una o più righe e si applica
    solo quella selezione. Le patch parziali sono costruite nel core e applicate con
    `git apply --cached` (o `--reverse` per l'unstage), quindi hooks e filtri di Git restano attivi.
-   Test: 7 nuovi casi sul costruttore di patch e 2 di integrazione su repository reale, che
    verificano il contenuto esatto dell'indice dopo uno stage parziale e il suo ripristino.

### Note

-   Nuovi file, file eliminati, binari e rinominati restano a staging intero: la patch parziale non
    li copre (nel diff compaiono senza i pulsanti per hunk).

## [0.1.0] — 2026-11-08

Prima versione funzionante.

### Aggiunto

-   Apertura di un repository (dialog di sistema o `--repo <path>`).
-   Storia completa con grafo a corsie: merge, octopus, rami paralleli, decorazioni `HEAD`, rami
    locali, remoti e tag attaccate per SHA.
-   Elenco di rami locali, remoti e tag con ahead/behind; click per checkout; creazione di un ramo.
-   Dettaglio commit: file toccati con stato e diff unified con numerazione di riga.
-   Working tree: elenco delle modifiche (staged, unstaged, non tracciate, conflitti), diff per file,
    stage e unstage anche multipli, scarto con conferma.
-   Commit con messaggio su stdin (nessun problema di quoting) e opzione `-a`.
-   `git fetch --all --prune` su richiesta.
-   Navigazione da tastiera: `↑`/`↓` nella storia, `Ctrl+R` per aggiornare, `Ctrl+Invio` per il commit.
-   28 test automatici: parser di `log`, `status --porcelain=v2 -z`, diff, layout del grafo e nove test
    di integrazione contro un repository git reale.

### Note

-   Rendering software di default (`GITCRAFT_GPU=1` per l'accelerazione): su macchine senza GPU
    utilizzabile Chromium non avvia il processo GPU.
-   In sviluppo su Ubuntu 24.04+ serve `--no-sandbox`; il profilo AppArmor arriva con il packaging.
