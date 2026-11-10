# Registro attività — githandler

> Una sezione per giorno, la più recente in alto. Ogni voce dice cosa è stato fatto e perché, in
> parole semplici. Ultimo aggiornamento: 2026-11-10

## 2026-11-10

### Changes più vicina al lavoro: il repository si aggiorna da solo, ordine, doppio clic, stash per file

-   **Cosa**: nella schermata delle modifiche le voci sono ora ordinate per ciò che serve decidere —
    prima quello che non è ancora pronto per il commit, sotto quello che lo è — un doppio clic sposta
    un file dall'una all'altra parte, ogni riga ha un pulsante per mettere da parte **solo quel file**,
    il tasto destro apre le stesse azioni, e il menu di un ramo ha «Allinea al suo upstream», che
    porta il ramo all'ultimo commit del server.
-   **Perché**: era stato segnalato che una modifica fatta in un editor compariva solo chiudendo e
    riaprendo il progetto. Il motivo era che l'app rileggeva il repository solo se avviata con
    un'opzione esplicita. Le altre quattro richieste sono scorciatoie per il lavoro di ogni giorno:
    meno clic per preparare un commit, e un modo per aggiornare un ramo senza passare dal terminale.
-   **Come**: la rilettura automatica ora è accesa di default (`--no-watch` la spegne per chi lavora in
    terminale); l'ordine è solo una diversa disposizione dei due elenchi; il doppio clic fa la stessa
    cosa dei pulsanti `+` e `−` (la selezione non ricostruisce più le liste, altrimenti il browser non
    riconoscerebbe il doppio clic); lo stash di un file usa lo stesso comando dello stash normale con un
    solo percorso; l'allineamento scarica il remoto, conta i commit delle due parti e avanza solo se è
    possibile senza riscrivere niente. Se le due parti hanno commit diversi l'app lo dice e chiede se
    riapplicare quelli locali sopra il remoto: se un conflitto si presenta, si risolve nella finestra
    dei conflitti che c'era già. Nessuna operazione distruttiva automatica.
-   **Verifica**: typecheck, 290 test (sei nuovi: quattro con un remoto vero — ramo già allineato,
    aggiornamento veloce, ramo divergente con rebase, ramo senza upstream — e due sui conteggi e
    sugli argomenti), build e screenshot in inglese con il nuovo ordine, il pulsante dello stash e la
    voce di menu del ramo. Provato anche sull'app in funzione: un file modificato da fuori compare da
    solo, il doppio clic sposta la riga, il menu del file ha le voci dello stash, «Allinea all'upstream»
    porta nel ramo un commit pubblicato da un altro clone e il pulsante `⇩` mette da parte il solo
    file.
-   **Stato**: fatto.
-   **Riferimento**: commit di questa sessione.

### Aggiornamenti firmati: il controllo c'è, l'installazione resta in mano all'utente

-   **Cosa**: l'applicazione ora può accorgersi che esiste una versione nuova e scaricarla, ma solo
    se il pacchetto porta una firma che corrisponde alla chiave pubblicata insieme all'app. La
    finestra **Aggiornamenti…** mostra la versione disponibile e le note, e il pulsante «Apri il
    pacchetto» la passa all'installatore del sistema.
-   **Perché**: senza un modo per aggiornare, chi installa il pacchetto deve accorgersi da solo che
    ne esiste uno nuovo, e fidarsi del primo file che trova. La firma dice da dove arriva il file
    prima che qualcuno lo apra.
-   **Come**: l'indirizzo del feed si mette nelle impostazioni (vuoto = spento, nessuna richiesta di
    rete); ogni release è firmata con una chiave Ed25519 che copre versione, indirizzo e impronta
    del pacchetto, e dopo il download l'impronta del file deve combaciare. Niente si installa da
    solo: il file verificato viene solo aperto con l'installatore. C'è anche un comando per chi
    pubblica (`build/sign-update.mjs`), e la procedura sta in `docs/aggiornamenti-firmati.md`.
-   **Verifica**: typecheck, 284 test (8 nuovi, con una coppia di chiavi generata al momento e la
    rete sostituita da una risposta finta), build e screenshot della finestra in inglese. **Non
    provato con un feed pubblicato**: servono la chiave e un repository di release, quindi la
    funzione per ora dice «non configurato».
-   **Stato**: scritto e provato nei suoi controlli; manca la prova su un feed reale e la decisione
    su chiave e repository di release.
-   **Riferimento**: commit di questa sessione.

### Installazione anche tramite Flatpak

-   **Cosa**: c'è un modo in più per installare l'applicazione su Linux: un pacchetto Flatpak, quello
    che si installa e si aggiorna dal centro software della distribuzione.
-   **Perché**: chi tiene le applicazioni dentro il sandbox di Flatpak non poteva usarla, e la voce
    era nella roadmap da tempo.
-   **Come**: un file di descrizione (`build/githandler.flatpak.yml`) e uno script (`npm run flatpak`)
    impacchettano l'applicazione con il runtime Electron e dichiarano solo i permessi che servono:
    leggere i repository dalla cartella personale e dalle unità rimovibili, usare l'agente SSH,
    mostrare notifiche e icona nella barra. Il sandbox di Chromium resta acceso, perché il runtime
    fornisce l'adattatore che serve dentro Flatpak.
-   **Verifica**: sintassi degli script e del file di descrizione controllata; **la build non è stata
    eseguita** perché `flatpak-builder` non è installabile su questa macchina. Lo dicono il README e
    il TODO.
-   **Stato**: scritto, in attesa di prova su una macchina con Flatpak; la pubblicazione su Flathub
    richiede prima il repository pubblico.
-   **Riferimento**: commit di questa sessione.

### Il pannello della salute dice anche quanto è grande il repository

-   **Cosa**: il controllo «Salute del repository» ora conta i commit e i file tracciati e avvisa
    quando il repository supera le dimensioni per cui l'app è stata misurata (50.000 commit o
    100.000 file), spiegando cosa cambia: la storia si legge a pagine e l'elenco dei file una cartella
    alla volta.
-   **Perché**: su repository molto grandi l'applicazione resta corretta ma più lenta, e finora non
    lo diceva da nessuna parte. Saperlo prima evita di pensare a un guasto.
-   **Come**: due comandi Git di sola lettura, eseguiti solo quando si apre il pannello (210 ms alle
    dimensioni di prova) e mai durante l'aggiornamento automatico; le soglie sono documentate in
    `docs/backend-performance.md` con le misure che le giustificano.
-   **Verifica**: typecheck, 275 test (uno nuovo sulle soglie e uno che legge un repository vero),
    build e misura con `npm run bench -- --commits 50000 --files 100000`.
-   **Stato**: completato.
-   **Riferimento**: commit di questa sessione.

### Approvare, chiedere modifiche e ritirare un'approvazione dall'app

-   **Cosa**: il pannello _Revisioni_ di una pull request ora dice anche chi ha chiesto modifiche e
    offre i pulsanti per approvare, chiedere modifiche o ritirare la propria approvazione. I pulsanti
    compaiono solo dove il servizio (GitHub, GitLab, Gitea, Bitbucket) permette davvero l'azione:
    niente comandi che finiscono in un errore di permessi.
-   **Perché**: prima si poteva solo approvare, e per chiedere modifiche o togliere un'approvazione
    bisognava aprire il browser. Era il lavoro rimasto aperto sulle revisioni.
-   **Come**: le tre richieste sono descritte una volta sola nel core, con le differenze dei quattro
    servizi (testo obbligatorio o assente, indirizzi e verbi diversi); ogni azione chiede conferma,
    perché cambia qualcosa che gli altri vedono, e poi rilegge lo stato dal servizio. Per GitHub e
    Gitea vale l'ultima revisione di ogni persona: chi ha approvato e poi chiesto modifiche non
    risulta più come approvazione.
-   **Verifica**: typecheck, 274 test (10 sulle revisioni, con gli indirizzi e i corpi dei quattro
    servizi e i casi limite del messaggio), build e controllo della finestra con gli screenshot.
-   **Stato**: completato.
-   **Riferimento**: commit di questa sessione.

### Installazione anche fuori da Ubuntu

-   **Cosa**: oltre al pacchetto `.deb` ci sono ora un **AppImage** portabile (un solo file da
    avviare, senza installazione) e un pacchetto **`.rpm`** per Fedora, RHEL e openSUSE. Il `.deb`
    porta con sé anche il profilo AppArmor che tiene acceso il sandbox di Chromium su Ubuntu 24.04+.
-   **Perché**: l'app era utilizzabile solo su Ubuntu; chi usa un'altra distribuzione doveva
    compilare i sorgenti, e su Ubuntu recente il sandbox restava spento.
-   **Come**: due script nuovi (`npm run appimage`, `npm run rpm`) impacchettano Electron e
    l'interfaccia; l'AppImage si porta dietro l'icona e un avvio che sceglie da solo se servono
    limitazioni; il pacchetto RPM descrive le proprie dipendenze leggendole dagli eseguibili. Nel
    `.deb` l'installazione carica il profilo AppArmor e l'avvio usa il sandbox normale, con il
    ripiego di prima solo se il sistema non lo permette. Corretta anche la licenza scritta nei
    documenti del pacchetto, che diceva MIT invece di GPL-3.0-or-later.
-   **Verifica**: AppImage avviata davvero in modalità senza schermo e controllata con gli
    screenshot; `.deb` e `.rpm` ispezionati per permessi, proprietario, profilo e dipendenze. Il
    pacchetto RPM non è stato installato su una distribuzione RPM, e il sandbox va riprovato su una
    macchina appena installata.
-   **Stato**: completato, con le due prove esterne ancora consigliate.

### La versione 0.12.0 e il pacchetto `.deb` provato come un utente vero

-   **Cosa**: il progetto si chiama adesso 0.12.0 anche nel file delle impostazioni del prodotto e nel
    changelog, e il pacchetto `.deb` per Ubuntu è stato installato e avviato su una Ubuntu pulita, non
    solo costruito. Sul nostro computer l'app era installata dalla cartella dei sorgenti (un avvio che
    ricompila a ogni partenza), quindi il pacchetto non era mai stato provato davvero.
-   **Perché**: era stato chiesto di riprodurre l'installazione di un utente normale. Costruire un
    pacchetto non dimostra che si installi: serve installarlo su un sistema senza niente dentro.
