# TODO

Stato al 2026-11-08 (v0.5.0). Le voci spuntate sono in `CHANGELOG.md`.

## Fatto

-   [x] Staging parziale: per hunk e per singola riga (`git apply --cached`, anche `--reverse` per
        togliere dallo stage)
-   [x] Diff affiancato (prima/dopo) con accoppiamento riga per riga ed evidenza della porzione
        cambiata; scelta ricordata fra un avvio e l'altro
-   [x] Undo generale (journal in `.git/gitlattice/undo.json`, `refs/gitlattice/snapshots/*`): commit,
        checkout e scarto, con pulsante e `Ctrl+Z`
-   [x] Ricerca nella storia: testo letterale, `author:`, `file:`; usata da UI e API
-   [x] Refresh automatico su `fs.watch` con debounce, filtro e chip Live (`--watch`)
-   [x] Parser di blame (`git blame --line-porcelain`) e `formatDiff` nel core
-   [x] Server MCP (`npm run mcp`): `repo_status`, `history`, `show_commit`, `worktree_diff`,
        `blame`; configurazione in `docs/mcp.md`
-   [x] **Permessi dell'API configurabili** (default spento; `off` / `read` / `all` / `custom`), con
        policy riletta a ogni richiesta da UI e server MCP
-   [x] **Blame nella UI**: terza scheda del pannello inferiore, virtualizzata
-   [x] **Paginazione della storia**: pagine da 2.000 commit, caricamento automatico in fondo
-   [x] **File non tracciati recuperabili come oggetti Git**: blob, albero e commit sotto
        `refs/gitlattice/trash/<scope>/<id>`, con quota totale (5 GiB) e limiti per operazione
        configurabili, ripristino senza sovrascrivere, copie v0.4 ancora leggibili
-   [x] **Worktree e sotto-repo**: namespace del trash per worktree collegato; `.git` annidati
        conservati per intero con codifica reversibile dei path che Git rifiuta

## Aperto

-   [ ] Milestone 2 — il diff che conta
    -   [ ] Evidenziazione della sintassi (CodeMirror 6, licenza MIT): dipendenza nuova, va decisa
            prima di aggiungerla
-   [ ] Milestone 3 — scala e affidabilità
    -   [ ] Misura di `status` e del primo paint su repo da 100k file e 50k commit
    -   [ ] Solo sopra soglia: `koffi` + libgit2 per le letture calde
-   [ ] Milestone 4 — prodotto
    -   [ ] Packaging `.deb` con profilo AppArmor (Ubuntu 24.04+ blocca il sandbox di Chromium):
            richiede verifica su macchina pulita
    -   [ ] AppImage e pacchetto `.rpm`
    -   [ ] Rebase interattivo, cherry-pick, stash, worktree, submodule
    -   [ ] Preferenze e temi
-   [ ] Verificare la resa del testo su un diff da ~3.000 righe contro WebKitGTK (Tauri/Wails) e
        Avalonia: è la misura che ha motivato la scelta di Electron
-   [ ] Decidere se e come pubblicare il repository

## Bloccato

-   niente
