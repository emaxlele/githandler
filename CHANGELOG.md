# Changelog

## [0.5.0] — 2026-11-08

### Nome

-   Il progetto si chiama **GitHandler**: `git` davanti, perché è così che si cerca un client Git, e
    _handler_ — chi maneggia il repository. Nome verificato libero su GitHub e npm. Il progetto si è
    chiamato `gitcraft` — già usato da un altro client Git visuale — e, per poche ore dell'8 novembre
    2026, `lanecraft` e `gitlattice`, scartati perché senza la parola `git` il primo e per scelta
    dell'utente il secondo. Cartella, pacchetto, ref (`refs/githandler/*`), configurazione
    (`~/.config/githandler`) e variabili (`GITHANDLER_*`) seguono il nuovo nome.

### Interfaccia

-   **Finestra ridisegnata** sulla disposizione dei client Git desktop affermati, con il tema scuro
    del progetto: **toolbar** con le azioni etichettate (Apri, Fetch, Aggiorna, Annulla) e, al centro,
    repository e ramo; **scheda del repository** aperto sopra la storia; **barra laterale** con _Changes_
    e il conteggio, _All Commits_, filtro di ricerca e Branches / Remotes / Tags con intestazioni
    comprimibili.
-   **Storia a cinque colonne**: grafo a corsie, messaggio con i badge dei ref, autore con avatar a
    iniziali e colore stabile per nome, SHA breve, data completa.
-   **Pannello inferiore a quattro schede**: `Commit` (AUTHOR e COMMITTER separati con le rispettive
    date, SHA, PARENTS, messaggio e file toccati), `Changes` (Staged e Unstaged separati, diff a
    destra, riquadro del commit), `File Tree` (albero dei file del commit selezionato o del working
    tree, con cartelle comprimibili e _Comprimi/Espandi_, diff a destra) e `Blame`.
-   **Nuovo `commitDetails`** nel backend (`git show -s` con autore, committer, date ISO 8601, oggetto
    e corpo) e canale IPC `git:commitDetails`: la lista della storia non porta il committer, che dopo
    rebase e cherry-pick è una persona diversa.
-   Solo le funzioni che esistono hanno un comando: niente pulsanti finti per pull, push, stash o
    schede multiple di repository.

### Corretto

-   **I merge mostravano un commit senza file**: `git show --name-status` su un merge non stampa nulla
    senza `--first-parent`. Ora i file del merge sono quelli del primo genitore, come nei client Git
    grafici.
-   Il formato del diff scelto (unified/affiancato) si applica anche alla scheda `File Tree`.

### Cambiato

-   **La copia dei file non tracciati vive in Git**: i byte diventano blob (`hash-object -w`),
    l'insieme un albero e un commit raggiungibile da `refs/githandler/trash/<scope>/<id>`. Niente più
    cartelle copiate in `.git/githandler/trash/`: compressione, deduplica, integrità content-addressed
    e `git show <ref>:<path>` funzionano senza codice nostro. Gli oggetti non entrano nella storia
    del progetto e non vengono inviati al remoto.
-   **Namespace per worktree collegato** (`<nome>-<hash8>`): il journal è per-worktree, i ref sono
    condivisi, quindi ogni worktree pota solo i propri.
-   **Sotto-repository annidati conservati per intero**: le componenti `.git` (e le varianti NTFS che
    Git rifiuta) vengono codificate in modo reversibile nell'albero e riportate al nome originale al
    ripristino. Dopo `write-tree` l'app confronta l'albero con l'elenco misurato: se Git ha saltato
    un path, lo scarto si ferma invece di cancellare una copia incompleta.
-   **Byte grezzi**: `hash-object` senza `--path` non applica filtri né `core.autocrlf`, quindi CRLF,
    file binari e link simbolici tornano identici; i nomi con `%` e newline sono gestiti.
-   **`log` e ricerca escludono `refs/githandler/*`**: snapshot di undo e copie non compaiono più in
    `git log --all` (né nella UI, né nel conteggio dei commit).
-   Copie create dalla v0.4: restano ripristinabili e vengono potate quando la voce esce dal journal.

### Aggiunto

-   **Quota totale modificabile** (default 5 GiB) accanto ai limiti per operazione (25 MB,
    2.000 file). In _Impostazioni → File non tracciati_ ci sono i tre campi e lo spazio occupato dalle
    copie ancora annullabili.
