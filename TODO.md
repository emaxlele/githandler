# TODO

Stato al 2026-11-09 (v0.10.0). Le voci spuntate sono in `CHANGELOG.md`.

## Fatto

-   [x] Staging parziale: per hunk e per singola riga (`git apply --cached`, anche `--reverse` per
        togliere dallo stage)
-   [x] Diff affiancato (prima/dopo) con accoppiamento riga per riga ed evidenza della porzione
        cambiata; il formato parte unito e resta una scelta di sessione, non una preferenza salvata
-   [x] Undo generale (journal in `.git/githandler/undo.json`, `refs/githandler/snapshots/*`): commit,
        checkout e scarto, con pulsante e `Ctrl+Z`
-   [x] Ricerca nella storia: testo letterale, `author:`, `file:`; usata da UI e API
-   [x] Refresh automatico su `fs.watch` con debounce, filtro e chip Live (`--watch`)
-   [x] Parser di blame (`git blame --line-porcelain`) e `formatDiff` nel core
-   [x] Server MCP (`npm run mcp`): `repo_status`, `history`, `show_commit`, `worktree_diff`,
        `blame`; configurazione in `docs/mcp.md`
-   [x] **MCP in scrittura**: `stage`, `unstage`, `commit`, `create_branch`, `checkout_branch`,
        separati dalla lettura nell'elenco dei permessi e registrati in `.git/githandler/mcp-audit.jsonl`
        (rotazione a 1 MiB, solo scritture, anche i tentativi falliti)
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
        Commit / File Tree / Blame / Terminale
-   [x] **Dettaglio commit con autore e committer separati** (`git show -s`, canale
        `git:commitDetails`), SHA e parents nel pannello
-   [x] **Pull, push, stash, submodule, merge/rebase/cherry-pick**: argomenti e parser in
        `src/core/ops.ts` con validazione dei nomi di ref; pull solo `--ff-only`, push senza forza e
        con tracking al primo invio; undo che copre anche merge, rebase e cherry-pick
-   [x] **Terminale integrato**: `bash -lc` nella cartella del repository attivo, output in streaming,
        pulsante _Interrompi_ (nessuna dipendenza nuova, niente `node-pty`)
-   [x] **Più repository aperti insieme**: backend per root e sessione per scheda, root come primo
        argomento di ogni canale IPC, watcher sulla scheda attiva
-   [x] **File e cartella dal repository**: pulsante _Cartella_, menu della scheda (cartella, percorso,
        repository nel browser), menu del file (apri con l'app, mostra nella cartella, salva una copia, copia
        percorso, doppio clic che apre), menu del commit con l'URL web; copie lette byte per byte dal working
        tree o da `git show <sha>:<path>`, percorsi verificati nel main
-   [x] **Token dal browser**: device flow OAuth per GitHub e GitLab (anche self-hosted) con Client ID
        pubblico salvato nell'account, codice mostrato e pagina aperta, token che resta nel main; pagina dei
        token per Gitea e Bitbucket
-   [x] **«Accedi» senza Client ID**: token già presente sulla macchina (`gh auth token`, poi
        `git credential fill`), verificato con `GET /user`; il device flow resta la seconda strada
