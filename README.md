# GitHandler

Client Git desktop **Linux-first**, in TypeScript su Electron. Apre, **crea** o **clona** un
repository (da un URL o da un account GitHub / GitLab / Gitea / Bitbucket), mostra la storia con il
grafo, i diff, e copre il flusso quotidiano: stage (anche parziale), unstage, scarto, commit, checkout
di un ramo **o di un commit**, undo, pull, push, stash, merge, rebase, cherry-pick e submodule. Dal
repository si arriva **al file e alla cartella** — apri la posizione, apri il file, salva una copia,
apri repository e commit nel browser, esporta HEAD in uno zip — e il **token si prende dove c'è già**
(`gh`, credential helper) oppure **dal browser** con il device flow OAuth. Ogni repository ricorda con
quale account lavorare, i **fork** si sincronizzano con l'originale e le **GitHub Actions** si leggono,
si ri-eseguono e si annullano dall'app. Lo stesso repository è leggibile da un agente AI tramite un
server MCP, spento di default e abilitabile comando per comando.

Il nome: **`git`** davanti, perché è così che si cerca un client Git, e **handler** — chi maneggia il
repository. Il progetto si è chiamato `gitcraft` (già usato da un altro client Git visuale) e, per
poche ore dell'8 novembre 2026, `lanecraft` e `gitlattice`.

Non è un fork di altri client: è una reimplementazione indipendente, clean-room. Nessun codice, stringa,
icona o asset preso da prodotti esistenti.

## Stato (v0.10)

