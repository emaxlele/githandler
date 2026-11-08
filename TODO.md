# TODO

Stato al 2026-11-08 (v0.4.0). Le voci spuntate sono in `CHANGELOG.md`.

## Fatto

-   [x] Staging parziale: per hunk e per singola riga (`git apply --cached`, anche `--reverse` per
        togliere dallo stage)
-   [x] Diff affiancato (prima/dopo) con accoppiamento riga per riga ed evidenza della porzione
        cambiata; scelta ricordata fra un avvio e l'altro
-   [x] Undo generale (journal in `.git/gitcraft/undo.json`, `refs/gitcraft/snapshots/*`): commit,
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
-   [x] **File non tracciati recuperabili**: copia in `.git/gitcraft/trash/` prima dello scarto,
        limite 25 MB / 2.000 file, ripristino senza sovrascrivere

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
