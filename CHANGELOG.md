# Changelog

## [0.8.0] — 2026-11-08

### Si parte dal benvenuto, non da una finestra di sistema

-   All'avvio, se non c'è `--repo`, la finestra mostra il **benvenuto** con quattro scelte — *Apri un
    repository*, *Crea un repository*, *Clona da URL*, *Clona da un account* — e non apre più da sola il
    dialog di sistema. Il dialog si apre solo da un pulsante, e annullarlo lascia il benvenuto dov'è.
-   Il **`+` delle schede** apre lo stesso menu invece di saltare al dialog, e ora è **centrato**
    sull'altezza delle schede (prima stava in basso a sinistra).
-   Senza repository la striscia delle schede sparisce, il benvenuto occupa l'area e i comandi che
    avrebbero bisogno di un repository (fetch, pull, push, stash, submodule, aggiorna, annulla) sono
    spenti invece di rispondere con un errore.
-   **L'ultima scheda si può chiudere**: il main dimentica il backend e ferma il watcher, e la finestra
    torna al benvenuto.

### Checkout di un commit, oltre che di un ramo

-   Menu del commit → **«Checkout di questo commit (HEAD staccato)»**, con conferma. Il ramo non si
    sposta: si guarda o si prova quel punto della storia, e *Annulla* riporta al ramo di prima.
-   L'intestazione non mente più dopo un checkout staccato: il ramo (e lo stato staccato) vengono
    riletti a ogni aggiornamento da `symbolic-ref`, non ricordati dall'apertura.

### Creare un repository

-   Dialogo **Crea**: cartella genitore (con «Sfoglia…»), nome, e **identità locale facoltativa**
    (`user.name` / `user.email` nel solo repository, mai nella configurazione globale). Nome ed email
    vanno insieme o restano tutti e due vuoti.
-   La cartella non deve esistere: se c'è già, l'operazione si ferma e lo dice. Dopo `git init` il
    repository si apre nella scheda nuova, sul ramo `main`.

### Clonare, da un URL o da un account

-   Dialogo **Clona**: URL HTTPS, SSH o percorso locale; il nome della cartella è l'ultima parte
    dell'URL e la destinazione si vede prima di confermare. Cartella genitore scelta a mano, dal
    dialogo o dalla cartella di base.
-   **Clona da un account**: elenco dei repository dell'utente con filtro e badge *privato*, e clone
    nella cartella indicata. Un clic, una cartella, una scheda.
-   Timeout di 10 minuti sul clone, pulsanti disabilitati mentre l'operazione è in corso, e nessun
    output parziale spacciato per successo: o finisce, o l'errore arriva.

### Account collegati: GitHub, GitLab, Gitea/Forgejo, Bitbucket

-   **Non solo GitHub**: provider, host e indirizzo dell'API sono modificabili per le installazioni
    proprie (Gitea/Forgejo, GitLab self-hosted); GitHub e Bitbucket hanno host fisso.
-   **Le credenziali si cambiano**: il token si reinserisce dall'account e vale subito; un 401/403
    diventa «Token non valido o scaduto: aggiornalo nell'account».