| Funzione                                            | Stato         |
| --------------------------------------------------- | ------------- |
| Apertura repository                                 | ✅             |
| **Creazione repository** (`git init`, identità locale) | ✅          |
| **Clone da URL e da account** (4 provider)          | ✅             |
| **Benvenuto all'avvio** (nessun dialog automatico)  | ✅             |
| **Azioni su file e cartella dal repository**        | ✅             |
| **Accesso dal browser (device flow OAuth)**         | ✅             |
| **«Accedi» con il token già presente** (`gh`, credential helper) | ✅ |
| **Account scelto per repository** (chip nell'header) | ✅             |
| **Fork: riconoscimento e sync con l'originale**      | ✅             |
| **GitHub Actions**: esecuzioni, ri-esecuzione, annulla | ✅           |
| **File del repository** (elenco filtrabile, browser) | ✅             |
| **Esporta HEAD in uno zip**                          | ✅             |
| Storia con grafo a corsie, paginata (2.000/pagina)  | ✅             |
| Rami, remoti, tag con ahead/behind                  | ✅             |
| Staging per file, unstage, scarto                   | ✅             |
| **Staging parziale per hunk e per riga**            | ✅             |
| Diff unified e **affiancato** con intra-riga        | ✅             |
| Commit (anche `-a`), checkout di ramo e commit, nuovo ramo | ✅         |
| Fetch                                               | ✅             |
| **Pull** (`--ff-only`) e **push** (mai con forza)   | ✅             |
| **Stash** (salva, applica, pop, elimina)            | ✅             |
| **Merge, rebase, cherry-pick**, annulla conflitto   | ✅             |
| **Submodule** (elenco e aggiornamento)              | ✅             |
| **Terminale integrato** (nel repository attivo)     | ✅             |
| **Più repository aperti insieme** (schede)          | ✅             |
| **Undo generale** (commit, checkout, scarto, merge) | ✅             |
| **File non tracciati recuperabili** (oggetti Git)   | ✅             |
| **Ricerca nella storia** (`author:`, `file:`)       | ✅             |
| **Aggiornamento automatico** (`--watch`)            | ✅             |
| **Blame nella UI** (pannello virtualizzato)         | ✅             |
| **Pannello ridimensionabile, a icona, in finestra** | ✅             |
| **Server MCP con permessi configurabili**           | ✅             |
| Syntax highlighting (CodeMirror 6)                  | ⏳ milestone 2 |
| `.deb` con profilo AppArmor                         | ⏳ milestone 4 |

## Interfaccia

La finestra segue la disposizione dei client Git desktop affermati, con un tema scuro proprio:

-   **Toolbar** con le azioni etichettate (Apri, Clona, Cartella, Fetch, Pull, Push, Stash, Submodule,
    Aggiorna, Annulla) e, al centro, repository e ramo corrente. Sopra la storia ci sono le schede dei repository
    aperti, con la × per chiuderle e il `+` che apre la scelta *Apri / Crea / Clona da URL / Clona da un
    account*.
-   **Benvenuto senza repository**: all'avvio la finestra non apre nessun dialog di sistema, mostra le
    quattro scelte e la cartella di base da cui partono i dialog e i cloni. Chiudendo l'ultima scheda si
    torna lì.
-   **Barra laterale**: nome del repository, *Changes* con il conteggio, *All Commits*, filtro di
    ricerca e i ref divisi in Branches / Remotes / Tags.
-   **Due viste per le modifiche**: la scheda *Changes* del pannello le mostra dentro il riquadro
    inferiore, con la storia ancora sopra; la voce *Changes* della barra laterale le porta a tutta
    area, senza storia né pannello inferiore. *All Commits* riporta la storia.
-   **Storia** in cinque colonne: grafo a corsie, messaggio con i badge dei ref, autore con avatar a
    iniziali, SHA breve, data. Clic su un ramo o tag: il cursore va al suo commit. Tasto destro su un
    ramo: checkout, merge, rebase, rinomina, elimina, copia; su un commit: ramo nuovo da quel punto,
    merge, rebase, reset soft / mixed / hard, cherry-pick, copia di SHA e messaggio.
-   **Pannello inferiore** con cinque schede: `Commit` (AUTHOR e COMMITTER separati, SHA, PARENTS,
    messaggio e file toccati), `Changes` (Staged e Unstaged divisi, diff, riquadro del commit),
    `File Tree` (albero dei file del commit o del working tree, diff a destra), `Blame` e `Terminale`.
    La maniglia sopra il pannello lo ridimensiona, `▾` lo riduce alla sola riga delle schede e `⧉` lo
    apre in una finestra separata: chiusa quella, il pannello torna al suo posto. Diff e albero
    scorrono, con la loro altezza vincolata al riquadro.

### Dal repository al file

-   **Cartella** in toolbar: apre nel gestore file la cartella del repository attivo.
-   Tasto destro sulla **scheda del repository**: apri la cartella, copia il percorso, apri il repository
    nel browser (dall'URL di `origin`), chiudi la scheda.
-   Tasto destro su un **file** (File Tree o elenco dei file di un commit) e doppio clic: apri con
    l'applicazione associata, mostra nella cartella, **salva una copia** fuori dal repository, copia il
    percorso. Da un commit la copia è la versione di allora, letta con `git show <sha>:<path>`: byte per
    byte, anche per i binari, con un tetto di 64 MiB oltre il quale l'app lo dice invece di troncare.
-   Tasto destro su un **commit**: *Apri il commit nel browser*, con l'URL del servizio (GitHub, GitLab,
    Bitbucket). Se il remoto non è un sito web il comando lo dice invece di aprire un indirizzo
    inventato.
-   I percorsi mandati dalla finestra sono verificati nel main: nessun `..`, nessun percorso assoluto,
    nessun nome che inizia con `-`.

Ogni funzione che esiste ha un comando, e ogni comando fa quello che dice: il terminale è una shell
vera nella cartella del repository, con il pulsante per interrompere il comando.

## Architettura

```
renderer (Chromium)   UI in DOM puro, zero framework, liste virtualizzate
        │  preload: contextBridge tipizzato
main (Node)           GitBackend → CliGitBackend (oggi)
        │
src/core              funzioni pure: parsing porcelain, layout del grafo, diff
```

Tre scelte che spiegano il resto:

-   **Il core è puro.** `src/core` non conosce Electron né il filesystem: si testa con `node --test`
    e, se servirà, si può estrarre in WASM dietro la stessa funzione.
-   **Le mutazioni passano dal binario `git`.** Hooks, Git LFS, credential helper, `core.autocrlf`,
    `skip-worktree`: nessuna libreria li replica davvero. `execFile` senza shell, con argomenti come
    array, quindi un path con spazi o apici non può diventare un comando.
-   **Niente ottimizzazioni premature.** Rust, WASM e `koffi`+libgit2 sono dietro un'interfaccia e
    arrivano solo se una misura supera una soglia: i numeri e le soglie stanno in
    [`docs/backend-performance.md`](docs/backend-performance.md).

Il quadro completo — regole, contratti fra i tre livelli, costi misurati e trappole Linux — è in
[`docs/architettura.md`](docs/architettura.md), scritto per essere riusato in altri progetti desktop.

## Comandi

```bash
npm install
npm start                              # build + avvio
npm start -- --repo ~/Projects/AI_Knowledge --watch   # rilegge il repo quando cambia

npm test                  # parser, grafo e integrazione con git vero
npm run typecheck
npm run build             # dist/main, dist/preload, dist/renderer, dist/mcp
npm run dev               # rebuild continuo dei bundle
npm run bench             # misure del backend (log, parsing, grafo, status)
npm run mcp -- --repo .   # server MCP su stdio, sola lettura (vedi docs/mcp.md)
```

Flag di avvio: `--repo <path>`, `--watch` (sorveglianza del repository, o `GITHANDLER_WATCH=1`),
`--no-watch` per spegnerla quando è attiva per ambiente.

## Installazione locale (Ubuntu)

Il pacchetto `.deb` con profilo AppArmor è in milestone 4; nel frattempo l'app si installa nel
profilo utente, senza sudo:

```bash
./build/install-local.sh
```

Lo script compila i bundle e scrive launcher, voce nel menu e icona:

| Cosa          | Dove                                                        |
| ------------- | ----------------------------------------------------------- |
| Launcher      | `~/.local/bin/githandler`                                   |
| Voce nel menu | `~/.local/share/applications/githandler.desktop`            |
| Icona         | `~/.local/share/icons/hicolor/scalable/apps/githandler.svg` |

Il launcher ricompila con esbuild a ogni avvio, così il menu apre sempre il codice corrente:
`githandler --repo ~/Projects/AI_Knowledge`. Per AppArmor su Ubuntu il sandbox di Chromium resta
spento (`--no-sandbox`).

## API per l'AI

`dist/mcp/index.js` è un server MCP su stdio che può esporre `repo_status`, `history`,
`show_commit`, `worktree_diff` e `blame`. Nessun tool scrive: legge con lo stesso backend della UI.

**I permessi si decidono nell'app**, non nel file di configurazione del client: _Impostazioni → API
per l'AI_. Il default è **spento**; si può abilitare tutto, solo la lettura, o scegliere i singoli
comandi. Il server rilegge la policy a ogni richiesta, quindi un client già collegato smette di
vedere i tool appena li si toglie. La policy vive in
`$XDG_CONFIG_HOME/githandler/settings.json` (override con `GITHANDLER_CONFIG_DIR`) ed è la stessa per
UI e MCP. Configurazione per OpenCode, Claude e limiti in [`docs/mcp.md`](docs/mcp.md).

## Account collegati e credenziali

GitHub, GitLab, Gitea/Forgejo e Bitbucket. L'account serve a **elencare i repository** dell'utente e a
**clonare** anche quelli privati; per Gitea/Forgejo e per le installazioni proprie si cambiano host e
indirizzo dell'API.

-   In `$XDG_CONFIG_HOME/githandler/accounts.json` (permessi `0600`) stanno **solo i metadati**:
    provider, host, API, utente, etichetta e, se lo usi, il Client ID OAuth (pubblico per definizione).
-   Il **token non lo scrive l'app**: resta in memoria per la sessione e arriva a `git` tramite
    `GIT_ASKPASS` (script generico in `~/.config/githandler/askpass.sh`, `0700`, che legge utente e
    token dall'ambiente del processo figlio). Se hai un credential helper configurato, il token viene
    anche consegnato con `git credential approve`: lo conserva Git, nel suo archivio, non GitHandler.
-   Le credenziali valgono per clone, fetch, pull e push: l'host si ricava da `origin`.
-   Il token si **cambia** dall'account in qualsiasi momento; un rifiuto dell'API diventa un messaggio
    che dice di aggiornarlo. Rimuovere l'account lo dimentica, ma non cancella quello che ha salvato Git.
-   Senza credential helper il token vale per la sessione: alla riapertura va reinserito, e
    l'interfaccia lo dice invece di far scoprire il problema al primo fetch.

### Il token: prima dove c'è già, poi dal browser

-   **Accedi** è un clic: l'app cerca un token già presente sulla macchina — `gh auth token --hostname
    <host>` (GitHub CLI), poi il credential helper di Git (`git credential fill`) — lo verifica con
    `GET /user` e salva l'account. Nessun Client ID da incollare.
-   Se un token non c'è, resta **Accedi con il browser**: il *device flow* OAuth di GitHub e GitLab
    (anche installazioni proprie). Il device flow **richiede un Client ID registrato** — non esiste un
    flusso anonimo — e l'app lo mostra per quello che è: un dato pubblico, salvato accanto agli altri
    dati dell'account. Il pulsante *Crea…* apre la pagina dove registrarlo; per GitHub il device flow va
    abilitato su quell'applicazione.
-   In entrambi i casi il token lo riceve il main, che legge il nome dell'utente e salva l'account; alla
    finestra tornano solo l'esito e l'id dell'account.
-   Per Gitea e Bitbucket, che non hanno il device flow, resta **Crea un token nel browser…**: apre la
    pagina dei token del provider, con gli scope già indicati dove il provider li accetta.

### Con quale account lavora un repository

Il remoto dice l'host, non l'account con cui è stato clonato. Le regole, dalla più forte alla più
debole: la **scelta salvata** per quel repository; un account dello stesso host il cui utente è il
**proprietario** del remoto; l'**unico** account dell'host; il **primo** di più account. L'ultimo caso
è una supposizione e il **chip nell'header** lo dichiara: clic per scegliere un altro account o togliere
la scelta. Fetch, pull, push e clone usano quell'account.

La **cartella di base** (Impostazioni) è il punto di partenza di «Apri», «Crea» e «Clona» e la
destinazione predefinita dei cloni; non è un limite, dalla finestra di scelta si naviga ovunque.

## Fork e GitHub Actions

Dal menu del tasto destro sulla scheda del repository:

-   **Sincronizza con l'originale (merge/rebase)**: l'app chiede al provider qual è il repository
    originale, crea il remoto `upstream` la prima volta, poi `fetch` e `merge`/`rebase` del ramo
    predefinito. Niente forza: un conflitto resta annullabile. Con HEAD staccato il sync si ferma e lo
    dice.
-   **GitHub Actions…**: ultime esecuzioni con workflow, stato, ramo ed evento; *Ri-esegui* (i job
    falliti di un'esecuzione conclusa), *Annulla* (una in corso), *Apri* nel browser. Solo GitHub.
-   **Apri un file del repository…**: elenco filtrabile dei file tracciati in HEAD, apertura dal sistema
    o nel browser (Gitea compreso).
-   **Esporta HEAD in un archivio zip…**: `git archive`, quindi `export-ignore` e i filtri del
    repository valgono; non-tracciati e modifiche non committate restano fuori.

## File non tracciati scartati

Git non può annullare la cancellazione di un file che non ha mai tracciato. Prima di cancellarlo
l'app ne scrive i byte come **oggetti Git**: un blob per file, un albero e un commit raggiungibile da
`refs/githandler/trash/<scope>/<id>`. `Annulla` li ripristina come gli altri, compresi cartelle
annidate, link simbolici, permesso eseguibile e contenuto binario.

-   La copia è attiva di default e si spegne dalle impostazioni.
-   Limiti modificabili: **25 MB e 2.000 file per operazione**, **5 GB in totale**. Oltre il limite
    di una singola operazione lo scarto si ferma e lo dice; quando lo spazio totale è pieno si
    eliminano per prime le copie più vecchie, mai quella appena creata.
-   I ref stanno in un namespace separato (`refs/githandler/*`): non compaiono nella storia, non
    entrano in `log --all` e non vengono inviati al remoto.
-   Un sotto-repository annidato viene conservato per intero, cartella `.git` compresa.
-   Se nel frattempo è stato ricreato un file con lo stesso nome, il ripristino non sovrascrive: si
    ferma e chiede di spostarlo.
-   Gli oggetti non più raggiungibili vengono recuperati dal normale `git gc` del repository: l'app
    non forza mai una potatura che cancellerebbe anche i commit orfani dell'utente.

Nel dubbio fra perdere spazio e perdere dati, l'app sceglie lo spazio: la quota è una rete di
sicurezza, non un limite da riempire.

## Note su Linux

-   **AppArmor**: su Ubuntu 24.04+ (`kernel.apparmor_restrict_unprivileged_userns=1`) il sandbox di
    Chromium non parte. In sviluppo serve `--no-sandbox` o un profilo AppArmor nel pacchetto: è
    previsto nel lavoro di packaging (milestone 4).
-   **GPU**: il processo GPU di Chromium non è disponibile su tutte le macchine. Per un'app testuale
    il rendering software è invisibile, quindi è il default; `GITHANDLER_GPU=1` riattiva
    l'accelerazione.
-   **Screenshot senza display**: `npm run shots -- --repo .` (guida la UI e salva i PNG).

## Licenza

MIT — vedi `LICENSE`.
