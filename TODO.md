# TODO

Stato al 2026-11-08 (v0.9.0). Le voci spuntate sono in `CHANGELOG.md`.

## Fatto

-   [x] Staging parziale: per hunk e per singola riga (`git apply --cached`, anche `--reverse` per
        togliere dallo stage)
-   [x] Diff affiancato (prima/dopo) con accoppiamento riga per riga ed evidenza della porzione
        cambiata; scelta ricordata fra un avvio e l'altro
-   [x] Undo generale (journal in `.git/githandler/undo.json`, `refs/githandler/snapshots/*`): commit,
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
        `refs/githandler/trash/<scope>/<id>`, con quota totale (5 GiB) e limiti per operazione
        configurabili, ripristino senza sovrascrivere, copie v0.4 ancora leggibili
-   [x] **Worktree e sotto-repo**: namespace del trash per worktree collegato; `.git` annidati
        conservati per intero con codifica reversibile dei path che Git rifiuta
-   [x] **Installazione locale su Ubuntu** (`./build/install-local.sh`): launcher in
        `~/.local/bin/githandler`, voce nel menu applicazioni e icona SVG, senza sudo
-   [x] **Interfaccia sul modello dei client Git desktop**: toolbar etichettata, scheda del repository,
        barra laterale Changes / All Commits, storia a cinque colonne, pannello
        Commit / Changes / File Tree / Blame
-   [x] **Dettaglio commit con autore e committer separati** (`git show -s`, canale
        `git:commitDetails`), SHA e parents nel pannello
-   [x] **Pull, push, stash, submodule, merge/rebase/cherry-pick**: argomenti e parser in
        `src/core/ops.ts` con validazione dei nomi di ref; pull solo `--ff-only`, push senza forza e
        con tracking al primo invio; undo che copre anche merge, rebase e cherry-pick
-   [x] **Terminale integrato**: `bash -lc` nella cartella del repository attivo, output in streaming,
        pulsante *Interrompi* (nessuna dipendenza nuova, niente `node-pty`)
-   [x] **Più repository aperti insieme**: backend per root e sessione per scheda, root come primo
        argomento di ogni canale IPC, watcher sulla scheda attiva
-   [x] **File e cartella dal repository**: pulsante *Cartella*, menu della scheda (cartella, percorso,
    repository nel browser), menu del file (apri con l'app, mostra nella cartella, salva una copia, copia
    percorso, doppio clic che apre), menu del commit con l'URL web; copie lette byte per byte dal working
    tree o da `git show <sha>:<path>`, percorsi verificati nel main
-   [x] **Token dal browser**: device flow OAuth per GitHub e GitLab (anche self-hosted) con Client ID
    pubblico salvato nell'account, codice mostrato e pagina aperta, token che resta nel main; pagina dei
    token per Gitea e Bitbucket
-   [x] **Changes a tutta area**: la voce della barra laterale porta il pannello delle modifiche
        nell'area principale, senza storia né pannello inferiore
-   [x] **Clic sul ref = cursore sul commit** e **menu contestuale** su rami e commit (checkout, merge,
        rebase, rinomina, elimina, copia; cherry-pick sui commit)
-   [x] **File dei merge** (`--first-parent` in `commitFilesArgs`): senza, il commit di merge compariva
        senza alcun file
-   [x] **Pannello dei dettagli ridimensionabile e a icona**: maniglia sopra il pannello (18%–78%,
        misura ricordata), pulsante `▾`/`▴` per ridurlo alla riga delle schede, stato in
        `localStorage`
-   [x] **Pannello in una finestra separata**: `BrowserWindow` con lo stesso renderer in modalità
        `panel`, selezione pubblicata dalla finestra principale su `panel:sync` e ridiffusa su
        `panel:state`; alla chiusura il pannello rientra al suo posto