-   **Il token non viene scritto dall'app.** In `accounts.json` (0600) stanno solo i metadati — provider,
    host, API, utente, etichetta. Il token resta in memoria per la sessione e arriva a `git` tramite
    `GIT_ASKPASS` (script generico in `~/.config/githandler/askpass.sh`, 0700, che legge
    `GITHANDLER_USER`/`GITHANDLER_TOKEN` dall'ambiente): niente segreti in argv, nei log o nei file
    dell'app. Se l'utente ha un credential helper configurato il token viene anche consegnato con
    `git credential approve`, così lo ritrova Git nel proprio archivio.
-   Le credenziali valgono anche per **fetch, pull e push**: l'host si ricava da `origin`, l'ambiente
    si costruisce al momento.
-   Rimuovere un account toglie il token dalla memoria dell'app; quel che Git ha salvato resta di Git e
    non viene cancellato di nascosto.

### Cartella di base

-   Nelle impostazioni si sceglie la **cartella di base**: è il punto di partenza di «Apri», «Crea» e
    «Clona» e la destinazione predefinita dei cloni. Non è un limite: dalla finestra di scelta si
    naviga ovunque. Vuota = home dell'utente.

### Numeri

-   120 test automatici (erano 110): parsing delle risposte delle quattro API, URL→nome della cartella,
    host di un remoto (compresi SSH e `file://`), argomenti di clone e init, iniezione nelle credenziali
    rifiutata, normalizzazione di token, account e cartella di base.

## [0.7.0] — 2026-11-08

### Il pannello dei dettagli si adatta a chi lo usa

-   **Ridimensionabile**: una maniglia sopra il pannello lo porta da un minimo del 18% a un massimo del
    78% dell'altezza; la misura scelta resta al riavvio.
-   **Riducibile a icona**: il pulsante `▾` chiude il pannello lasciando la sola riga delle schede, così
    la storia si vede tutta; `▴` lo riapre alla misura di prima.
-   **Apribile in una finestra sua** (`⧉`): il pannello diventa una finestra indipendente, da spostare
    su un altro schermo, affiancare o ridurre a icona. Quando la finestra si chiude il pannello torna
    al suo posto, con la stessa selezione. Finché è staccato, la finestra principale mostra la storia a
    tutta altezza.
-   **La finestra staccata segue la principale**: cambiare commit, file, scheda o formato del diff
    nell'una aggiorna l'altra. Se nella principale si apre un altro repository, il pannello lo segue.
    Il pannello non pubblica niente a sua volta, quindi non ci sono anelli di aggiornamento.

### Due modi di vedere le modifiche, finalmente distinti

-   La scheda **Changes del pannello** mostra le modifiche dentro il riquadro inferiore, con la storia
    ancora visibile sopra.
-   La voce **Changes della barra laterale** porta le modifiche a tutta area, senza storia né pannello.
    Sono due viste diverse perché servono a due momenti diversi: rivedere mentre si guarda la storia, o
    concentrarsi solo sulle modifiche.

### Corretto

-   **Il diff e l'albero non scorrevano.** Il contenitore dei pannelli cresceva con il contenuto e
    veniva tagliato dal riquadro: ora ha un'altezza vincolata e le due aree scorrono davvero, anche con
    un diff da migliaia di righe.
-   La scheda scelta non viene più sovrascritta quando si torna da *All Commits*.

### Menu del commit completo

-   **Crea ramo da qui…**, **merge di questo commit nel ramo attuale**, **rebase del ramo attuale su
    questo commit**, **reset soft / mixed / hard** (quest'ultimo in rosso, con conferma che dice cosa si
    perde), oltre a cherry-pick e copia di SHA e messaggio.
-   Lo SHA passato a Git è validato come esadecimale (`assertSha`): non può diventare un'opzione della
    riga di comando.
-   **L'undo copre anche il reset**: la voce registra il punto di arrivo (`target`) e «Annulla» ci
    riporta con `reset --soft`, lasciando le modifiche da rivedere. Se dopo il reset la storia è
    cambiata, l'annullamento si rifiuta invece di perdere altro lavoro.

### Numeri

-   110 test automatici (erano 108): SHA non validi, ramo da un commit, reset che non si trasforma in
    un'opzione.

## [0.6.0] — 2026-11-08

### Le operazioni che mancavano

-   **Pull, push, stash, submodule, terminale integrato, merge / rebase / cherry-pick** e **più
    repository aperti insieme**: sono i comandi che nella 0.5 non esistevano, tanto da non avere
    nemmeno un pulsante. Ora ci sono, e ogni pulsante fa quello che dice.
-   **Pull** solo `--ff-only`: un ramo divergente si ferma con il messaggio di Git invece di creare un
    merge che nessuno ha chiesto. **Push** senza forza, con `--set-upstream origin <ramo>` al primo
    invio, così il tracking non manca.
-   **Stash**: dialogo con messaggio facoltativo, elenco degli stash con data e ramo, applica, pop ed
    elimina. Salva anche i file non tracciati (`--include-untracked`).
-   **Submodule**: elenco con stato (allineato, da aggiornare, non inizializzato, in conflitto) e
    aggiornamento con `git submodule update --init --recursive`.
-   **Merge, rebase e cherry-pick** dal menu contestuale. Se Git si ferma su un conflitto compare un
    chip «Merge in corso · annulla» (o rebase / cherry-pick) che esegue `--abort`.
-   **Terminale integrato**, senza dipendenze nuove: `bash -lc` nella cartella del repository attivo,
    output in streaming a pezzi, pulsante *Interrompi*. Anche qui `GIT_TERMINAL_PROMPT=0`: un comando
    che chiede credenziali fallisce invece di restare appeso. Niente stdin interattivo, è dichiarato.
-   **Più repository aperti insieme**: un backend per root (`Map<root, CliGitBackend>`) e una sessione
    per scheda nel renderer. Ogni canale IPC porta il root come primo argomento, quindi una risposta in
    ritardo non può finire sulla scheda sbagliata; il watcher segue la scheda attiva. Le schede si
    chiudono con la ×, l'ultima non si chiude.
-   **L'undo copre anche merge, rebase e cherry-pick**: la voce registra il pre-HEAD e «Annulla» ci
    riporta con `reset --soft`, lasciando le modifiche da rivedere invece di buttarle.

### Navigazione

-   **Changes a tutta area**: clic su *Changes* nella barra laterale e il pannello delle modifiche
    prende l'area principale — niente storia e niente pannello inferiore, perché in quella modalità i
    commit non servono. *All Commits* riporta la storia e ricorda l'ultima scheda scelta.
-   **Clic su un ramo o un tag**: il cursore va al commit corrispondente nella storia, senza toccare il
    working tree. Se il commit è oltre la prima pagina la storia continua a caricare finché non compare.
-   **Tasto destro su un ramo**: checkout, merge, rebase, rinomina, elimina, copia nome e SHA; su un ref
    remoto, creazione del ramo locale con tracking. **Tasto destro su un commit**: cherry-pick, copia
    SHA e messaggio.
-   `window.prompt` non esiste in Electron: la rinomina usa un dialogo vero con Annulla e Conferma.

### Corretto

-   I messaggi d'errore mostravano il prefisso `Error invoking remote method 'git:…'` aggiunto da
    Electron; ora si legge il messaggio di Git.
-   Dopo un merge andato in conflitto lo stato viene riletto subito, così il chip «annulla» compare
    senza dover aggiornare a mano.
-   Il pull e il push non si disattivano più in base ai ref remoti noti: un repository con un remoto
    ancora vuoto deve poter fare il primo push.

### Numeri

-   108 test automatici (erano 99): 9 nuovi sulle operazioni (`src/core/ops.ts`), con i nomi di ref
    ostili (`--upload-pack=…`, spazi, `..`) che devono restare nomi e non opzioni.
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