-   **Come**: la versione era rimasta 0.10.0 mentre le funzioni arrivate dopo non avevano ancora un
    numero, quindi il pacchetto sarebbe uscito con un'etichetta sbagliata; ora è 0.12.0 e la sezione
    del changelog è datata. Il pacchetto dichiara anche **git** come dipendenza (prima non lo faceva:
    su una Ubuntu minima l'app si sarebbe aperta senza poter leggere nessun repository) e le
    dipendenze non perdono più lo spazio dopo la virgola. Infine è stato rimosso l'avvio installato
    dalla cartella dei sorgenti, che sul nostro computer avrebbe coperto il pacchetto.
-   **Verifica**: installazione con `apt` su Ubuntu 24.04 in un ambiente isolato, con un utente senza
    privilegi; il programma parte da `/usr/bin/githandler` con il sandbox normale (senza
    `--no-sandbox`), apre la finestra e produce 36 schermate della propria interfaccia; la rimozione
    con `apt purge` non lascia file in `/opt`, `/usr/bin`, `/etc/apparmor.d` e `/usr/share/applications`.
    Un `git` già presente non viene toccato.
-   **Sul nostro computer** (la prova che conta): installato con `sudo apt install` il pacchetto
    0.12.0, il launcher sta in `/usr/bin/githandler`, la voce nel menu c'è e `aa-status` elenca il
    profilo `githandler`. Avviata l'app da lì su un repository di prova: otto processi, **nessuno con
    `--no-sandbox`**, etichetta AppArmor `githandler (unconfined)` su ognuno, finestra aperta. È il
    percorso con il sandbox vero, che l'installazione da sorgenti aggirava sempre con `--no-sandbox`.
-   **Icona mancante, e perché**: nella griglia delle applicazioni GitHandler compariva come una tile
    vuota. Non era il pacchetto: l'installazione da sorgenti aveva lasciato nella home un indice delle
    icone che puntava al file appena rimosso, e quel nome copriva l'icona buona. Tolto l'indice, lo
    script non lo crea più e ora ha `--remove`, che toglie i file e gli indici: chi passa dai sorgenti
    al pacchetto non se lo ritrova più davanti.
-   **Stato**: fatto e verificato.
-   **Riferimento**: commit di questa sessione.

## 2026-11-09

### Colori del codice nel diff

-   **Cosa**: il diff ora colora il codice secondo il linguaggio del file (TypeScript, Python, JSON,
    YAML, Markdown, Dockerfile e molti altri), con una nuova voce nelle impostazioni per spegnere i
    colori.
-   **Perché**: era l'ultima voce della milestone «il diff che conta»; leggere centinaia di righe
    senza sintassi rende più lenti i controlli prima del commit.
-   **Come**: sono stati aggiunti i parser di CodeMirror 6 (licenza MIT), compilati dentro
    l'interfaccia e quindi senza installazioni a parte. Il testo del repository continua a essere
    trattato come testo, mai come HTML; il colore della porzione cambiata nel diff affiancato resta
    esatto e un blocco troppo grande viene lasciato senza colori invece di rallentare la finestra.
-   **Verifica**: typecheck, 268 test (6 nuovi sul riconoscimento della lingua e sui token), build e
    screenshot in inglese di un diff TypeScript e della finestra delle impostazioni.
-   **Stato**: completato.
-   **Riferimento**: commit di questa sessione.

### Approvare una pull request senza uscire dall'app

-   **Cosa**: ogni pull request ha il pulsante **«Revisioni»**: dice chi ha approvato e permette di
    approvare con una conferma; su una richiesta chiusa o già approvata il pulsante non compare.
-   **Perché**: richiesta dell'utente — dopo aver letto i commenti, l'ultimo passo che costringeva al
    browser era l'approvazione.
-   **Come**: l'app legge lo stato dal servizio con l'account già collegato (review per GitHub e
    Gitea, `approved_by` per GitLab, `participants` per Bitbucket) e invia l'approvazione nella forma
    che ogni servizio si aspetta; poi rilegge, perché le risposte al comando cambiano troppo. Ritirare
    l'approvazione e «chiedi modifiche» restano nella pagina web: le quattro API non le espongono allo
    stesso modo.
-   **Verifica**: typecheck, 4 test nuovi sulle risposte dei quattro servizi e build; la finestra è
    stata controllata in inglese su un repository di prova.
-   **Stato**: completato.
-   **Riferimento**: commit di questa sessione.

### Avviare un workflow di GitHub dall'app

-   **Cosa**: nella finestra delle GitHub Actions c'è ora **«Avvia un workflow…»**: si sceglie il
    workflow, il ramo o tag e, se servono, gli input; l'elenco mostra anche il numero del tentativo
    quando un'esecuzione è stata ri-eseguita. In più la finestra si apre dalla palette dei comandi.
-   **Perché**: richiesta dell'utente — avviare un workflow richiedeva la pagina web di GitHub, e i
    tentativi si distinguevano solo per la data.
-   **Come**: l'app chiede a GitHub l'elenco dei workflow attivi e avvia quello scelto con
    `workflow_dispatch`; gli input sono un oggetto JSON di stringhe, controllato prima di partire
    (massimo dieci, nomi validi, niente numeri convertiti di nascosto). Un workflow senza quell'evento
    viene rifiutato da GitHub e il messaggio si legge così com'è. Il testo del menu ora dice «del
    repository»: l'elenco non è filtrato per ramo, e prima lo lasciava credere.
-   **Verifica**: typecheck, 2 test nuovi su indirizzi, input e tentativi, e build; la finestra è
    stata controllata in inglese su un repository di prova.
-   **Stato**: completato.
-   **Riferimento**: commit di questa sessione.

### Leggere e rispondere ai commenti di una pull request

-   **Cosa**: ogni pull request ha ora il pulsante **«Discussione»**: mostra i commenti della
    conversazione e permette di scriverne uno nuovo, senza aprire il browser.
-   **Perché**: richiesta dell'utente — il giro «apri la richiesta nel browser, leggi, torna
    all'app» era l'ultimo passo che costringeva a uscire dalla finestra.
-   **Come**: l'app chiede i commenti al servizio del repository con l'account già collegato, per
    GitHub, GitLab, Gitea/Forgejo e Bitbucket; il testo si mostra così com'è, senza interpretare la
    formattazione del servizio, e un commento vuoto o troppo lungo non viene inviato. Ctrl+Invio
    manda il commento, la conversazione scorre all'ultimo messaggio e la risposta di una richiesta
    precedente non finisce su quella aperta dopo.
-   **Verifica**: typecheck, 4 test nuovi sulle risposte dei quattro servizi e build; la finestra è
    stata controllata in inglese su un repository di prova.
-   **Stato**: completato.
-   **Riferimento**: commit di questa sessione.

### Riscrivere i commit senza il terminale, con un piano da controllare

-   **Cosa**: dal tasto destro su un commit si apre **«Rebase interattivo da qui…»**: una finestra
    elenca i commit fino a HEAD e permette di riordinarli, unirli, rinominarli o toglierli prima di
    applicare.
-   **Perché**: richiesta dell'utente — sistemare una serie di commit locali (unire due tentativi,
    correggere un messaggio, togliere un commit sbagliato) richiedeva il terminale.
-   **Come**: l'app prepara il piano e lo passa a Git; prima di eseguire controlla che nessun commit
    sparisca per omissione, che l'intervallo non contenga merge e che la storia non sia cambiata nel
    frattempo. Niente viene inviato al remoto e l'intera operazione resta annullabile con Annulla; un
    conflitto apre la finestra di risoluzione già presente.
-   **Verifica**: typecheck, 6 test nuovi su un repository vero (riordino, drop, reword con corpo,
    squash/fixup, undo e rifiuto dei merge) e build; la finestra è stata controllata in inglese.
-   **Stato**: completato.
-   **Riferimento**: commit di questa sessione.

### Vedere tutti i file del repository, non solo quelli toccati

-   **Cosa**: nel File Tree c'è ora il pulsante **«Tutti i file»**: mostra l'albero completo del
    commit o del repository e apre una cartella alla volta; «Modifiche» riporta all'elenco dei soli
    file modificati.
-   **Perché**: richiesta dell'utente — l'albero mostrava solo i file toccati, quindi per aprire un
    file non modificato bisognava lasciare l'app.
-   **Come**: l'app chiede a Git una cartella per volta invece di leggere tutto il repository in una
    volta, così un progetto grande non rallenta l'apertura della scheda; le cartelle già lette si
    scartano quando si cambia commit.
-   **Verifica**: typecheck, 3 test nuovi (lettura dell'albero, cartella annidata, repository senza
    commit) e build; la vista è stata controllata in inglese su un repository di prova.
-   **Stato**: completato.
-   **Riferimento**: commit di questa sessione.

### Scegliere da quale ramo dell'originale sincronizzare un fork

-   **Cosa**: «Sincronizza con l'originale» ora propone i rami dell'originale (con il predefinito già
    scritto) e, prima di unire o rebasare, dice quanti commit arriverebbero e quanti locali non sono
    ancora presenti lì.
-   **Perché**: richiesta dell'utente — un fork non si sincronizza sempre dal ramo principale, e
    sapere in anticipo quanti commit si ricevono evita un merge alla cieca.
-   **Come**: l'app legge i rami senza scaricare il repository, fa un solo aggiornamento e mostra i
    conteggi nella richiesta di conferma; solo dopo applica il merge o il rebase, senza forzare
    niente.
-   **Verifica**: typecheck, test nuovi sulla lettura dei rami e build.
-   **Stato**: completato.
-   **Riferimento**: commit di questa sessione.

### Lavorare su più cartelle dello stesso repository

-   **Cosa**: dalla palette dei comandi si apre **«Worktree»**: elenca le cartelle collegate allo
    stesso repository, ne crea una nuova su un ramo esistente o nuovo, la apre in una scheda e la
    rimuove quando è pulita.
-   **Perché**: richiesta dell'utente — per confrontare due rami o lasciare una build ferma mentre si
    lavora altrove serviva il terminale; ora la stessa cosa si fa dall'app, senza perdere le schede.
-   **Come**: l'app chiede a Git l'elenco dei worktree e non cancella niente da sola; la cartella
    principale non si può rimuovere e Git rifiuta la rimozione se ci sono modifiche non committate.
-   **Verifica**: typecheck, 2 test nuovi (lettura dell'elenco e creazione/rimozione su un repository
    vero) e build; la finestra è stata controllata in inglese su un repository di prova.
-   **Stato**: completato.
-   **Riferimento**: commit di questa sessione.

### Sapere se i remoti rispondono

-   **Cosa**: nella finestra **«Salute del repository»** c'è ora **«Controlla i remoti»**: per ogni
    remoto configurato l'app dice se risponde, quanti rami ha o perché non risponde.
-   **Perché**: richiesta dell'utente — un remoto cambiato o irraggiungibile si scopriva solo al
    momento del fetch o del push, con un errore che arrivava dopo.
-   **Come**: il controllo parte solo quando lo si chiede, aspetta al massimo 8 secondi per remoto e
    non ferma gli altri se uno è lento; la finestra della salute resta veloce e senza rete.
-   **Verifica**: typecheck, 2 test nuovi (uno puro e uno su un repository con un remoto vero e uno
    sparito) e build; la finestra è stata controllata in inglese su un repository di prova.
-   **Stato**: completato.
-   **Riferimento**: commit di questa sessione.

### Firmare un commit senza uscire dall'app

-   **Cosa**: accanto a «includi non staged» c'è ora la casella **«firma (GPG)»**: il commit viene
    firmato con la chiave già configurata in Git (GPG o SSH).
-   **Perché**: richiesta dell'utente — chi firma i commit doveva passare dal terminale per ogni
    commit, pur avendo la chiave già pronta.
-   **Come**: l'app si limita ad aggiungere l'opzione di firma a Git; non crea, non legge e non
    conserva chiavi. Se la firma non riesce, l'errore resta visibile sotto il campo con l'output
    completo.
-   **Verifica**: typecheck, test sugli argomenti del commit e build.
-   **Stato**: completato.
-   **Riferimento**: commit di questa sessione.

### Il pannello dei dettagli ricorda dov'era

-   **Cosa**: quando la finestra principale passa a un altro repository, la finestra dei dettagli
    riapre **l'ultimo commit guardato in quel repository** invece del primo della storia; se la
    finestra principale sta guardando un commit, vince quello. Il ricordo vale anche quando il
    pannello viene riaperto.
-   **Perché**: richiesta dell'utente — cambiando repository, i dettagli tornavano all'inizio della
    storia e bisognava ritrovare il commit a mano.
-   **Come**: il pannello salva per ogni repository l'ultimo commit mostrato e lo imposta prima di
    disegnare la vista, così la selezione automatica del primo commit non può più sovrascriverlo.
-   **Verifica**: typecheck, test esistenti e build.
-   **Stato**: completato.
-   **Riferimento**: commit di questa sessione.

### Un unico posto per capire cosa si può ancora recuperare

-   **Cosa**: dalla palette dei comandi si apre **«Recupero»**, una finestra che riassume l'ultima
    operazione annullabile, gli stash, le copie dei file scartati e gli spostamenti di HEAD nel
    reflog, con un pulsante che porta all'azione giusta.
