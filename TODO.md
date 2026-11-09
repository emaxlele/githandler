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
        `merge`/`rebase` del ramo scelto fra quelli dell'originale, con anteprima dei commit in arrivo
        e di quelli locali; nessuna forza, HEAD staccato = errore detto
-   [x] **GitHub Actions**: ultime esecuzioni, **riprova i job falliti** (`rerun-failed-jobs`), intera
        ri-esecuzione e annullamento dal menu della scheda, con il token dell'account risolto
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
-   [x] **Chip «Dettagli ↗»**: mentre il pannello è in una finestra separata, la toolbar ricorda dove
        sono i dettagli e un clic riporta quella finestra davanti, invece di cercarla fra le altre
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
-   [x] **Avanzamento delle operazioni di rete**: clone, fetch, pull e push leggono `stderr` di Git
        a pezzi (`spawn`, non `execFile`) e mostrano nella toolbar fase, barra e percentuale; il
        parser (`src/core/network.ts`) gestisce `\r`, il prefisso `remote:` e le righe senza
        percentuale. Le operazioni usano `--progress` e timeout più lunghi.
-   [x] **Preferenze e temi**: chiaro, scuro e OLED (nero assoluto), densità comoda o compatta,
        tre dimensioni del testo; il tema «Automatico» segue il sistema e vale anche per la finestra
        dei dettagli, perché zoom e schema di colore li applica il processo principale
-   [x] **Stash parziale**: nel dialog si scelgono i file da salvare (tutti di default); con una
        parte selezionata `git stash push --include-untracked -- <path>…` salva solo quelli e lascia
        gli altri nel working tree. I path sono verificati nel main (niente `..`, path assoluti o
        nomi che sembrano opzioni).
-   [x] **Commit firmati**: la casella «firma (GPG)» accanto a «includi non staged» aggiunge `-S` e
        usa la chiave già configurata in Git (GPG o SSH); l'app non gestisce né conserva chiavi, e un
        errore di firma resta visibile sotto il campo
-   [x] **Modello del messaggio di commit** (`commit.template`) e **output dei hook** sotto il campo:
        il percorso segue le regole di Git, il modello si taglia a 64 KiB, un errore resta finché non
        si riprova
-   [x] **Raggiungibilità dei remoti**: dal dialog «Salute del repository» un pulsante contatta ogni
        remoto con `git ls-remote` (8 s di attesa al massimo) e dice se risponde, quanti rami ha o
        perché no; un remoto lento non ferma gli altri
-   [x] **Recupero**: una finestra che mette insieme l'ultima operazione annullabile, gli stash, le
        copie dei file scartati e il reflog, con il pulsante che porta all'azione giusta; il riassunto
        sta in `src/core/recovery.ts` e non cambia niente da solo
-   [x] **Salute del repository**: rami divergenti, rami senza upstream, stash più vecchi di 30
        giorni, submodule non puliti e HEAD staccato, in una finestra di sola lettura; la regola sta
        in `src/core/health.ts` e riceve ref, stash e submodule, senza rete
-   [x] **Progetto pubblicabile**: licenza **GPL-3.0-or-later**, CI GitHub Actions (typecheck, test,
        build, smoke del benchmark), `SECURITY.md`, `CONTRIBUTING.md`, `ROADMAP.md`, moduli per le issue,
        `AGENTS.md`, badge nel README

## Aperto

-   [ ] Milestone 2 — il diff che conta
    -   [x] **Risoluzione dei conflitti in-app**: tre versioni (base / mio / loro), scelta per file e
            per hunk, editor del risultato, «segna risolto», «continua» per merge, rebase e cherry-pick
    -   [x] **Evidenziazione della sintassi** (CodeMirror 6, licenza MIT): il tipo di file decide
            il parser (oltre trenta linguaggi, inclusi TypeScript, Markdown, YAML, Dockerfile), il
            core produce intervalli con classi `tok-…` e il renderer li unisce all'evidenza della
            porzione cambiata senza rinunciare all'HTML a stringa; un hunk oltre 400.000 caratteri
            resta testo semplice. L'impostazione «Colora la sintassi nel diff» la spegne, e con i
            colori spenti la tokenizzazione non parte nemmeno.
    -   [x] Interfaccia in italiano **e** inglese (`i18n`), lingua scelta nelle impostazioni
    -   [x] Command palette (`Ctrl+K`) e scorciatoie documentate
    -   [x] **Ricerca più forte**: `regex:` sul messaggio, `change:` (`-S`), `diff:` (`-G`),
            `lines:` (`log -L`); il testo libero resta letterale
    -   [x] **Ricerca nel contenuto dei file** (`git grep`), strumento a parte: testo letterale o
            espressione regolare, maiuscole facoltative, risultati con file e riga, apertura nel
            sistema
    -   [x] **Pannello reflog** e «vai al commit per SHA»: gli spostamenti di HEAD si vedono,
            con selettore, SHA e data, e ogni voce apre il commit nel pannello
-   [x] **Pull request / merge request**: elenco delle aperte (GitHub, GitLab, Gitea/Forgejo,
        Bitbucket), creazione da due rami già inviati, apertura nel browser, bozza; dal menu della
        scheda e dalla palette