-   [x] **Account per repository**: `chooseRepoAccount` (scelta salvata → proprietario del remoto →
        unico account dell'host → primo, dichiarato), `Settings.repoAccounts`, chip nell'header con
        menu di scelta
-   [x] **Fork**: parent dall'API dei 4 provider, remoto `upstream` creato al primo sync, `fetch` +
        `merge`/`rebase` del ramo predefinito, nessuna forza, HEAD staccato = errore detto
-   [x] **GitHub Actions**: ultime esecuzioni, ri-esecuzione e annullamento dal menu della scheda, con
        il token dell'account risolto
-   [x] **Elenco dei file tracciati** (`git ls-tree -r -z`, `ls-files` senza HEAD) filtrabile, con
        apertura dal sistema o nel browser; link web ai file anche per Gitea (`/src/branch/<ref>/…`)
-   [x] **Esporta HEAD in uno zip** con `git archive`, senza dipendenze nuove
-   [x] **Paginazione dell'elenco repository** (_Carica altri_), una pagina per volta e senza duplicati
-   [x] **Changes a tutta area**: la voce della barra laterale porta il pannello delle modifiche
        nell'area principale, senza storia né pannello inferiore
-   [x] **Clic sul ref = cursore sul commit** e **menu contestuale** su rami e commit (checkout, merge,
        rebase, rinomina, elimina, copia; cherry-pick sui commit)
-   [x] **File dei merge** (`--first-parent` in `commitFilesArgs`): senza, il commit di merge compariva
        senza alcun file
-   [x] **Schede riaperte all'avvio**: i repository dell'ultima sessione tornano nello stesso ordine e
        con quello attivo (`localStorage["githandler.sessions"]`); un percorso sparito si salta
-   [x] **Token recuperato all'avvio** (`hydrateTokens`): credential helper per quell'utente, poi
        `gh auth token` se l'account sull'host è uno solo; esiti negativi ricordati per la sessione
-   [x] **Pannello dei dettagli ridimensionabile e a icona**: maniglia sopra il pannello (18%–78%,
        misura ricordata), pulsante `▾`/`▴` per ridurlo alla riga delle schede, stato in
        `localStorage`
-   [x] **Pannello in una finestra separata**: `BrowserWindow` con lo stesso renderer in modalità
        `panel`, selezione pubblicata dalla finestra principale su `panel:sync` e ridiffusa su
        `panel:state`; alla chiusura il pannello rientra al suo posto
-   [x] **Scroll del diff e dell'albero**: `.panes` con altezza vincolata (`grid-template-rows:
minmax(0, 1fr)`), non più contenuto tagliato
-   [x] **Una sola vista delle modifiche**: la scheda _Changes_ del pannello inferiore è sparita (era la
        stessa vista della voce della barra laterale, mostrata due volte); il contatore accanto a
        _Changes_ si nasconde a zero ed è verde quando c'è solo da committare, ambra quando resta
        qualcosa fuori dallo stage
-   [x] **Commit come analisi, non come elenco di file**: la scheda _Commit_ mostra barra proporzionale
        fra aggiunte e rimozioni, `+N`/`−M`, file, cartelle, binari e conteggi per stato, poi il diff
        dell'intero commit in un unico scorrimento (tetto di 12 file e 4.000 righe, con rimando al
        _File Tree_); `commitStat` legge i totali con `git show --numstat --first-parent`
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
-   [x] **Preferenze e temi**: chiaro, scuro e OLED (nero assoluto), densità comoda o compatta,
        tre dimensioni del testo; il tema «Automatico» segue il sistema e vale anche per la finestra
        dei dettagli, perché zoom e schema di colore li applica il processo principale
-   [x] **Progetto pubblicabile**: licenza **GPL-3.0-or-later**, CI GitHub Actions (typecheck, test,
        build, smoke del benchmark), `SECURITY.md`, `CONTRIBUTING.md`, `ROADMAP.md`, moduli per le issue,
        `AGENTS.md`, badge nel README

## Aperto

-   [ ] Milestone 2 — il diff che conta
    -   [x] **Risoluzione dei conflitti in-app**: tre versioni (base / mio / loro), scelta per file e
            per hunk, editor del risultato, «segna risolto», «continua» per merge, rebase e cherry-pick
    -   [ ] Evidenziazione della sintassi (CodeMirror 6, licenza MIT): dipendenza nuova, va decisa
            prima di aggiungerla
    -   [x] Interfaccia in italiano **e** inglese (`i18n`), lingua scelta nelle impostazioni
    -   [x] Command palette (`Ctrl+K`) e scorciatoie documentate
    -   [x] **Ricerca più forte**: `regex:` sul messaggio, `change:` (`-S`), `diff:` (`-G`),
            `lines:` (`log -L`); il testo libero resta letterale
    -   [ ] Ricerca nel contenuto dei file (`git grep`), strumento a parte
    -   [x] **Pannello reflog** e «vai al commit per SHA»: gli spostamenti di HEAD si vedono,
            con selettore, SHA e data, e ogni voce apre il commit nel pannello
-   [x] **Pull request / merge request**: elenco delle aperte (GitHub, GitLab, Gitea/Forgejo,
        Bitbucket), creazione da due rami già inviati, apertura nel browser, bozza; dal menu della
        scheda e dalla palette
-   [ ] Commenti e revisioni delle pull request nell'app
-   [x] **Stato dei check per pull request**: esito complessivo e singoli controlli (GitHub,
        GitLab, Gitea/Forgejo, Bitbucket), con apertura nel browser; il colore non è mai verde senza
        un successo
-   [x] **Notifiche CI dal tray**: icona nella barra di sistema con «Mostra», «Controlla adesso»,
        interruttore delle notifiche e «Esci»; un avviso quando un'esecuzione dei workflow diventa un
        errore, una volta sola, senza tenere la finestra davanti
-   [ ] Milestone 3 — scala e affidabilità
    -   [x] Misura di `status`, refresh e primo paint su repo da 100k file e 50k commit
    -   [x] **Refresh incrementale**: la pagina di storia si riusa se HEAD e i ref non cambiano
            (245 ms → 78 ms sul repository di prova)
    -   [ ] Solo sopra soglia: `koffi` + libgit2 per le letture calde
-   [ ] Milestone 4 — prodotto
    -   [x] **Pacchetto `.deb`** con Electron incluso (`npm run deb`): launcher, voce nel menu e
            icona; `--no-sandbox` automatico quando manca il profilo AppArmor
    -   [ ] Profilo AppArmor nel pacchetto (Ubuntu 24.04+ blocca il sandbox di Chromium): richiede
            verifica su macchina pulita
    -   [ ] AppImage e pacchetto `.rpm`
    -   [ ] Rebase interattivo e worktree
    -   [x] **Preferenze e temi**: chiaro, scuro, OLED (nero assoluto), densità comoda/compatta e
            tre dimensioni del testo; l'aspetto si applica a tutte le finestre, il tema «Automatico»
            segue il sistema
-   [ ] Verificare la resa del testo su un diff da ~3.000 righe contro WebKitGTK (Tauri/Wails) e
        Avalonia: è la misura che ha motivato la scelta di Electron
-   [ ] Decidere se e come pubblicare il repository

-   [ ] Un **albero** completo pigro nel File Tree (un livello alla volta): l'elenco piatto dei file
        tracciati copre l'apertura di un file qualunque, ma non la navigazione per cartelle
-   [ ] Trascinare un file fuori dalla finestra; la **cartella** intera come archivio è coperta da
        «Esporta HEAD in uno zip»
-   [ ] Device flow: un Client ID predefinito per GitHub nell'app, così l'accesso dal browser funziona
        senza che l'utente registri una sua applicazione OAuth. Nell'attesa «Accedi» usa il token che
        c'è già sulla macchina
-   [ ] Fork: scegliere un ramo dell'originale diverso da quello predefinito, e mostrare quanti commit
        si sono ricevuti prima del merge invece che solo dopo
-   [ ] Actions: `rerun-failed-jobs` (oggi `rerun` ripete tutti i job) e i workflow con input;
        l'annullamento è offerto solo alle esecuzioni non concluse
-   [ ] Clone e operazioni di rete senza avanzamento: oggi si vede solo l'esito. Un `--progress` letto
        da `stderr` (pipe, non `execFile` buffer) darebbe una barra
-   [ ] Pannello staccato: quando la finestra principale cambia repository, la finestra dei dettagli
        dovrebbe riaprire l'ultimo commit guardato in quel repository invece del primo della storia
        (oggi segue il repository e aspetta la pubblicazione successiva)
-   [ ] Indicatore nella finestra principale che i dettagli sono in una finestra separata, oltre al
        rientro che avviene chiudendola

## Bloccato

-   niente