-   **Perché**: richiesta dell'utente — le possibilità di recupero c'erano già ma erano sparse fra
    toolbar, finestra degli stash, impostazioni e reflog; chi temeva di aver perso qualcosa non
    aveva un punto da cui guardare.
-   **Come**: la finestra legge i dati che l'app ha già e mostra solo il riepilogo; non cancella,
    non applica e non ripristina niente se non quando si preme il pulsante corrispondente.
-   **Verifica**: typecheck, 3 test nuovi sul riepilogo (inclusi conteggi negativi) e build; la
    finestra è stata controllata in inglese su un repository di prova.
-   **Stato**: completato.
-   **Riferimento**: commit di questa sessione.

### Portare un file fuori dall'app

-   **Cosa**: i file elencati in **Staged**, **Unstaged** e nel **File Tree** si possono trascinare
    fuori dalla finestra, per esempio sulla scrivania o in un messaggio, come da un gestore file.
-   **Perché**: richiesta dell'utente — capita di dover allegare o copiare un file del repository
    senza aprire il gestore file e cercarlo nel percorso giusto.
-   **Come**: il file esce dalla finestra come un file normale; l'app controlla che il percorso sia
    davvero dentro il repository aperto, e non offre il trascinamento per i file eliminati o per i
    file di un commit (che possono non esistere più sul disco).
-   **Verifica**: typecheck, test esistenti sui percorsi (inclusi i tentativi di uscire dal
    repository) e build.
-   **Stato**: completato.
-   **Riferimento**: commit di questa sessione.

### Il messaggio di commit parte dal modello, e gli errori restano

-   **Cosa**: se il repository ha un modello di messaggio configurato in Git (`commit.template`), il
    campo del commit lo mostra già compilato. Inoltre, quando un controllo automatico rifiuta il
    commit, il suo messaggio completo resta visibile sotto il campo invece di sparire dopo pochi
    secondi.
-   **Perché**: richiesta dell'utente — chi usa un modello per il formato del messaggio lo ritrovava
    solo aprendo un editor, e un errore di un hook era difficile da leggere in un avviso breve.
-   **Come**: l'app legge il percorso del modello dalla configurazione del repository, con le stesse
    regole di Git, e lo propone solo se il campo è vuoto; il testo di un eventuale errore viene
    mostrato in un riquadro dedicato, che si svuota al tentativo successivo.
-   **Verifica**: typecheck, 3 test nuovi (regole del percorso, taglio e un repository reale) e build.
-   **Stato**: completato.
-   **Riferimento**: commit di questa sessione.

### Uno sguardo d'insieme prima che i problemi diventino grandi

-   **Cosa**: dalla palette dei comandi si apre **«Salute del repository»**, una finestra di sola
    lettura che segnala rami divergenti (con commit sia da inviare sia da ricevere), rami locali mai
    collegati a un remoto, stash dimenticati da più di 30 giorni, submodule non aggiornati e HEAD
    staccato.
-   **Perché**: richiesta dell'utente — sono tutte cose che non fermano il lavoro ma che si scoprono
    quando è tardi, per esempio uno stash rimasto lì per mesi o un ramo esistente solo su questa
    macchina.
-   **Come**: la finestra raccoglie le informazioni che l'app ha già (ref, stash, submodule) e le
    confronta con poche regole chiare; non cambia nulla nel repository e si può aggiornare con un
    pulsante.
-   **Verifica**: typecheck, 5 test nuovi (casi isolati e un repository reale) e build; la finestra è
    stata controllata in inglese su un repository di prova.
-   **Stato**: completato. Restano fuori, per ora, la raggiungibilità dei remoti e i repository che
    sono cresciuti troppo per la vista attuale.
-   **Riferimento**: commit di questa sessione.

### Riprovare solo quello che è andato storto

-   **Cosa**: nella finestra delle **GitHub Actions**, quando un'esecuzione è fallita compare
    **«Riprova i falliti»**: ripartono solo i job rossi, mentre quelli già passati non vengono
    ripetuti. «Ri-esegui» resta accanto per rifare l'intero workflow.
-   **Perché**: richiesta dell'utente — su un workflow lungo, ripetere tutto per un solo job fallito
    spreca tempo e minuti di esecuzione.
-   **Come**: usa l'endpoint dedicato di GitHub per i job falliti, e il pulsante compare solo dove c'è
    davvero qualcosa da riprovare (fallimento, timeout, avvio fallito o intervento richiesto).
-   **Verifica**: typecheck, test dedicati (endpoint e casi di stato) e build.
-   **Stato**: completato.
-   **Riferimento**: commit di questa sessione.

### Un promemoria quando i dettagli sono in un'altra finestra

-   **Cosa**: quando il pannello dei dettagli viene aperto in una **finestra separata**, nella barra in
    alto compare un piccolo indicatore **«Dettagli ↗»**. Un clic riporta davanti quella finestra; se la
    si chiude, l'indicatore sparisce.
-   **Perché**: richiesta dell'utente — separando i dettagli, la finestra principale non diceva più
    dove fossero finiti, e con più finestre aperte capitava di doverle cercare.
-   **Come**: riusa il segnale che la finestra principale riceve già quando il pannello si apre o si
    chiude, quindi non c'è uno stato in più da salvare e non può restare acceso per errore.
-   **Verifica**: typecheck, **225 test** verdi e build.
-   **Stato**: completato.
-   **Riferimento**: commit di questa sessione.

### Cercare dentro i file, non solo nei commit

-   **Cosa**: dalla palette (`Ctrl+K`, «Cerca nel contenuto…») si apre una finestra che cerca una
    parola o un'espressione regolare **dentro i file** del repository, non nella storia. Ogni
    risultato mostra il file, il numero di riga e il testo trovato; «Apri» lo apre con l'app del
    sistema.
-   **Perché**: richiesta dell'utente — la ricerca esistente guarda i messaggi di commit, ma quando ci
    si chiede «dove è definita questa cosa?» serve il contenuto.
-   **Come**: usa `git grep` sui file tracciati, con una casella per le espressioni regolari e una
    per distinguere le maiuscole. L'elenco si ferma a 1.000 risultati e lo dice, per non bloccare la
    finestra su un repository grande. Il testo cercato non può diventare un'opzione del comando.
-   **Verifica**: typecheck, **225 test** verdi (4 nuovi, di cui uno su un repository reale) e build;
    la finestra è stata provata in inglese su un repository di esempio, con due risultati e il
    conteggio corretto.
-   **Stato**: completato.
-   **Riferimento**: commit di questa sessione.

### Lo stash può salvare solo alcuni file

-   **Cosa**: la finestra dello **Stash** ora elenca i file modificati e non tracciati, con una
    casella per ciascuno. Si può salvare tutto come prima oppure togliere la spunta a quello che deve
    restare nel working tree; «Tutti» e «Nessuno» cambiano la selezione in un clic.
-   **Perché**: richiesta dell'utente — capita di voler mettere da parte una modifica urgente senza
    portarsi dietro il lavoro a metà su un altro file.
-   **Come**: quando la selezione è parziale, l'app passa a Git l'elenco dei file; gli altri non
    vengono toccati. I percorsi sono controllati prima di eseguire il comando, così un nome
    malformato non può uscire dal repository né diventare un'opzione.
-   **Verifica**: typecheck, **221 test** verdi (3 nuovi: argomenti e due casi su un repository
    reale) e build; la finestra è stata controllata in inglese con due file di prova, uno modificato
    e uno non tracciato.
-   **Stato**: completato.
-   **Riferimento**: commit di questa sessione.

### Si vede quando il trasferimento è in corso

-   **Cosa**: durante clone, fetch, pull e push la barra in alto mostra cosa sta facendo Git
    (ricezione oggetti, risoluzione, invio), una barra di avanzamento e la percentuale. Passando il
    mouse si legge anche il conteggio degli oggetti e la velocità.
-   **Perché**: richiesta dell'utente — su un repository grande o una rete lenta l'app sembrava
    ferma: si vedeva solo il risultato finale, o un errore.
-   **Come**: l'app legge l'output di avanzamento di Git mentre arriva, invece di aspettare la fine
    del comando; le righe sono interpretate da un modulo separato, che gestisce anche gli
    aggiornamenti sulla stessa riga e i messaggi che non contengono una percentuale. L'avanzamento
    di un'altra scheda non compare sopra quella attiva.
-   **Verifica**: typecheck, **219 test** verdi (5 nuovi sul testo di avanzamento e 1 su un clone
    reale da disco, fino al 100%) e build.
-   **Stato**: completato. La resa su una rete reale lenta non è riproducibile in laboratorio, ma la
    stessa lettura è stata provata su un clone vero.
-   **Riferimento**: commit di questa sessione.

### Un aspetto scelto da chi usa l'app

-   **Cosa**: nelle impostazioni c'è una nuova sezione **Aspetto** con il tema **chiaro**, **scuro** o
    **OLED** (nero assoluto), la densità **comoda** o **compatta** e tre **dimensioni del testo**.
    «Automatico» segue il tema del sistema e cambia da solo quando il sistema cambia.
-   **Perché**: richiesta dell'utente — l'app si usa tutto il giorno, e chi lavora con lo schermo
    chiaro o su un pannello OLED vuole che finestra e testi seguano le proprie preferenze invece di
    un unico tema scuro.
-   **Come**: i colori dell'interfaccia sono diventati variabili di tema, così le tre varianti non
    duplicano regole; l'aspetto si applica anche alla finestra dei dettagli. La scelta si vede subito
    nel dialog, «Annulla» la riporta indietro, e la dimensione del testo viene applicata dal processo
    principale all'intera finestra.
-   **Verifica**: typecheck, **213 test** verdi (1 nuovo sulle preferenze) e build; schermate
    prodotte in tema chiaro e in tema OLED con densità compatta e testo grande, controllate per
    leggibilità di toolbar, storia, modifiche e impostazioni.
-   **Stato**: completato.
-   **Riferimento**: commit di questa sessione.

### Un avviso quando i controlli automatici falliscono

-   **Cosa**: l'app ha ora un'icona nella **barra di sistema**, con «Mostra GitHandler», «Controlla
    adesso», l'interruttore delle notifiche e «Esci». Quando un controllo automatico del repository
    attivo fallisce arriva un avviso, **una volta sola**; prima non serve tenere la finestra davanti.
-   **Perché**: richiesta dell'utente — chi lancia i controlli e passa ad altro vuole sapere subito se
    qualcosa si è rotto, senza tornare a controllare il sito.
-   **Come**: ogni due minuti si legge l'ultima pagina delle esecuzioni (solo GitHub, come la finestra
    delle Actions). Il primo controllo dopo l'apertura è una fotografia e non avvisa di quello che era
    già rosso; un repository senza remoto o senza account non produce un avviso ogni due minuti.
    L'icona è ricavata dal logo già esistente e finisce anche nel pacchetto di installazione.
-   **Verifica**: typecheck, **212 test** verdi (4 nuovi sulla regola degli avvisi) e build; l'app è
    stata avviata con l'icona e il controllo automatico attivi, e l'errore di un repository senza
    remoto è comparso una volta sola. La resa dell'avviso di sistema va vista su un desktop con la
    barra di sistema.
-   **Stato**: completato.
-   **Riferimento**: commit di questa sessione.

### Si vede se i controlli automatici sono passati

-   **Cosa**: nella finestra delle pull request ogni richiesta ha ora il pulsante **«Controlli»**: legge
    l'esito dei controlli automatici (i workflow di GitHub, i job di GitLab, gli status di
    Gitea/Forgejo, i build di Bitbucket) sul commit in testa alla richiesta e mostra se sono passati,
    falliti o ancora in corso, con il dettaglio e il collegamento a ciascuno.
