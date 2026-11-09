# Registro attività — githandler

> Una sezione per giorno, la più recente in alto. Ogni voce dice cosa è stato fatto e perché, in
> parole semplici. Ultimo aggiornamento: 2026-11-09

## 2026-11-09

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
