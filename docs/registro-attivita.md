# Registro attività — gitcraft

> Una sezione per giorno, la più recente in alto. Ogni voce dice cosa è stato fatto e perché, in
> parole semplici. Ultimo aggiornamento: 2026-11-08

## 2026-11-08

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
-   **Riferimento**: primo commit del repository `~/Projects/gitcraft`.