-   **Perché**: richiesta dell'utente — è la domanda che si fa prima di unire una richiesta, e finora
    la risposta stava solo sul sito.
-   **Come**: la lettura è in `src/core/checks.ts`, con un solo esito per ogni servizio (`ok`,
    `fallito`, `in corso`, `neutro`). Un controllo annullato o scaduto non viene mostrato come verde;
    un esito che non si conosce resta «in corso» invece di dichiarare un successo. Il collegamento a un
    controllo si apre solo se porta allo stesso sito dell'account.
-   **Verifica**: typecheck, **208 test** verdi (8 nuovi: indirizzi, SHA non validi, le quattro
    risposte e l'esito complessivo) e build. La prova dal vivo richiede un repository con account e
    controlli reali.
-   **Stato**: completato. Restano le notifiche dal tray, che vanno provate su una sessione desktop.
-   **Riferimento**: commit di questa sessione.

### Si può vedere dove era HEAD, e saltare a un commit qualsiasi

-   **Cosa**: c'è una finestra **«Reflog»** che mostra, dalla più recente, ogni volta che il
    repository è "saltato" da un commit all'altro — un commit, un cambio di ramo, un reset, un
    rebase — con la data e il pulsante per aprire quel commit nel pannello. Dalla palette c'è anche
    **«Vai al commit per SHA…»**, che porta a un commit qualsiasi scrivendone il codice, anche se non
    è nella pagina di storia caricata.
-   **Perché**: richiesta dell'utente — l'«Annulla» dell'app fa già la cosa giusta, ma finora non si
    poteva vedere cosa aveva fatto; ora la cronologia è esplicita e consultabile prima di decidere.
-   **Come**: la lettura sta in `src/core/reflog.ts` e passa dallo stesso backend della UI; il limite
    è di 200 voci per apertura. Guardare il reflog e saltare a un commit **non modificano** il
    repository: cambiano solo cosa si vede nel pannello.
-   **Verifica**: typecheck, **200 test** verdi (5 nuovi, con un `reset --hard` vero e un repository
    senza commit) e build; screenshot del dialogo in inglese e prova del salto a un commit.
-   **Stato**: completato.
-   **Riferimento**: commit di questa sessione.

### La ricerca nella storia trova di più

-   **Cosa**: al campo di ricerca della storia si sono aggiunte quattro domande che prima si potevano
    fare solo dal terminale: cercare un **espressione regolare** nel messaggio (`regex:`), sapere in
    quali commit **cambia il numero di occorrenze** di una parola (`change:`), quali commit hanno un
    diff con una **riga che corrisponde** a un'espressione (`diff:`), e la **storia di un intervallo
    di righe** di un file (`lines:10,40:percorso`). La sintassi compare da sola sotto il campo quando
    lo si apre. Il testo semplice resta letterale: le parentesi non diventano una regex per sbaglio.
-   **Perché**: richiesta dell'utente — la ricerca sapeva cercare solo una parola esatta, l'autore e il
    file; «quando è cambiato questo comportamento» era una domanda senza risposta dentro l'app.
-   **Come**: gli operatori stanno nella stessa riga di ricerca (`src/core/search.ts`); l'API per l'AI
    li riceve come argomenti separati. La ricerca per righe parte dal ramo corrente, perché Git non la
    accetta su tutti i rami insieme, ed è limitata a 1000 righe per volta. Corretto anche un
    `grep:` che finiva nel campo sbagliato.
-   **Verifica**: typecheck, **195 test** verdi (3 nuovi, fra cui quattro ricerche vere su un
    repository temporaneo) e build.
-   **Stato**: completato. Resta fuori la ricerca **dentro il contenuto** dei file: è un altro
    strumento (`git grep`) e un'altra schermata.
-   **Riferimento**: commit di questa sessione.

### Le pull request si vedono e si aprono dall'app

-   **Cosa**: nel menu del tasto destro sulla scheda del repository c'è ora **«Pull request…»**. Mostra
    le richieste aperte sul servizio (GitHub, GitLab, Gitea/Forgejo, Bitbucket) con titolo, autore,
    ramo di partenza e di arrivo e il pulsante per aprirle nel browser; dalla stessa finestra se ne
    **crea una nuova** scegliendo due rami, titolo e descrizione. Su GitLab la finestra si chiama
    «Merge request», come le chiama il servizio. Il comando è anche nella palette.
-   **Perché**: richiesta dell'utente — è il pezzo che chiude il ciclo quotidiano: commit, push, e
    infine la richiesta di fusione, senza cambiare programma.
-   **Come**: si usa l'account già scelto per il repository e lo stesso collegamento alle API delle
    GitHub Actions; i rami devono essere già stati inviati con Push, altrimenti il servizio rifiuta e
    l'app riporta il messaggio. Per sicurezza, un collegamento che arriva dal servizio si apre solo se
    porta allo stesso sito dell'account.
-   **Verifica**: typecheck, **192 test** verdi (10 nuovi sugli indirizzi, i corpi delle richieste e le
    risposte dei quattro servizi) e build; screenshot del dialogo in inglese. La prova senza un
    repository remoto mostra l'errore atteso.
-   **Stato**: completato. Restano fuori, per ora, commenti e revisioni e le richieste da un fork.
-   **Riferimento**: commit di questa sessione.

### L'assistente AI può anche modificare il repository

-   **Cosa**: il programma può ormai essere collegato a un assistente AI (tramite il protocollo MCP)
    e, se l'utente lo consente, lasciargli fare anche **cinque operazioni che cambiano il repository**:
    mettere file in stage, toglierli, creare un commit, creare un ramo e cambiare ramo. Restano
    escluse le operazioni rischiose (push, reset, rebase). Ogni scrittura lascia una traccia in un file
    dentro il repository.
-   **Perché**: richiesta dell'utente — la roadmap prevede l'assistente in scrittura, ma solo dietro un
    consenso esplicito, con la possibilità di sapere cosa ha fatto.
-   **Come**: i permessi restano nelle impostazioni dell'app, spente per default; l'opzione «solo
    lettura» non espone mai un comando che scrive. I nuovi comandi usano lo stesso meccanismo
    dell'interfaccia, quindi quello che fa l'assistente si vede subito e si può annullare con
    «Annulla». Il file di traccia (`.git/githandler/mcp-audit.jsonl`) registra data, comando,
    argomenti ridotti ed esito, **anche i tentativi falliti**; è leggibile solo dal proprietario, non
    cresce all'infinito (a 1 MB il vecchio diventa `.1`) e un errore nel scriverlo non blocca
    l'operazione.
-   **Verifica**: typecheck, **182 test** verdi (8 nuovi sulla traccia, 6 in più sul protocollo) e
    build; le prove girano su un repository temporaneo vero, con Git, non su simulazioni.
-   **Stato**: completato.
-   **Riferimento**: commit di questa sessione.

### Comandi dalla tastiera

-   **Cosa**: con `Ctrl+K` si apre una **palette dei comandi**: si scrive qualche lettera e si esegue
    l'azione con Invio, senza cercare il pulsante. Ci sono i comandi del repository (apri, crea, clona,
    aggiorna), della storia (modifiche, commit, cerca, annulla), dei rami (fetch, pull, push, stash) e
    della vista (schede del pannello, formato del diff, finestra separata). Il tasto `?` mostra
    l'elenco delle scorciatoie, che ora è anche nel README.
-   **Perché**: richiesta dell'utente — chi usa il programma tutti i giorni lavora più veloce da
    tastiera. Documentare le scorciatoie serve anche a chi arriva per la prima volta.
-   **Come**: ogni comando ha un nome e un solo punto in cui viene eseguito: la palette e le
    scorciatoie chiamano la stessa funzione, quindi non possono comportarsi in modo diverso. La ricerca
    trova anche le parole in inglese e ignora accenti e maiuscole. Una voce che in quel momento non ha
    senso (per esempio «Annulla» senza niente da annullare) non viene mostrata.
-   **Verifica**: typecheck, **168 test** verdi (6 nuovi sulla ricerca dei comandi) e build; screenshot
    controllati in italiano e in inglese, compreso un comando eseguito dalla palette (passa alla scheda
    Terminale).
-   **Corretto anche**: il menu dell'app intercettava `Ctrl+R` per ricaricare la finestra e la
    scorciatoia di aggiornamento non funzionava; ora la ricarica è `Ctrl+Shift+R`.
-   **Stato**: completato.
-   **Riferimento**: commit di questa sessione.

### Conflitti risolti senza uscire dall'app

-   **Cosa**: quando un'operazione Git si ferma perché due modifiche toccano la stessa riga (merge,
    rebase o cherry-pick), l'app apre un pannello per **risolvere il conflitto lì dentro**: elenco dei
    file, le due versioni affiancate, la scelta di quale tenere per ogni punto, la possibilità di
    correggere il testo a mano, «segna risolto», «continua» e, se serve, «annulla operazione». Prima
    l'unica strada era annullare.
-   **Perché**: richiesta dell'utente — è il passaggio che rende l'app usabile tutti i giorni: senza,
    al primo conflitto bisogna tornare al terminale.
-   **Come**: il programma legge dall'archivio Git le tre versioni del file (originale comune, mia,
    loro) e il testo attuale, mostra i conflitti uno per uno e ricostruisce il file con le scelte. Per
    un file intero si può tenere una delle due versioni, compreso il caso in cui una parte ha
    cancellato il file. «Continua» riprende l'operazione senza aprire un editor.
-   **Verifica**: typecheck, **162 test** verdi (7 sul parser dei conflitti, 6 su un merge vero in un
    repository temporaneo) e build; uno scenario di screenshot crea un conflitto reale, lo risolve
    dall'interfaccia e verifica che il merge sia stato completato. Controllate le schermate in
    italiano e in inglese.
-   **Corretto anche**: la finestra di conferma («sei sicuro?») chiamava se stessa e andava in errore;
    trovato proprio durante queste prove e sistemato.
-   **Stato**: completato. Restano fuori i casi rari: file binari (solo scelta per file) e conflitti
    dentro sottomoduli.
-   **Riferimento**: commit di questa sessione.

### Interfaccia in italiano e in inglese

-   **Cosa**: l'interfaccia dell'app può ora essere usata in **italiano o in inglese**. La lingua si
    sceglie nelle impostazioni ("automatica" segue quella del sistema) e la finestra si ricarica per
    applicarla. Sono tradotti i testi fissi della finestra, i menu, gli avvisi, le richieste di
    conferma, le etichette e le date. Aggiunto anche il codice che permette di forzare la lingua per
    fare screenshot o prove.
-   **Perché**: richiesta dell'utente — il codice va scritto in inglese, ma la vista deve esistere in
    italiano e in inglese. Senza questo, chi non legge l'italiano non può usare il programma.
-   **Come**: le stringhe italiane restano la lingua di partenza e un catalogo
    (`src/renderer/i18n.ts`) le traduce in inglese, comprese quelle che contengono valori variabili
    (nomi di ramo, conteggi). La scelta viene salvata nelle impostazioni e ricordata; all'avvio si
    legge prima la preferenza locale, così la finestra non appare nella lingua sbagliata.
-   **Verifica**: typecheck e **149 test** verdi, compresi quelli sul catalogo; screenshot in inglese
    prodotti con il repository di prova e controllati.
-   **Stato**: completato per la struttura della finestra e le parti comuni; le stringhe meno visibili
    e i messaggi che arrivano dai comandi Git restano nella lingua originale.
-   **Riferimento**: commit di questa sessione.

### Licenza GPL-3.0, CI e documenti di progetto