-   [x] **Scroll del diff e dell'albero**: `.panes` con altezza vincolata (`grid-template-rows:
        minmax(0, 1fr)`), non più contenuto tagliato
-   [x] **Scheda *Changes* del pannello distinta dalla voce della barra laterale**
-   [x] **Menu del commit completo**: ramo dal commit, merge, rebase, reset soft/mixed/hard (con
        conferma), cherry-pick, copia; `assertSha` sugli SHA e undo del reset tramite `target`
-   [x] **Benvenuto all'avvio** (`body.is-empty`): senza `--repo` nessun dialog di sistema, quattro
        scelte (Apri / Crea / Clona da URL / Clona da account), comandi del repository spenti e
        striscia delle schede nascosta
-   [x] **Checkout di un commit** (HEAD staccato) dal menu del commit, annullabile; ramo e stato
        staccato riletti con `symbolic-ref` a ogni refresh
-   [x] **Creazione di un repository**: `git init` con identità locale facoltativa e controllo che la
        cartella non esista
-   [x] **Clone da URL e dagli account**: URL HTTPS/SSH/locali, nome della cartella dall'URL, elenco dei
        repository per GitHub, GitLab, Gitea/Forgejo e Bitbucket, filtro e clonazione nella cartella scelta
-   [x] **Account con token modificabile**: `accounts.json` 0600 con soli metadati, token in memoria,
        `GIT_ASKPASS` per clone/fetch/pull/push, `git credential approve` se c'è un helper
-   [x] **Cartella di base** (`Settings.defaultRoot`): punto di partenza dei dialog e destinazione
        predefinita dei cloni
-   [x] **Ultima scheda chiudibile**: `git:close` ferma watcher e backend, la finestra torna al benvenuto

## Aperto

-   [ ] Milestone 2 — il diff che conta
    -   [ ] Evidenziazione della sintassi (CodeMirror 6, licenza MIT): dipendenza nuova, va decisa
            prima di aggiungerla
-   [ ] Milestone 3 — scala e affidabilità
    -   [ ] Misura di `status` e del primo paint su repo da 100k file e 50k commit
    -   [ ] Solo sopra soglia: `koffi` + libgit2 per le letture calde
-   [ ] Milestone 4 — prodotto
    -   [ ] Packaging `.deb` con profilo AppArmor (Ubuntu 24.04+ blocca il sandbox di Chromium):
            richiede verifica su macchina pulita. Nel frattempo `./build/install-local.sh` installa
            launcher, voce nel menu e icona nel profilo utente
    -   [ ] AppImage e pacchetto `.rpm`
    -   [ ] Rebase interattivo e worktree
    -   [ ] Preferenze e temi
-   [ ] Verificare la resa del testo su un diff da ~3.000 righe contro WebKitGTK (Tauri/Wails) e
        Avalonia: è la misura che ha motivato la scelta di Electron
-   [ ] Decidere se e come pubblicare il repository

-   [ ] Azioni sui file solo dove i file si vedono: il File Tree elenca i file **modificati** e il
        commit selezionato, non tutto il repository. Serve un albero completo pigro (un livello alla
        volta, `git ls-tree`) per aprire o salvare un file qualunque senza passare da un commit
-   [ ] Salvare una **cartella** intera (o uno zip) dal repository, e trascinare un file fuori dalla
        finestra: oggi la copia è di un file alla volta
-   [ ] Link web ai file anche per Gitea (`/src/branch/<ref>/<path>`): la forma è nota, manca il canale
        che serve al menu del file
-   [ ] Device flow: un Client ID predefinito per GitHub nell'app, così l'accesso dal browser funziona
        senza che l'utente registri una sua applicazione OAuth
-   [ ] Account: l'elenco dei repository legge la prima pagina dell'API (100 su GitHub e GitLab, 50 su
        Gitea, 100 su Bitbucket). Serve la paginazione o una ricerca lato server per gli account con
        molti repository
-   [ ] Clone e operazioni di rete senza avanzamento: oggi si vede solo l'esito. Un `--progress` letto
        da `stderr` (pipe, non `execFile` buffer) darebbe una barra
-   [ ] Pannello staccato: quando la finestra principale cambia repository, la finestra dei dettagli
        dovrebbe riaprire l'ultimo commit guardato in quel repository invece del primo della storia
        (oggi segue il repository e aspetta la pubblicazione successiva)
-   [ ] Indicatore nella finestra principale che i dettagli sono in una finestra separata, oltre al
        rientro che avviene chiudendola

## Bloccato

-   niente
