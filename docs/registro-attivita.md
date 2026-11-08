# Registro attività — gitcraft

> Una sezione per giorno, la più recente in alto. Ogni voce dice cosa è stato fatto e perché, in
> parole semplici. Ultimo aggiornamento: 2026-11-08

## 2026-11-08

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
