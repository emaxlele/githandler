# Changelog

## [0.3.0] — 2026-11-08

### Aggiunto

-   **Undo generale**: prima di un commit, un checkout o uno scarto l'app registra lo stato in
    `refs/gitcraft/snapshots/*` e in un journal in `.git/gitcraft/undo.json` (massimo 50 voci).
    Il pulsante in barra (o `Ctrl+Z`) riporta indietro: il commit con `reset --soft` (le modifiche
    restano in stage), il checkout tornando al ramo precedente, lo scarto ripristinando il contenuto
    dal commit di stash registrato. I file non tracciati restano fuori: la conferma lo dice.
-   **Sorveglianza del repository** (`--watch`, `GITCRAFT_WATCH=1`): `fs.watch` ricorsivo con debounce,
    filtro su `.git/objects`, `node_modules` e file di lock; il renderer si aggiorna da solo, mostra
    il chip **Live** e avvisa solo quando cambia HEAD. Un solo refresh in volo, gli eventi si accodano.
-   **Ricerca nella storia**: barra sopra il log con testo letterale, `author:` e `file:`; risultati
    nel grafo con conteggio e ripristino con `Esc`. La query è nel core, quindi la usa anche l'API.
-   **Server MCP in sola lettura** (`npm run mcp`, `dist/mcp/index.js`): `repo_status`, `history`,
    `show_commit`, `worktree_diff`, `blame` su stdio, senza dipendenze e con lo stesso backend della
    UI. Configurazione e limiti in `docs/mcp.md`.
-   Parser di `git blame --line-porcelain` e `formatDiff` nel core.

### Corretto

-   Gli errori di Git mostrano anche l'output su stdout quando stderr è vuoto (per esempio il
    "nothing to commit" di un commit a vuoto), invece del solo "Command failed".

### Test

-   28 nuovi test (70 in totale): journal e undo contro repository veri, ricerca, blame, protocollo
    MCP in-process, watcher e debounce.

## [0.2.2] — 2026-11-08

### Documentazione

-   `docs/architettura.md`: il documento di riferimento dell'architettura (renderer senza privilegi,
    core puro, backend sostituibile), scritto per essere riusato in altri progetti desktop. Contiene
    le regole operative, i contratti fra i tre livelli, i costi misurati, le tre accezioni di
    "overload" di Electron, le trappole verificate su Linux e la checklist di avvio di un progetto.
-   Il `README` rimanda a quel documento.

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