-   Il journal registra `trashBytes`/`trashFiles` per voce. Alla registrazione di una nuova voce le
    copie più vecchie vengono eliminate finché il totale rientra nella quota; la voce appena creata
    non viene mai eliminata da sola.
-   Ordine a prova di crash: prima si scrive il journal, poi si eliminano i ref delle voci uscite;
    un ref orfano è innocuo e la potatura successiva lo toglie.
-   Migrazione del file delle impostazioni: `trashUntracked` (v0.4) diventa `trash.enabled`, con i
    limiti nuovi ai valori di default. `normalizeSettings` limita i valori a intervalli sensati.
-   **Installazione locale su Ubuntu** (`build/install-local.sh`): scrive il launcher
    `~/.local/bin/githandler`, la voce nel menu applicazioni e l'icona SVG; niente sudo, niente
    pacchetto. Il launcher ricompila i bundle a ogni avvio, quindi il menu apre sempre il codice
    corrente.

### Test

-   12 nuovi test (99 in totale): oggetti e ref, ripristino di cartelle, symlink ed eseguibili,
    byte CRLF/binari e nomi con `%`/newline, sotto-repo con `.git`, file speciali, limiti per
    operazione, quota con sfalcio, conflitti, copie v0.4, repository senza HEAD, worktree collegato,
    assenza dei commit del trash nella storia, dettaglio del commit (autore e committer distinti,
    output troncato rifiutato).

## [0.4.0] — 2026-11-08

### Aggiunto

-   **Permessi dell'API configurabili** (_Impostazioni → API per l'AI_): default **spento**; modi
    `off`, `read`, `all`, `custom` con scelta dei singoli tool. Il server MCP filtra `tools/list` e
    rifiuta `tools/call` non consentiti, rileggendo la policy a ogni richiesta: cambiarla non
    richiede di riconfigurare il client. La policy è in
    `$XDG_CONFIG_HOME/githandler/settings.json` (override `GITHANDLER_CONFIG_DIR`), scritta in modo
    atomico con permessi `0600` e condivisa da UI e MCP.
-   **File non tracciati recuperabili**: prima della cancellazione una copia va in
    `.git/githandler/trash/<id>/` e `Annulla` la ripristina. Limite 25 MB / 2.000 file per operazione;
    oltre il limite lo scarto si ferma invece di cancellare senza rete. Il ripristino non sovrascrive
    un file ricreato nel frattempo. Attivo di default, disattivabile dalle impostazioni.
-   **Paginazione della storia**: prima pagina da 2.000 commit, caricamento automatico della
    successiva quando si arriva in fondo; il refresh riparte dalla prima pagina.
-   **Blame nella UI**: terza scheda del pannello inferiore, virtualizzata, con commit, autore e
    testo per riga; le righe non committate sono marcate.
-   Correzione del passaggio `--skip` in `logArgs` e nuovo `historyPage(skip, limit)` nel backend.

### Test

-   16 nuovi test (87 in totale): normalizzazione e file delle impostazioni, policy MCP a runtime,
    trash con file, cartelle, limiti e conflitti, paginazione su 25 commit.

## [0.3.0] — 2026-11-08

### Aggiunto

-   **Undo generale**: prima di un commit, un checkout o uno scarto l'app registra lo stato in
    `refs/githandler/snapshots/*` e in un journal in `.git/githandler/undo.json` (massimo 50 voci).
    Il pulsante in barra (o `Ctrl+Z`) riporta indietro: il commit con `reset --soft` (le modifiche
    restano in stage), il checkout tornando al ramo precedente, lo scarto ripristinando il contenuto
    dal commit di stash registrato. I file non tracciati restano fuori: la conferma lo dice.
-   **Sorveglianza del repository** (`--watch`, `GITHANDLER_WATCH=1`): `fs.watch` ricorsivo con debounce,
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

-   Rendering software di default (`GITHANDLER_GPU=1` per l'accelerazione): su macchine senza GPU
    utilizzabile Chromium non avvia il processo GPU.
-   In sviluppo su Ubuntu 24.04+ serve `--no-sandbox`; il profilo AppArmor arriva con il packaging.
