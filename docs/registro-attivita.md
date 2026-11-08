# Registro attività — gitcraft

> Una sezione per giorno, la più recente in alto. Ogni voce dice cosa è stato fatto e perché, in
> parole semplici. Ultimo aggiornamento: 2026-11-08

## 2026-11-08

### Si può annullare l'ultima operazione

-   **Cosa**: aggiunto "Annulla" (pulsante in alto e `Ctrl+Z`). Prima di un commit, di un cambio di
    ramo o di uno scarto l'app salva lo stato precedente; il comando riporta indietro: il commit
    sparisce ma le modifiche tornano in attesa di essere committate, il cambio di ramo torna al ramo
    di prima, i file scartati tornano con il contenuto che avevano.
-   **Perché**: era il punto in cui un client grafico può fare danni veri con un clic. il client concorrente non ha
    questa funzione, un client a pagamento la riserva al piano a pagamento.
-   **Cosa resta da sapere**: i file che Git non traccia, se scartati, vengono cancellati
    definitivamente: la finestra di conferma lo dice. Lo stato salvato vive dentro il repository
    (`.git/gitcraft/` e i riferimenti `refs/gitcraft/snapshots/`), non in un database dell'app.
-   **Stato**: completato, provato su repository veri (commit, scarto e cambio ramo annullati).
-   **Riferimento**: commit successivo a `7cda117`.

### Il repository si aggiorna da solo

-   **Cosa**: con `--watch` (o la variabile `GITCRAFT_WATCH=1`) l'app sorveglia la cartella e rilegge
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
    punto su cui il progetto si misura con i client affermati.
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

-   **Cosa**: creato il progetto `gitcraft` e scritta la prima versione che funziona davvero: si apre
    un repository, si vede la storia con il grafo dei rami, si leggono i diff, si mettono i file in
    stage, si crea un commit, si cambia ramo.
-   **Perché**: serve un client Git desktop per Linux con la pulizia dei migliori client commerciali, che su Linux non esiste.
    Prima di scrivere una riga è stata verificata la concorrenza: un client open source (gratuito, MIT) e un client commerciale
    (gratuito per uso personale da ottobre 2026) coprono già le funzioni. Quello che manca non è la
    funzione, è la rifinitura: da qui il progetto.
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
-   **Riferimento**: commit `548ac3a` del repository `~/Projects/gitcraft`.