-   [x] **Commenti delle pull request**: la finestra _Discussione_ legge la conversazione dal più
        vecchio e ne pubblica di nuovi, per GitHub, GitLab, Gitea/Forgejo e Bitbucket; il testo si
        mostra com'è (mai HTML), gli indirizzi e il corpo passano da `src/core/comments.ts`
-   [x] **Revisioni delle pull request**: _Revisioni_ legge chi ha approvato e chi ha chiesto
        modifiche (review per GitHub e Gitea, `approved_by` per GitLab, `participants` per
        Bitbucket) e offre solo le azioni che il servizio permette: approvare su tutti e quattro,
        chiedere modifiche su GitHub, Gitea e Bitbucket, ritirare l'approvazione su GitLab e
        Bitbucket. Ogni azione chiede conferma; su GitHub e Gitea l'ultima review di ogni persona
        decide lo stato, così chi ha approvato e poi chiesto modifiche non resta un'approvazione
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
    -   [x] **Pacchetto `.deb`** con Electron incluso (`npm run deb`): launcher, voce nel menu,
            icona e helper `chrome-sandbox` setuid, così `--no-sandbox` resta il ripiego e non la
            regola
    -   [x] **Profilo AppArmor nel pacchetto** (Ubuntu 24.04+ blocca il sandbox di Chromium):
            `build/githandler.apparmor` finisce in `/etc/apparmor.d/githandler` come conffile,
            `postinst` lo carica e `prerm` lo scarica; l'helper `chrome-sandbox` viaggia con il bit
            setuid e il launcher passa `--no-sandbox` solo se quel bit è sparito e i namespace
            utente sono limitati. Il profilo è stato caricato e l'app avviata in headless; la prova
            su una macchina appena installata resta consigliata.
    -   [x] **AppImage e pacchetto `.rpm`**: `npm run appimage` produce un'immagine portabile con
            Electron dentro (icona PNG, `AppRun` che si calcola la propria cartella); `npm run rpm`
            genera lo spec al volo, ricava le dipendenze dai soname e conserva il layout del `.deb`.
            L'AppImage è stata avviata in headless con screenshot, il pacchetto RPM è stato ispezionato
            (modalità, proprietario, dipendenze) ma non installato su una distribuzione RPM.
    -   [x] **Worktree**: elenco dal dialog, creazione su un ramo esistente o nuovo, apertura in una
            scheda e rimozione (mai il principale, mai con modifiche non committate); il parser dello
            formato `--porcelain` sta in `src/core/worktrees.ts`
    -   [x] **Rebase interattivo**: elenco dei commit da quello scelto a HEAD, con riordino, squash,
            fixup, reword (messaggio completo) e drop; il piano copre esattamente l'intervallo, un
            merge nel mezzo viene rifiutato, niente viene inviato al remoto e l'operazione resta
            annullabile; il todo si costruisce in `src/core/rebase.ts`
    -   [x] **Preferenze e temi**: chiaro, scuro, OLED (nero assoluto), densità comoda/compatta e
            tre dimensioni del testo; l'aspetto si applica a tutte le finestre, il tema «Automatico»
            segue il sistema
-   [ ] Verificare la resa del testo su un diff da ~3.000 righe contro WebKitGTK (Tauri/Wails) e
        Avalonia: è la misura che ha motivato la scelta di Electron
-   [ ] Decidere se e come pubblicare il repository

-   [x] **Albero completo pigro nel File Tree**: il pulsante «Tutti i file» legge il repository una
        cartella alla volta con `git ls-tree -z` (parser in `src/core/tree.ts`), con la radice a
        percorso vuoto e lo stato dei file modificati; «Modifiche» torna all'elenco dei soli file
        toccati, e le cartelle già lette si scartano cambiando commit o dopo un commit nuovo
-   [x] **Trascinare un file fuori dalla finestra** dalle liste e dal File Tree, con il percorso
        verificato nel main; la **cartella** intera come archivio è coperta da «Esporta HEAD in uno zip»
-   [ ] Device flow: un Client ID predefinito per GitHub nell'app, così l'accesso dal browser funziona
        senza che l'utente registri una sua applicazione OAuth. Nell'attesa «Accedi» usa il token che
        c'è già sulla macchina
-   [x] **Actions**: _Avvia un workflow…_ parte sul ramo o tag scelto con gli input dichiarati in un
        oggetto JSON (al massimo dieci, solo stringhe); l'elenco mostra il numero del tentativo e
        l'annullamento resta offerto solo alle esecuzioni non concluse
-   [x] **Pannello staccato**: quando la finestra principale cambia repository, la finestra dei
        dettagli riapre l'ultimo commit guardato lì (o quello che la principale sta guardando), non
        il primo della storia; la scelta è ricordata per repository in
        `localStorage["githandler.panelCommit"]`
-   [x] **Indicatore nella finestra principale** che i dettagli sono in una finestra separata, oltre al
        rientro che avviene chiudendola

## Bloccato

-   niente