-   **Cosa**: il progetto ha una licenza definitiva (**GPL-3.0-or-later**, al posto della MIT), una
    verifica automatica su GitHub che compila ed esegue i test a ogni modifica, e i documenti che si
    aspetta chi arriva per la prima volta: come segnalare un problema di sicurezza, come contribuire,
    dove sta andando il progetto, i moduli per aprire una segnalazione di bug o una proposta, e le
    regole per chi lavora al codice. README con i badge di CI e licenza.
-   **Perché**: richiesta dell'utente — senza licenza e senza una verifica automatica il repository non
    è pubblicabile. Inoltre l'utente ha stabilito che il codice va scritto in inglese (identificatori,
    commenti, messaggi di commit) e che l'interfaccia deve esistere in italiano e in inglese.
-   **Come**: `LICENSE` sostituito con il testo GPL-3.0; `package.json` dichiara
    `GPL-3.0-or-later`; `.github/workflows/ci.yml` esegue `npm ci`, typecheck, test, build e uno smoke
    del benchmark su Node 24; aggiunti `SECURITY.md`, `CONTRIBUTING.md`, `ROADMAP.md`, `AGENTS.md` e i
    due moduli per le issue. README e README inglese aggiornati con licenza, badge e collegamenti.
-   **Verifica**: typecheck, test e build in locale; la CI eseguirà gli stessi comandi.
-   **Stato**: completato; il repository resta privato finché l'utente non decide di riaprirlo.
-   **Riferimento**: commit di questa sessione.

### Nomi altrui fuori, progetto presentabile, refresh tre volte più veloce

-   **Cosa**: tolto ogni riferimento ad altri client Git da README, registro, CHANGELOG, TODO, piani
    e commenti del codice; il piano dell'interfaccia è stato rinominato perché il vecchio nome
    conteneva il nome di un prodotto. Aggiunto il **README in inglese** con la traduzione completa e
    due **screenshot** presi da un repository di prova. Costruito il **pacchetto `.deb`** con Electron
    incluso (`npm run deb`), che installa app, launcher, voce nel menu e icona. Sulle prestazioni:
    misurato il refresh e corretto il punto più caro, cioè la rilettura della pagina di storia a ogni
    salvataggio.
-   **Perché**: richiesta dell'utente — poter raccontare e pubblicare il progetto senza dipendere da
    nomi e marchi di altri client, con una porta d'ingresso per chi non legge l'italiano e un
    pacchetto installabile; e chiudere i colli di bottiglia prima di riaprire il repository.
-   **Come**: testi riscritti per descrivere il prodotto per quello che fa; `README.en.md` con rimando
    reciproco e l'avvertenza di non affiliazione; `build/package-deb.sh` compone il pacchetto e
    dichiara le librerie di Electron con i nomi `t64` e quelli precedenti come alternativa (Ubuntu
    22.04–26.04); `build/shots.sh` isola il profilo Electron degli screenshot. Il refresh conserva la
    pagina di storia con l'impronta di HEAD (`branch.oid` di `git status --branch`) e dei ref e la
    rilegge solo quando cambiano; la `symbolic-ref` separata non serve più. Sul repository di prova
    (50.000 commit, 100.000 file) il refresh passa da **245 ms a 78 ms**. Aggiunto un test che
    verifica il riuso e l'invalidazione dopo un commit.
-   **Verifica**: `npm run typecheck`, **143 test** e build verdi; benchmark rifatto due volte con i
    numeri sopra; il pacchetto è stato estratto e avviato in modalità headless sul repository di
    prova, con screenshot prodotti (quindi `dist/` e `resources/app` sono corretti); topics GitHub
    impostati; README e piani riletti per cercare i nomi rimasti (nessuno).
-   **Stato**: completato. Il pacchetto `.deb` è nella release GitHub; il profilo AppArmor dedicato
    resta nella milestone 4.
-   **Riferimento**: commit di questa sessione.

### Il repository GitHub torna privato

-   **Cosa**: il repository `emaxlele/githandler` su GitHub è passato da pubblico a privato. Codice,
    commit e documenti restano gli stessi; cambia solo chi può vederli.
-   **Perché**: era già pubblico mentre si discuteva se lasciarlo tale e con quale licenza. In attesa
    della decisione si è scelto di non lasciare il progetto visibile.
-   **Come**: `gh api -X PATCH repos/emaxlele/githandler -F private=true`. Verificato che la API
    pubblica risponda `404` e che `gh repo view` riporti `PRIVATE`.
-   **Stato**: fatto — visibilità privata attiva. La scelta della licenza resta aperta: oggi `LICENSE`
    e `package.json` dicono MIT, in valutazione Apache-2.0 o GPL-3.0.
-   **Riferimento**: commit di questo registro (non ancora pushato).

### Anche il token torna da solo all'avvio

-   **Cosa**: dopo un riavvio non serve più premere **Accedi**. All'avvio l'app cerca i token che
    l'utente ha **già sulla macchina** — prima il credential helper di Git, chiesto per l'utente di
    quell'account, poi GitHub CLI — e li tiene in memoria come sempre. Se non trova niente, l'accesso
    resta manuale e il token inserito a mano viene consegnato a Git se c'è un credential helper.
-   **Perché**: completava la lamentela dell'utente sul dover «riconfigurare tutto» a ogni riapertura:
    le schede ora tornano, il token era l'ultima cosa che si perdeva.
-   **Come**: `hydrateTokens` parte dopo che la finestra è pronta, quindi non rallenta l'avvio (misurato:
    finestra pronta in ~300 ms anche quando non c'è nessun token). La ricerca non scrive niente su
    disco: `git credential fill` per quell'utente e, solo se su quell'host c'è un unico account,
    `gh auth token` — GitHub CLI tiene un token per host, e con due utenti sarebbe ambiguo. Un esito
    negativo si ricorda per la sessione, così un fetch senza token non riapre un helper grafico ogni
    volta. Anche la prima operazione di rete usa la stessa ricerca.
-   **Verifica**: tipi, 142 test e build puliti. Prova con l'app: account GitHub reale recuperato in
    memoria all'avvio senza toccare `accounts.json` (stesso hash prima e dopo), account GitLab senza
    token che resta senza token e non blocca l'avvio, `machineToken` del flusso «Accedi» invariato.
-   **Stato**: completato.
-   **Riferimento**: commit del repository `~/Projects/githandler`.

### Le schede dei repository si riaprono da sole

-   **Cosa**: chiudendo e riaprendo l'applicazione i repository dell'ultima volta tornano aperti, nello
    stesso ordine di schede, e la finestra si ferma su quello che si stava guardando. Prima ogni riavvio
    ripartiva dalla schermata di benvenuto e i progetti andavano riaperti uno per uno. Un percorso
    sparito non blocca l'avvio: quella scheda semplicemente non torna.
-   **Perché**: era la lamentela dell'utente — «perché ogni volta che faccio una modifica e riapro
    l'applicazione mi ritrovo a dover riconfigurare tutto, anche i progetti che avevo aperto?». Le
    impostazioni e gli account erano già salvati su disco: erano le schede a vivere solo in memoria.
-   **Come**: l'elenco dei repository aperti (e quale era attivo) viene scritto in
    `localStorage["githandler.sessions"]` a ogni apertura, chiusura e cambio scheda; all'avvio viene
    riletto e ogni repository viene riaperto, saltando quelli che non esistono più. `--repo` si aggiunge
    alle schede riaperte invece di essere consumato dal ripristino. Il file delle preferenze resta
    `~/.config/githandler/settings.json` (verificato che si scrive), gli account restano in
    `accounts.json`; il token continua a **non** essere scritto su disco per scelta: senza un credential
    helper di Git va rifatto «Accedi» (con `gh` installato basta un clic).
-   **Verifica**: tipi e build puliti. Prova con l'app su due repository di prova e un profilo separato:
    prima apertura, riavvio senza argomenti con due schede e quella attiva giusta, percorso inesistente
    saltato e lista riscritta, chiusura della scheda attiva con lo stato salvato aggiornato, terzo avvio
    con `--repo` che si aggiunge alle schede esistenti.
-   **Stato**: completato.
-   **Riferimento**: commit del repository `~/Projects/githandler`.

### La sezione Commit racconta il commit, non ripete l'elenco dei file

-   **Cosa**: la sezione **Commit** del pannello in basso non mostra più i file come pastiglie (erano la
    terza copia dello stesso elenco, dopo il _File Tree_ e le modifiche). Al loro posto c'è una **riga di
    analisi**: una barra che mostra a colpo d'occhio quanto pesa il commit fra righe aggiunte e rimosse,
    i totali `+N`/`−M`, e quanti file, cartelle, binari e file per stato tocca. Sotto, il **diff
    dell'intero commit** in un unico scorrimento, come farebbe `git show`, invece di dover scegliere un
    file alla volta. Il diff parte **unito** (non più affiancato) e la scelta del formato non viene più
    ricordata da un avvio all'altro. Se un commit è enorme, il pannello mostra i primi 12 file o le prime
    4.000 righe e scrive quanti ne restano, rimandando al _File Tree_ per leggerli uno per uno.
-   **Perché**: era la richiesta dell'utente — «di default voglio unified invece che affiancato; riguardo
    la sezione commit è inutile in quel modo e una replica di file tree, togli dalla sezione commit i
    file e in caso metti altro, che so qualcosa di analisi, qualcosa di utile e diverso».
-   **Come**: l'elenco dei file è stato tolto dal pannello e sostituito con i numeri che l'elenco non
    dà (peso, cartelle, stati). I totali di righe non erano disponibili da quello che l'app chiedeva già
    a Git, quindi è stata aggiunta una lettura dedicata (`git show --numstat`) con il suo parser, provato
    anche sui file binari e sui percorsi difficili. Il diff del commit viene letto una volta e tenuto in
    memoria: cambiare formato non rilegge il disco e il refresh automatico non lo riscarica più.
-   **Verifica**: 142 test automatici verdi (2 nuovi sui totali delle righe), tipi e build puliti. Prova
    reale con l'app su repository di prova: commit normale, commit di merge, commit vuoto con committer
    diverso, commit con 5 file e commit con 15 file (12 mostrati e la nota sul resto), file unico da
    3.000 righe, passaggio unito/affiancato senza nuove letture, pannello in finestra separata che segue
    il commit. Screenshot a 1440×940.
-   **Stato**: completato.
-   **Riferimento**: commit del repository `~/Projects/githandler`.

### Accedere senza intoppi, sapere chi comanda su ogni repository, seguire fork e Actions

-   **Cosa**: il pulsante **Accedi** del dialogo account ora funziona con un clic se sulla macchina c'è
    già un token (GitHub CLI o credential helper di Git), senza chiedere nessun Client ID; se non c'è, lo
    dice e restano le due strade esplicite (browser o token incollato). Nell'intestazione compare un
    **chip con l'account** che sta usando il repository attivo: cliccandolo si può scegliere un altro
    account o togliere la scelta. Dal menu della scheda del repository ora si può **sincronizzare un
    fork con il repository originale** (merge o rebase), **aprire un file del repository** (dal sistema o
    nel browser), **esportare il contenuto di HEAD in uno zip** e gestire le **GitHub Actions** (vedere le
    ultime esecuzioni, ri-eseguirle o annullarle). L'elenco dei repository degli account ha **Carica
    altri**.
-   **Perché**: era la richiesta dell'utente — «faccio accedi da browser ma vuole per forza l'id, io
    dovrei fare solo la login», «come fa per ogni repo a capire con quale account lavorare», «sarebbe
    carino gestire i sync ai repo originali quando è un fork, magari anche gli actions» — più il resto
    del TODO.
