# TODO

Stato al 2026-11-08. Le voci spuntate sono in `CHANGELOG.md`.

## Fatto dopo la v0.1

-   [x] Staging parziale: per hunk e per singola riga (`git apply --cached`, anche `--reverse` per
        togliere dallo stage)
-   [x] Diff affiancato (prima/dopo) con accoppiamento riga per riga ed evidenza della porzione
        cambiata; scelta ricordata fra un avvio e l'altro
-   [x] Undo generale (journal in `.git/gitcraft/undo.json`, `refs/gitcraft/snapshots/*`): commit,
        checkout e scarto, con pulsante e `Ctrl+Z`
-   [x] Ricerca nella storia: testo letterale, `author:`, `file:`; usata da UI e API
-   [x] Refresh automatico su `fs.watch` con debounce, filtro e chip Live (`--watch`)
-   [x] Parser di blame (`git blame --line-porcelain`) e `formatDiff` nel core
-   [x] Server MCP in sola lettura (`npm run mcp`): `repo_status`, `history`, `show_commit`,
        `worktree_diff`, `blame`; configurazione in `docs/mcp.md`

## In corso

-   [ ] Milestone 2 — il diff che conta
    -   [ ] Evidenziazione della sintassi (CodeMirror 6, licenza MIT)
    -   [ ] Blame con timeline nella UI (parser e tool MCP già ci sono)

## Aperto

-   [ ] Milestone 3 — scala e affidabilità
    -   [ ] Paginazione della storia e caricamento progressivo oltre i 5.000 commit
    -   [ ] Misura di `status` e del primo paint su repo da 100k file e 50k commit
    -   [ ] Solo sopra soglia: `koffi` + libgit2 per le letture calde
-   [ ] Milestone 4 — prodotto
    -   [ ] Packaging `.deb` con profilo AppArmor (Ubuntu 24.04+ blocca il sandbox di Chromium)
    -   [ ] AppImage e pacchetto `.rpm`
    -   [ ] Rebase interattivo, cherry-pick, stash, worktree, submodule
    -   [ ] Preferenze e temi
-   [ ] Verificare la resa del testo su un diff da ~3.000 righe contro WebKitGTK (Tauri/Wails) e
        Avalonia: è la misura che ha motivato la scelta di Electron
-   [ ] Decidere se e come pubblicare il repository

## Bloccato

-   niente