-   **Come**: il device flow OAuth **non può funzionare senza un Client ID registrato**: non esiste un
    flusso anonimo, quindi l'app non finge il contrario. Prima cerca il token che l'utente ha già
    (`gh auth token`, poi `git credential fill`), lo verifica con `GET /user` e salva l'account; il
    Client ID resta per l'accesso dal browser. Per l'account, il remoto dice l'host ma non con quale
    utente è stato clonato: le regole sono, dalla più forte alla più debole, scelta salvata, proprietario
    del remoto, unico account dell'host, primo di più account — e quest'ultimo caso è **dichiarato** nel
    chip invece di essere presentato come certezza. Per i fork il repository originale si chiede all'API
    del provider, il remoto `upstream` si crea solo se manca, e il sync è `fetch` + `merge`/`rebase`
    **senza forza**: un conflitto resta annullabile. Le Actions sono solo GitHub e usano il token
    dell'account risolto; l'elenco dei file usa i file tracciati da Git; lo zip è `git archive`, quindi
    rispetta filtri ed `export-ignore`.
-   **Verifica**: 140 test automatici verdi (10 nuovi), tipi e build puliti. Prova reale con l'app: un
    account collegato con il pulsante **Accedi** contro un'API finta (token non scritto su disco, file
    `0600`), chip che passa da «unico account» a «primo di più account» ed è dichiarato come
    supposizione, scelta per il repository salvata in `settings.json` e mantenuta dopo aver salvato le
    impostazioni, sync di un fork con remoto `upstream` creato e merge andato a buon fine, elenco file
    filtrato e aperto nel browser (URL corretto, anche con spazi nel nome), zip esportato e verificato,
    Actions lette e ri-eseguite/annullate contro l'API finta, paginazione dei repository da 100 a 200.
-   **Stato**: completato.
-   **Riferimento**: commit del repository `~/Projects/githandler` (v0.10.0).

### Nomi più chiari e spiegazioni su pulsanti e menu

-   **Cosa**: i tre pulsanti del dialogo account ora dicono cosa fanno — **Accedi con il token del
    computer**, **Accedi con il browser (serve il Client ID)**, **Crea un token sul sito e incollalo…** —
    e il testo sopra il form spiega le tre strade. Se si prova l'accesso dal browser senza Client ID,
    l'errore resta scritto nel dialogo e non solo in un messaggio che sparisce. Quasi tutti i pulsanti
    della finestra (toolbar, schede, dialoghi, file, Actions, schermata di benvenuto) ora mostrano un
    suggerimento al passaggio del mouse, e ogni voce dei menu contestuali spiega cosa fa.
-   **Perché**: era la richiesta dell'utente — «con accedi col browser mi compare sempre l'errore, con
    crea no, ma cosa cambia tra i due e come mai ci sono entrambi? bisogna mettere nomi più esaustivi…
    vorrei che in più voci possibili ci siano i popup che spiegano cosa fanno».
-   **Come**: i nomi dei pulsanti dichiarano la strada (token già presente sul computer, browser con
    Client ID, token creato a mano). I suggerimenti usano l'attributo `title`, che non introduce nuove
    finestre né dipendenze; per i menu contestuali è stato aggiunto `MenuEntry.hint`, così la spiegazione
    resta nella definizione della voce.
-   **Verifica**: tipi e build puliti, 140 test verdi; prova nell'app del dialogo account (errore del
    Client ID nello stato), dei menu della scheda, del commit e della nuova scheda, e dei titoli dei
    pulsanti.
-   **Stato**: completato.
-   **Riferimento**: commit del repository `~/Projects/githandler`.

### Una sola schermata per le modifiche, e il commit raccontato come una scheda

-   **Cosa**: la scheda **Changes** del pannello in basso è stata **tolta**. Le modifiche si vedono solo
    dalla voce _Changes_ della barra laterale, che apre la vista a tutta area. Il **numero accanto a
    _Changes_** ora si comporta da spia: sparisce quando non c'è niente da fare, è verde quando basta
    il commit e ambra quando qualcosa non è ancora in stage; al passaggio del mouse dice quanti file sono
    in stage e quanti fuori. La sezione **Commit** del pannello in basso è stata **ridisegnata**: prima
    era un elenco di percorsi accanto al diff, cioè la stessa cosa del _File Tree_ ma più povera; ora è
    una scheda con autore, oggetto, data, SHA (un clic lo copia), quanti genitori e quanti file, il
    corpo del messaggio e i file toccati come pastiglie orizzontali, con il diff a tutta larghezza.
-   **Perché**: era la richiesta dell'utente — «changes qui non serve a nulla visto che abbiamo l'altro
    sul pannello laterale», «bisogna fare un contatore che faccia capire a colpo d'occhio se ci sono
    modifiche», «va fatta diversa questa visualizzazione della sezione commit perché così com'è è come
    ripetere la sezione File tree ma in modo brutto».
-   **Come**: la causa della duplicazione era un unico pannello spostato tra l'area principale e quella
    inferiore: ora vive solo nell'area principale e la scheda inferiore non esiste più. Il contatore
    nasce dal confronto tra file in stage e file fuori; la scheda del commit separa l'identità (una
    riga), il messaggio (due righe al massimo) e i file (pastiglie che scorrono in orizzontale), lasciando
    l'albero solo a _File Tree_. Il protocollo della finestra staccata è stato allineato alle schede
    rimaste.
-   **Verifica**: tipi e build puliti, 140 test automatici verdi. Prova reale con l'app su un repository
    di prova: contatore assente a zero e verde/ambra nei due casi, nessuna scheda _Changes_ nel pannello,
    passaggio da modifiche alla storia con un clic su una scheda, scheda del commit con corpo del
    messaggio, commit di merge («2 genitori») e cinque file, _File Tree_ ancora a due colonne, pannello
    in finestra separata che segue scheda e commit. Screenshot a 1440 e 940 pixel di larghezza.
-   **Stato**: completato.
-   **Riferimento**: commit del repository `~/Projects/githandler`.

## 2026-11-08

### Dal repository al file, e il token preso dal browser

-   **Cosa**: dal repository ora si arriva al **file** e alla **cartella**. C'è un pulsante _Cartella_
    che apre la posizione del progetto; il tasto destro sulla scheda del repository apre la cartella,
    copia il percorso o apre il repository nel browser; il tasto destro su un file (e il doppio clic) lo
    apre con il programma associato, lo mostra nella cartella, ne **salva una copia** fuori dal
    repository o ne copia il percorso; il tasto destro su un commit aggiunge _Apri il commit nel
    browser_. Inoltre il **token si può prendere dal browser**: si sceglie _Accedi con il browser_, si
    inserisce il codice mostrato nella pagina che si apre da sola e l'account risulta collegato, senza
    copiare token a mano.
-   **Perché**: era la richiesta dell'utente — «aprire la posizione del repo, aprire un file, scaricare
    un file dal repo… e il token preso facendo la login nel browser». Prima, per vedere un file o
    portarlo fuori bisognava passare dal terminale o dal gestore file, e il token andava creato a mano
    sul sito del provider e incollato.
-   **Come**: le richieste sui file arrivano alla parte che ha accesso al sistema solo con percorsi
    relativi al repository, e lì vengono **verificate** (niente `..`, niente percorsi assoluti, niente
    nomi che iniziano con `-`). La copia di un file di un commit è la versione di allora, letta dai dati
    di Git e non dal disco, quindi funziona anche per file cancellati o rinominati e per i binari, fino
    a 64 MiB (oltre, l'app lo dice invece di troncare). Gli indirizzi web sono ricavati dal remoto del
    repository: per GitHub, GitLab e Bitbucket il link al commit e al repository; dove la forma non è
    certa (Gitea, remoti che non sono siti web) il comando lo dichiara invece di aprire un indirizzo
    sbagliato.
-   **Il token dal browser**: l'accesso usa il flusso OAuth «device» di GitHub e GitLab, che esiste per i
    programmi che non possono ricevere una risposta dal browser. Il token lo riceve solo la parte
    interna dell'app, che lo tiene in memoria come prima; alla finestra torna soltanto «fatto». Serve un
    Client ID di un'applicazione OAuth del provider: è un dato pubblico (viaggia nell'URL), non un
    segreto, e l'app lo conserva insieme agli altri dati dell'account. Per Gitea e Bitbucket, che non
    offrono questo flusso, resta il pulsante che apre la pagina dei token con le autorizzazioni già
    indicate.
-   **Verifica**: 130 test automatici verdi (10 nuovi, fra cui copie byte per byte di file di testo e
    binari da working tree e da commit), tipi e build puliti. Prova reale: copia di un file modificato e
    di un file di un commit precedente, con confronto byte per byte; file binario da un commit identico
    all'originale; tentativo di aprire `../../etc/passwd` rifiutato; indirizzo `file://` rifiutato;
    apertura del repository e del commit nel browser (URL corretti); accesso dal browser contro un
    server GitLab finto — codice mostrato, pagina aperta, attesa poi account salvato con il token **non**
    scritto su disco — e messaggio chiaro quando il provider non risponde.
-   **Stato**: completato.
-   **Riferimento**: commit del repository `~/Projects/githandler` (v0.9.0).

### Si può partire da zero: creare un repository, clonarlo, collegare un account

-   **Cosa**: l'app ora sa **creare** un repository nuovo (chiedendo, se si vuole, nome ed email da usare
    solo lì), **clonare** da un URL o **dall'elenco dei repository di un account** GitHub, GitLab,
    Gitea/Forgejo o Bitbucket, e **gestire gli account** cambiando il token quando serve. Si può anche
    **spostare il programma su un commit preciso**, non solo su un ramo. All'avvio, se non c'è nessun
    progetto aperto, compare una **schermata di benvenuto** con le quattro scelte e non più la finestra
    di sistema; il tondino **«+»** delle schede, che prima stava in basso a sinistra, è ora **centrato**.
-   **Perché**: erano i punti mancanti segnalati nella revisione — chi apre GitHandler la prima volta non
    aveva modo di creare o scaricare un progetto, il checkout funzionava solo sui rami, esisteva solo
    GitHub e il token non si poteva cambiare. In più la cartella da cui partire si sceglie una volta e
    vale per tutte le finestre di apertura e di clonazione.
-   **Come**: la creazione usa `git init` e scrive l'identità **solo nel repository**, mai nella
    configurazione globale dell'utente. Il clone prende il nome della cartella dall'URL e avvisa se la
    destinazione esiste già. Per gli account l'app conserva soltanto i dati dell'utente (provider, host,
    indirizzo dell'API, nome utente, etichetta): il **token non viene mai scritto** in un file
    dell'app, resta in memoria e viene passato a Git al momento dell'operazione, quindi non compare
    nemmeno nell'elenco dei processi. Se sulla macchina c'è un gestore di credenziali di Git, il token
    viene anche consegnato a quello. Togliendo l'account il token esce dalla memoria dell'app, ma quello
    che Git ha salvato resta di Git.
-   **In più**: chiudendo l'ultima scheda si torna al benvenuto (prima l'ultima non si poteva chiudere) e
    i comandi che hanno bisogno di un repository sono spenti quando non ce n'è uno aperto. Dopo un
    checkout su un commit l'intestazione mostra lo stato reale invece del ramo di prima.
-   **Verifica**: 120 test automatici verdi (10 nuovi), build riuscita. Prova reale: repository creato da
    zero, clone da un repository locale, checkout di un commit e ritorno al ramo con _Annulla_, account
    di prova con elenco di due repository e clone da lì, token sbagliato che produce un messaggio chiaro,
    file degli account con permessi `0600` e senza token.
-   **Stato**: completato.
-   **Riferimento**: commit `3367768` del repository `~/Projects/githandler`.

### Pannello dei dettagli ridimensionabile, a icona e in una finestra sua

-   **Cosa**: il riquadro in basso (commit, modifiche, albero dei file, blame, terminale) ora si può
    **allargare e stringere** con una maniglia, **chiudere lasciando solo la barra delle schede** per
    vedere tutta la storia, e **aprire in una finestra separata** da mettere su un altro schermo o
    accanto alla principale. Quando quella finestra si chiude il riquadro **torna al suo posto** con la
    stessa selezione. Inoltre il diff e l'albero dei file **scorrono davvero**: prima il contenuto
    veniva tagliato e non c'era modo di leggere il resto.
-   **Perché**: erano le richieste della revisione dell'interfaccia — con un diff lungo non si poteva
    leggere nulla, e chi lavora su due monitor vuole i dettagli di là e la storia di qua. In più i due
    modi di vedere le modifiche erano confusi: ora la scheda _Changes_ del riquadro le mostra lì dentro,
    mentre la voce _Changes_ della barra laterale continua a portarle a tutta area.
-   **Come**: la maniglia si trascina fra il 18% e il 78% dell'altezza e la misura resta al riavvio; il
    pannello ridotto occupa la sola riga delle schede. La finestra separata usa lo stesso programma in
    modalità «solo pannello»; è la finestra principale a decidere cosa si sta guardando e a comunicarlo,
    così le due non si rincorrono. Se nella principale si apre un altro repository, la finestra dei
    dettagli lo segue.
-   **In più**: il menu del tasto destro su un commit ora ha **crea ramo da qui, merge, rebase e reset**
    (soft, mixed, hard, quest'ultimo in rosso con conferma), oltre a cherry-pick e copia. Il reset si può
    annullare con _Annulla_: si torna al punto di prima lasciando le modifiche da rivedere.
-   **Verifica**: 110 test automatici verdi (2 nuovi), build riuscita. Prova reale con un repository di
    dimostrazione: diff da oltre 5.000 righe che scorre, albero che scorre, pannello ridotto e riaperto,
    pannello staccato e rientrato, selezione sincronizzata fra le due finestre, ramo creato dal menu,
    reset annullato.
-   **Stato**: completato.
-   **Riferimento**: commit `e82eebc` del repository `~/Projects/githandler`.

### Pull, push, stash, terminale e più repository: le operazioni che mancavano

-   **Cosa**: l'app ora sa fare **pull** e **push** verso il server, salvare e riprendere le modifiche
    con lo **stash**, elencare e aggiornare i **submodule**, unire due rami (**merge**), riscrivere un
    ramo sopra un altro (**rebase**) e applicare un singolo commit altrove (**cherry-pick**). C'è una
    scheda **Terminale** per lanciare comandi nella cartella del progetto e si possono tenere aperti
    **più repository insieme**, ognuno nella propria scheda. Se un merge o un rebase si ferma su un
    conflitto compare un avviso con «annulla» che riporta allo stato di prima.
-   **Perché**: erano i comandi che mancavano per lavorare tutto il giorno senza tornare al
    terminale; la richiesta era esplicita. In più il clic su un ramo non doveva più cambiare ramo di
    nascosto, e la voce _Changes_ doveva mostrare le modifiche a tutta area, senza la storia: in
    quella modalità i commit non servono.
-   **Come**: pull e push non forzano mai — se il ramo è divergente o manca il collegamento al server
    si ferma e mostra il messaggio di Git, invece di combinare qualcosa da solo. Il clic su un ramo o
    un tag sposta il cursore sul suo commit; le operazioni (checkout compreso) sono nel menu del tasto
    destro, e lo stesso vale per cherry-pick e copia su un commit. Ogni repository aperto ha la sua
    scheda che ricorda selezione e pannello; il terminale gira solo nella cartella del repository
    attivo e ha il pulsante per interrompere il comando.
-   **Verifica**: 108 test automatici verdi (9 nuovi), build riuscita, app reinstallata. Prova reale
    con un repository di dimostrazione e un server locale: push con collegamento creato, pull,
    stash e ripresa, cherry-pick annullato con _Annulla_, rebase riuscito, merge in conflitto con
    l'avviso «annulla», terminale con `git status`, submodule elencato e aggiornato, due repository
    aperti in schede e chiusura della scheda attiva.
-   **Stato**: completato.
-   **Riferimento**: commit `6b3f718` del repository `~/Projects/githandler`.

### Rifinitura: nessuna risposta in ritardo sul repository sbagliato

-   **Cosa**: con più repository aperti, se si cambia scheda mentre l'app sta leggendo un diff, il
    blame o la pagina successiva della storia, il risultato che arriva dopo non viene più mostrato sul
    repository sbagliato: resta nella scheda che lo aveva chiesto e la sblocca.
-   **Perché**: era l'ultimo punto debole delle schede multiple; senza il controllo il diff di un
    repository poteva comparire sopra un altro, o la storia dell'uno mescolarsi con quella dell'altro.
-   **Stato**: completato, 108 test verdi e build riuscita.
-   **Riferimento**: commit `8a3aa9c` del repository `~/Projects/githandler`.

### L'interfaccia ora ha la struttura dei client Git desktop più usati

-   **Cosa**: la finestra è stata ridisegnata. In alto ci sono le azioni con icona e nome (Apri,
    Fetch, Aggiorna, Annulla) e, al centro, il nome del repository con il ramo. Sopra la storia c'è la
    scheda del repository aperto. A sinistra ci sono _Changes_ con il numero di file modificati, _All
    Commits_, la casella di filtro e gli elenchi di rami, remoti e tag. Al centro la storia mostra
    cinque colonne: il grafo colorato, il messaggio con le etichette dei rami e dei tag, l'autore con
    le iniziali colorate, il codice breve del commit e la data. In basso quattro schede: _Commit_, con
    autore e committer separati (sono due persone diverse dopo un rebase), codice, genitori e
    messaggio; _Changes_, con i file pronti per il commit e quelli ancora da aggiungere in due
    elenchi; _File Tree_, con la cartella del progetto ad albero; _Blame_.
-   **Perché**: la versione precedente funzionava ma la disposizione era nostrana: chi arriva da un
    altro client Git deve poter ritrovare le stesse zone senza imparare una nuova mappa. La richiesta
    era di avere la stessa organizzazione delle foto di riferimento, con libertà sui dettagli visivi;
    il tema scuro del progetto è rimasto.
-   **Come**: solo la disposizione è stata presa a modello, non il codice né le immagini di altri
    programmi. I comandi mostrati sono soltanto quelli che l'app sa fare davvero: niente pulsanti per
    pull, push, stash o più repository aperti insieme, che non esistono ancora. Aggiunto anche il
    dettaglio completo del commit (autore, committer, date, genitori, corpo del messaggio), che prima
    mancava.
-   **Corretto anche**: i commit di merge comparivano senza alcun file; ora mostrano le modifiche
    rispetto al ramo in cui il merge è stato fatto.
-   **Stato**: completato, 99 test automatici verdi, build riuscita, app installata e aperta da
    `/tmp/gitdemo` per la prova.
-   **Riferimento**: commit `3b81eef` del repository `~/Projects/githandler`.

### Il progetto si chiama GitHandler

-   **Cosa**: il programma ora si chiama **GitHandler**. Sono cambiati il nome dell'app e della
    finestra, la cartella del progetto (`~/Projects/githandler`), il repository GitHub, il nome delle
    copie di sicurezza interne (`refs/githandler`), la cartella delle impostazioni
    (`~/.config/githandler`) e le variabili d'ambiente (`GITHANDLER_*`). È installato anche un
    collegamento nel menu applicazioni di Ubuntu.
-   **Perché**: il nome è stato cambiato più volte nello stesso giorno. "gitcraft" era già usato da un
    altro client Git visuale pubblicato poche settimane prima, con lo stesso scopo e gli stessi
    sistemi; il primo sostituto non conteneva la parola "git", che serve a farsi trovare da chi cerca
    un client Git, e altri candidati erano già in uso. "GitHandler" unisce il prefisso `git` a
    _handler_, chi maneggia il repository, ed è stato verificato libero su GitHub e npm prima di
    adottarlo: due programmi con lo stesso nome confondono chi cerca, i motori di ricerca e i
    pacchetti.
-   **Come**: sostituzione completa di nomi, percorsi e identificatori interni, non solo del titolo;
    test e build rieseguiti dopo il cambio. Il repository GitHub è stato rinominato e il codice
    pushato.
-   **Stato**: completato, test verdi e build riuscita.
-   **Riferimento**: commit `9cd4d86` del repository `~/Projects/githandler`.

### La copia di sicurezza dei file non tracciati ora vive dentro Git

-   **Cosa**: quando si scarta un file che Git non ha mai tracciato, l'app prima ne salva il
    contenuto negli archivi interni di Git (gli stessi oggetti compressi che usa per i commit), sotto
    un nome riservato all'app. Il pulsante **Annulla** lo riporta com'era: cartelle, link, file
    eseguibili e contenuti binari compresi. Le copie non compaiono nella storia del progetto e non
    vengono mai inviate al server remoto.
-   **Perché**: la versione precedente copiava le cartelle in una sottocartella del repository. Si
    poteva fare di meglio: gli oggetti Git sono compressi (due copie identiche costano una volta
    sola), non si corrompono e si possono ispezionare con i comandi Git normali. Ed era l'unico
    punto dell'app in cui un clic poteva distruggere lavoro in modo definitivo.
-   **Come**: ci sono tre limiti regolabili nelle impostazioni — 25 MB e 2.000 file per singola
    operazione, e **5 GB in totale**. Oltre i limiti per operazione lo scarto si ferma e spiega cosa
    fare; quando lo spazio totale è pieno si eliminano per prime le copie più vecchie, mai quella
    appena creata. Nelle impostazioni si vede anche quanto spazio stanno occupando le copie.
-   **Casi difficili coperti**: un progetto dentro un altro progetto viene salvato per intero,
    compresa la sua cartella Git; un file che Git non accetterebbe viene riconosciuto e lo scarto si
    blocca invece di salvare una copia incompleta; se un file con lo stesso nome è stato ricreato nel
    frattempo, il ripristino non lo sovrascrive; se il repository non ha ancora commit, la copia
    funziona lo stesso.
-   **Stato**: completato, 97 test automatici verdi e build riuscita.
-   **Riferimento**: commit v0.5.0.

### I file non tracciati scartati si possono recuperare

-   **Cosa**: scartando un file che Git non aveva mai tracciato, l'app ne conserva prima una copia
    dentro il repository (`.git/githandler/trash/`) e poi lo cancella. Il pulsante **Annulla** lo
    riporta com'era, cartelle comprese. La copia si spegne dalle impostazioni.
-   **Perché**: era l'unico punto in cui un clic poteva distruggere lavoro in modo definitivo: Git
    non può annullare la cancellazione di un file che non ha mai tracciato. Chi usa l'app per pulire
    una cartella di prove si trovava senza rete.
-   **Come**: la copia vale fino a 25 MB e 2.000 file per operazione; oltre il limite lo scarto si
    ferma e lo dice, invece di cancellare senza copia. Se nel frattempo è stato ricreato un file con
    lo stesso nome, il ripristino non lo sovrascrive: si ferma e chiede di spostarlo. Le copie
    vecchie vengono eliminate quando la voce esce dalla cronologia delle operazioni annullabili.
-   **Stato**: completato e provato su file, cartelle annidate, oltre-limite e conflitto.
-   **Riferimento**: commit v0.4.0.

### Un interruttore per l'API dell'AI

-   **Cosa**: nelle impostazioni c'è una sezione _API per l'AI_ con quattro scelte: spenta (default),
    solo lettura, tutte, oppure selettiva con la lista dei singoli comandi. Il server per gli agenti
    espone soltanto ciò che è stato consentito: se è spento non mostra nessun comando, e una richiesta
    per un comando non abilitato viene rifiutata.
-   **Perché**: prima il server esponeva sempre i cinque comandi di lettura. Chi collega un agente
    deve poter decidere cosa vede, e il default deve essere "niente" finché non lo si abilita.
-   **Come**: le impostazioni vivono in un file di configurazione dell'utente
    (`~/.config/githandler/settings.json`) condiviso da interfaccia e server; il server lo rilegge a
    ogni richiesta, quindi togliere un permesso ha effetto subito, senza riavviare nulla. Un file
    mancante o rovinato vale come "spenta". Il file è scritto in modo atomico e leggibile solo dal
    proprietario.
-   **Stato**: completato, provato con test automatici e con il server su stdio.
-   **Riferimento**: commit v0.4.0.

### Blame nell'app e storia a pagine

-   **Cosa**: nuova scheda **Blame** nel pannello in basso: per ogni riga del file si vede chi l'ha
    scritta, in quale commit e con quale messaggio; le righe non ancora committate sono marcate. La
    storia ora si carica a pagine da 2.000 commit e continua da sola quando si scorre in fondo.
-   **Perché**: il blame si poteva già leggere dall'API ma non dall'app, ed era l'ultima voce di
    parità con i client grafici più diffusi. La paginazione evita di costruire in memoria l'intera
    storia di repository molto grandi.
-   **Come**: la lista del blame disegna solo le righe visibili, come già la storia; il colore sul
    lato identifica il commit. La paginazione usa `git log --skip`, non tiene duplicati e riparte
    dalla prima pagina a ogni aggiornamento.
-   **Stato**: completato, verificato a schermo e con test.
-   **Riferimento**: commit v0.4.0.

### Si può annullare l'ultima operazione

-   **Cosa**: aggiunto "Annulla" (pulsante in alto e `Ctrl+Z`). Prima di un commit, di un cambio di
    ramo o di uno scarto l'app salva lo stato precedente; il comando riporta indietro: il commit
    sparisce ma le modifiche tornano in attesa di essere committate, il cambio di ramo torna al ramo
    di prima, i file scartati tornano con il contenuto che avevano.
-   **Perché**: era il punto in cui un client grafico può fare danni veri con un clic. I client
    concorrenti non hanno questa funzione, o la riservano al piano a pagamento.
-   **Cosa resta da sapere**: i file che Git non traccia, se scartati, venivano cancellati
    definitivamente: la finestra di conferma lo dice. (Dalla v0.4 non è più così: prima della
    cancellazione l'app ne conserva una copia e `Annulla` li ripristina — vedi la voce più in alto.) Lo stato salvato vive dentro il repository
    (`.git/githandler/` e i riferimenti `refs/githandler/snapshots/`), non in un database dell'app.
-   **Stato**: completato, provato su repository veri (commit, scarto e cambio ramo annullati).
-   **Riferimento**: commit successivo a `7cda117`.

### Il repository si aggiorna da solo

-   **Cosa**: con `--watch` (o la variabile `GITHANDLER_WATCH=1`) l'app sorveglia la cartella e rilegge
    lo stato quando qualcosa cambia: un salvataggio dell'editor, un commit fatto da terminale, un
    cambio di ramo esterno. Un chip **Live** in alto dice che la sorveglianza è attiva; un avviso
    compare solo quando cambia l'ultimo commit, non a ogni salvataggio.
-   **Perché**: senza, chi lavora metà in terminale e metà nell'app preme "Aggiorna" di continuo o
    guarda dati vecchi. È la prima voce della milestone sulla scala.
-   **Come**: sorveglianza ricorsiva con attesa di 400 ms per raggruppare gli eventi, esclusi i file
    interni di Git che cambiano a ogni operazione e le cartelle di dipendenze; un solo aggiornamento
    alla volta, gli altri si accodano.
-   **Stato**: completato, spento di default; `--no-watch` lo disattiva quando è attivo per ambiente.
-   **Riferimento**: commit successivo a `7cda117`.

### Ricerca nella storia

-   **Cosa**: barra sopra la storia: si scrive un testo e si vedono solo i commit che lo contengono,
    oppure si filtra per autore (`author:`) o per file (`file:`). Il conteggio è accanto al campo,
    `Esc` toglie il filtro.
-   **Perché**: trovare "quando è cambiata quella riga" senza passare dal terminale era la lacuna più
    fastidiosa per chi lavora da terminale.
-   **Come**: il testo è cercato alla lettera (parentesi e punti non diventano espressioni
    regolari); il linguaggio della ricerca sta nel nucleo, quindi lo usano sia l'interfaccia sia l'API.
-   **Stato**: completato, verificato a schermo e con test.
-   **Riferimento**: commit successivo a `7cda117`.

### Un'API per l'AI: il repository in sola lettura

-   **Cosa**: aggiunto un server MCP (`npm run mcp`, file `dist/mcp/index.js`) che un agente AI può
    collegare per leggere il repository: stato e modifiche, ricerca nella storia, dettaglio di un
    commit con il diff, diff del working tree, attribuzione riga per riga (blame). Cinque comandi,
    tutti in sola lettura.
-   **Perché**: un agente che deve capire "cosa è cambiato e perché" oggi apre file e indovina; così
    legge gli stessi dati che mostra l'app, con lo stesso motore. Nessun comando che scrive, per
    scelta: commit e scarti restano azioni dell'utente.
-   **Come**: niente dipendenze aggiunte (protocollo e trasporto scritti a mano, un messaggio JSON
    per riga), riuso del backend dell'app, nessuna shell. Configurazione per OpenCode e Claude in
    `docs/mcp.md`.
-   **Stato**: completato, provato su stdio e con test automatici.
-   **Riferimento**: commit successivo a `7cda117`.

### L'architettura scritta una volta, per riusarla negli altri progetti

-   **Cosa**: aggiunto `docs/architettura.md`, il documento che descrive l'impianto del programma e
    le regole che lo tengono in piedi: interfaccia separata dal resto (non ha permessi sul computer),
    nucleo di calcolo isolato (si può provare senza avviare l'applicazione) e un solo punto che parla
    con il sistema operativo dietro un'interfaccia sostituibile. C'è anche la parte che serviva per
    una futura sostituzione del motore di lettura di Git, e la spiegazione dei tre costi diversi che
    di solito vengono chiamati "pesantezza" di Electron.
-   **Perché**: la scelta funziona e va replicata in altri programmi simili (editor, pannelli di
    controllo, client di database) senza ripartire da zero ogni volta. Il documento è scritto per
    essere copiato in un nuovo progetto e adattato nella sola parte che parla del dominio.
-   **Cosa contiene**: le regole (niente comandi costruiti concatenando testo, una sola fonte di
    verità sullo stato del repository, dati scambiati in piccole porzioni), i numeri misurati, le
    trappole note di Electron su Linux (accelerazione grafica, blocco di sicurezza di Ubuntu), i
    criteri per dichiarare finito un lavoro e la lista di controllo per un nuovo progetto.
-   **Stato**: completato, solo documentazione: nessun cambio al programma.
-   **Riferimento**: commit successivo a `a67fd6e`.

### Misura del backend: TS non è il collo di bottiglia

-   **Cosa**: aggiunto un benchmark (`npm run bench`) che crea un repository di prova e misura i
    tempi veri: lettura della storia, parsing, disegno del grafo, stato su 100.000 file. I risultati
    sono scritti in `docs/backend-performance.md`, con le soglie oltre le quali conviene cambiare
    architettura.
-   **Perché**: era in discussione se spostare il core in un linguaggio nativo (Zig o Rust con
    libgit2). La decisione va presa sui numeri: 5.000 commit costano 35 ms di `git log` e 11 ms di
    parsing; 100.000 file di `git status` costano 82 ms. Il linguaggio del client non è il problema.
-   **Cosa resta da sapere**: libgit2 non esegue hook né i filtri esterni (Git LFS), non gestisce lo
    sparse checkout e richiederebbe di reimplementare i credential helper: usarlo al posto della
    CLI creerebbe due verità sullo stesso repository. Va eventualmente usato solo per letture calde,
    con un test di parità contro `git`.
-   **Stato**: documentato, nessun cambio di architettura.
-   **Riferimento**: commit successivo a `874c818`.

### Diff affiancato, con le modifiche evidenziate dentro la riga

-   **Cosa**: si può leggere il diff in due modi: a colonna singola (come `git diff`) oppure con il
    file prima e dopo affiancati, riga contro riga. Le porzioni che cambiano vengono evidenziate
    dentro la riga; la scelta del formato resta memorizzata.
-   **Perché**: è la vista che rende leggibile una modifica vera, dove la riga cambia di poco. È il
    metro di qualità del progetto.
-   **Come**: un modulo puro accoppia le righe rimosse con quelle aggiunte e calcola la parte
    cambiata; il disegno usa una griglia che tiene allineate le due colonne anche con righe lunghe.
-   **Verifica**: 42 test automatici superati; provato dall'interfaccia su un repository di prova con
    modifiche ravvicinate, una sola riga cambiata, una riga aggiunta in mezzo.

### Staging parziale: si sceglie cosa mettere nel commit

-   **Cosa**: aggiunta la possibilità di mettere in stage solo una parte delle modifiche a un file:
    un singolo blocco (hunk) con un pulsante, oppure righe precise cliccando i numeri di riga. Il
    comando inverso toglie dallo stage solo la parte scelta.
-   **Perché**: è la funzione che distingue un client usabile da uno elementare. Serve a separare in
    due commit modifiche mescolate nello stesso file, senza tornare al terminale.
-   **Come**: la patch parziale viene costruita da un modulo puro e testato, poi applicata con
    `git apply --cached` (o `--reverse`), quindi passano comunque dagli stessi hook e filtri di Git.
    Una patch che provasse a toccare un file diverso da quello selezionato viene rifiutata.
-   **Verifica**: 37 test automatici superati (7 nuovi sul costruttore di patch, 2 di integrazione
    sul contenuto esatto dell'indice). Provato anche dall'interfaccia su un repository di prova:
    scelta una riga, lo stage contiene solo quella, il resto resta fra le modifiche.
-   **Stato**: funzionante in locale, non distribuito.
-   **Riferimento**: commit successivo a `da3b20b`.

### Primo nucleo funzionante del client Git (v0.1)

-   **Cosa**: creato il progetto `githandler` e scritta la prima versione che funziona davvero: si apre
    un repository, si vede la storia con il grafo dei rami, si leggono i diff, si mettono i file in
    stage, si crea un commit, si cambia ramo.
-   **Perché**: serve un client Git desktop per Linux curato come i migliori client commerciali, che
    su Linux non esiste. Prima di scrivere una riga è stata verificata la concorrenza: i client
    gratuiti coprono già le funzioni principali. Quello che manca non è la funzione, è la rifinitura:
    da qui il progetto.
-   **Decisione tecnica**: Electron + TypeScript, con il backend affidato al binario `git` di sistema.
    Scartate le alternative "tutto Rust" e "core in Go": aggiungono linguaggi e confini di processo
    senza risolvere il problema vero, che è la resa del testo.
-   **Come è fatto**: il codice che legge git (parsing di `log`, `status`, diff, calcolo delle corsie
    del grafo) è separato dall'interfaccia ed è coperto da test; il resto è una UI senza framework,
    con liste che disegnano solo le righe visibili.
-   **Verifica**: 28 test automatici superati, di cui 9 su un repository git reale creato al momento
    (rename, file non tracciati, commit con messaggio multilinea, scarto delle modifiche, percorsi con
    spazi). Interfaccia provata su `AI_Knowledge` (184 commit) e sul repository stesso.
-   **Stato**: funzionante in locale, non distribuito. Manca il pacchetto installabile.
-   **Riferimento**: commit `548ac3a` del repository `~/Projects/githandler`.
