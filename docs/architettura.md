# Architettura: UI web, core separato, backend sostituibile

> Documento di riferimento di `githandler`, scritto per essere **riusato** in altri progetti desktop
> (client Git, editor, pannelli di controllo, IDE). Le stesse scelte valgono per qualsiasi app in cui
> la UI è testo/forme e il lavoro vero sta nel leggere dati e comandarli.
> Ultimo aggiornamento: 2026-11-08

## 1. L'idea in una frase

**Un renderer web impacchettato e identico ovunque, un core puro senza dipendenze dal framework, e un
solo punto che tocca il sistema operativo dietro un'interfaccia sostituibile.**

Il valore non è Electron: è il **confine**. Electron è solo l'implementazione del livello superiore
che oggi conviene; il livello sotto può diventare un'altra cosa senza riscrivere l'app.

```
┌───────────────────────────── renderer (Chromium) ─────────────────────────────┐
│  UI in TypeScript, DOM puro o framework leggero.                             │
│  Nessuna API di sistema, nessun filesystem, nessuna shell.                   │
│  Disegna solo ciò che è visibile (liste virtualizzate).                      │
└──────────────────────────────────────┬───────────────────────────────────────┘
                                       │  preload: contratto tipizzato
                                       │  (funzioni, non stringhe di canale sparse)
┌──────────────────────────────────────▼───────────────────────────────────────┐
│  main process                                                                │
│                                                                              │
│    Api  ──────────────►  Backend (interfaccia)                               │
│                              │                                               │
│                              ├── CliBackend      oggi: il binario `git`      │
│                              ├── Libgit2Backend  dopo misura: `koffi`        │
│                              └── MockBackend     test della UI senza git     │
└──────────────────────────────────────┬───────────────────────────────────────┘
                                       │
                                 src/core (puro)
                    parsing · geometria · diff · patch · regole
```

Tre proprietà che rendono l'architettura solida:

1.  **Il core non conosce né il framework né il sistema operativo.** Importa solo i propri tipi.
    Si testa con `node --test`, si può compilare in WASM, si può riscrivere in un altro linguaggio
    dietro le stesse funzioni.
2.  **Un solo strato tocca il disco.** Sostituire CLI con libreria nativa è un cambio di
    implementazione, non un refactor dell'app.
3.  **Il renderer non ha privilegi.** Se un bug di UI o una dipendenza compromessa prendono il
    renderer, non hanno accesso al filesystem: vedono solo le funzioni esposte dal preload.

## 2. Le regole operative

Sono le regole che hanno retto finora; ognuna nasce da un errore concreto o da un costo misurato.

### 2.1 Il core è puro e testabile

-   Nessun import di `electron`, `node:fs`, `node:child_process` dentro `src/core`.
-   Funzioni che prendono **stringhe e tipi** e restituiscono **strutture**: `parseLog(raw)`,
    `parseStatus(raw)`, `layoutGraph(commits)`, `buildPatch(file, selection, mode)`.
-   Test con input reali (output veri di Git, non inventati) e casi limite: record troncati, path con
    spazi, rename, conflitti, file senza newline finale.

Perché: è il livello dove i bug sono silenziosi. Un parser che "aggiusta" un input malformato produce
dati falsi e nessuno se ne accorge finché l'utente non perde un commit.

### 2.2 Un solo punto tocca il sistema

`GitBackend` dichiara le operazioni; `CliGitBackend` le implementa. Nessun altro file apre file o
esegue processi. Quando arriverà `Libgit2Backend`, il resto dell'app non cambierà di una riga.

### 2.3 Mai una shell

`execFile("git", [ ...argomenti ])`, mai `exec("git " + stringa)`, mai un template con il path
dell'utente. Un path con spazi, apici, `$` o newline non deve poter diventare un comando. Vale anche
per i path che arrivano dalla UI: vanno validati (`assertSafePath`) prima di essere passati.

**Il terminale è l'eccezione, dichiarata.** La scheda *Terminale* esegue `bash -lc <comando>` nella
cartella del repository attivo: è una shell, non un comando Git strutturato, e il testo lo scrive
l'utente. Restano le altre regole: nessun argomento di Git passa mai da una shell, l'ambiente del
terminale fissa `GIT_TERMINAL_PROMPT=0` (un comando che chiede credenziali fallisce invece di restare
appeso), l'output arriva a pezzi e c'è un pulsante per interrompere. Niente stdin interattivo: per un
editor o un `git rebase -i` serve un terminale vero, e l'app lo dice invece di fingere.

### 2.4 Mutazioni e letture non hanno lo stesso backend obbligatorio

| Cosa                                   | Chi lo fa, oggi             | Perché                                                                                 |
| -------------------------------------- | --------------------------- | -------------------------------------------------------------------------------------- |
| Letture (log, ref, diff, alberi)       | backend, sostituibile       | sono dati: una libreria nativa può leggerli meglio                                     |
| Mutazioni (add, commit, switch, fetch) | **sempre `git` CLI**        | hook, Git LFS, credential helper, `core.autocrlf`, filtri: nessuna libreria li replica |
| Stato del working tree                 | `git status --porcelain=v2` | deve coincidere con ciò che farà il commit: una sola verità                            |

Questa asimmetria è il punto che protegge dal bug peggiore possibile per un client Git: **due verità
sullo stesso repository**. Se un giorno lo stato verrà calcolato da libgit2, serve un test di parità
contro `git` su un repository con hook, attributi, LFS e submodule.

### 2.5 Il contratto è tipizzato e chiuso

-   Un'interfaccia (`GitApi`) fra renderer e main, un'unione di canali, funzioni con parametri
    tipizzati. Zero `any`, zero stringhe di canale sparse nel codice.
-   Il renderer non riceve mai un oggetto del main "per caso": riceve il modello (`Snapshot`,
    `DiffFile`, …) definito in `src/core/types.ts`.
-   Gli errori attraversano il confine come messaggi leggibili, non come stack trace: il main li
    ripulisce (`cleanError`) e la UI li mostra in un toast, senza far finta che sia andato tutto bene.

### 2.6 Il payload è il costo, quindi si tiene piccolo

Il renderer non deve ricevere "tutto": riceve ciò che sta per disegnare.

-   Storia paginata (es. 5.000 commit), non l'intero repository.
-   Elenco dei file di un commit, poi **solo** il diff del file selezionato: due chiamate, non una
    gigante.
-   Il diff si ricostruisce lato renderer quando serve (lo stage parziale usa il diff già in memoria),
    senza richiederlo di nuovo a Git.

### 2.7 Lista virtualizzata dal primo giorno

Nel DOM esistono solo le righe visibili (`virtualization`): il costo di disegno non cresce con la
storia. Nel grafo, l'SVG è ridisegnato sulla finestra visibile. Un framework non serve, e ogni
astrazione in più è un costo che si paga su ogni riga.

### 2.8 Le preferenze stanno dove non servono permessi

Il formato del diff, il tema, la larghezza dei pannelli: `localStorage` nel renderer. Il backend non
deve sapere nulla dell'aspetto dell'app. Se un giorno servirà sincronizzare, si aggiunge un canale.

### 2.9 Più repository, un solo root per richiesta

Aprire più repository insieme non deve introdurre la seconda verità nemmeno per sbaglio. Il main tiene
un `Map<root, GitBackend>`; il renderer ha una sessione per root; **ogni canale IPC porta il root come
primo argomento**, e il preload lo aggiunge da sé alla richiesta. Una risposta che arriva in ritardo
non può quindi finire sulla scheda sbagliata: al massimo aggiorna la sua sessione, che è nascosta.
Il watcher e il refresh automatico seguono il repository attivo, non tutti.

### 2.10 Un backend, più consumatori

La UI non è l'unico cliente possibile: una CLI, un'automazione o un server per agenti AI possono
leggere lo stesso repository. Il modo sbagliato è farli parlare direttamente con Git: si ricrea la
seconda verità che il §2.4 esiste per evitare. Il modo giusto è **importare il backend** e i parser
del core.

-   Il secondo consumatore non esegue comandi propri: chiama `GitBackend`.
-   Se non deve scrivere, non espone scritture: nessun `stage`, `commit`, `reset` nell'API.
-   Il protocollo sta in poche righe di standard library prima di aggiungere un SDK.
-   I path passano dalle stesse validazioni, gli errori tornano come dati, non come crash.

In `githandler` questo è il server MCP (`src/mcp/`): cinque comandi di sola lettura, zero dipendenze,
stesso backend della UI.

### 2.11 Più finestre, un solo stato pubblicato

Una funzione che vive in una seconda finestra (in `githandler` il pannello dei dettagli) non deve
creare una seconda verità sulla selezione: due renderer che si aggiornano a vicenda producono un
anello di messaggi che cresce a ogni clic. La regola è asimmetrica, e va scritta.

-   La finestra **principale è l'unica che pubblica**: manda `{tab, commit, file, formato}` su un canale
    di solo invio, con un debounce breve.
-   Il **main tiene l'ultima pubblicazione** e la ridiffonde a tutte le finestre. Così la finestra
    appena aperta riceve lo stato alla `did-finish-load`, senza che il renderer debba chiederlo.
-   La finestra secondaria **applica e basta**: niente pubblicazione, niente anello. Se il repository
    attivo cambia, segue quello della principale.
-   Gli eventi del repository (refresh, output del terminale) sono in **broadcast**: ogni finestra
    riceve gli stessi dati, e le mutazioni passano comunque dallo stesso backend per root.

### 2.12 I segreti non entrano nei file dell'app

Un token di accesso è la cosa più facile da far uscire per sbaglio: finisce in un file di
configurazione, in un log, in `ps` perché è un argomento, in uno screenshot. La regola che regge è una
sola: **l'app non scrive segreti**. Il resto è conseguenza.

-   Su disco stanno solo i **metadati** dell'account (provider, host, API, utente, etichetta) in un file
    `0600` scritto in modo atomico (temporaneo + `rename`).
-   Il segreto vive **in memoria**, in una mappa del main, e non attraversa il contratto: il renderer lo
    manda una volta, il main non lo restituisce mai indietro.
-   Per `git` il token arriva dall'**ambiente** con `GIT_ASKPASS` che punta a uno script **generico**
    (`askpass.sh`, `0700`) che stampa `$GITHANDLER_USER` o `$GITHANDLER_TOKEN`. Il file non contiene il
    segreto, quindi può essere ispezionato; l'ambiente del processo figlio non compare in `ps`.
-   Se l'utente ha un **credential helper**, il token viene anche consegnato con `git credential
    approve`: a quel punto lo conserva Git, nel suo archivio, con la protezione che l'utente ha scelto.
    È un'aggiunta, non un requisito: senza helper l'app funziona e lo dice.
-   Rimuovere un account **dimentica** il token, non cancella quello di Git: l'app non tocca archivi che
    non sono suoi.
-   Ogni valore che finisce in un protocollo (header HTTP, riga di `git credential`, ambiente) viene
    validato come **una sola riga stampabile**: un a capo sarebbe un'iniezione di campi.

Vale la stessa asimmetria del §2.11: chi produce il segreto non lo riceve mai indietro. Quando un
consumatore ne ha bisogno (clone, fetch, pull, push), l'host si ricava da `origin` e l'ambiente si
costruisce al momento, nel main.

**Anche quando lo produce il browser.** Nel *device flow* OAuth la finestra mostra il codice e apre la
pagina di verifica, ma il token lo riceve il main: appena arriva legge `GET /user` per il nome
dell'utente, salva l'account e manda alla finestra solo l'esito (`ok` + id dell'account). Il canale
`accounts:oauth` trasporta un id, non un segreto, e non c'è nessun punto in cui il token potrebbe
finire nel DOM, nella clipboard o in un log del renderer. L'unica cosa che l'utente copia a mano è il
**Client ID**, che è pubblico per definizione: viaggia nell'URL di autorizzazione.

### 2.12.1 Un repository non dice con quale account è stato clonato

Il remoto dà **l'host** e il namespace, non l'identità con cui è stato fatto il clone: due account
sullo stesso host sono, per Git, la stessa cosa. L'app non può indovinare, quindi rende la scelta
esplicita e la mette in una funzione pura del core (`chooseRepoAccount`), dove le regole si leggono e
si provano:

1. la scelta salvata dall'utente per quel repository (`Settings.repoAccounts`, chiave = root assoluto);
2. un account dello stesso host il cui utente è il **proprietario** del remoto, con confronto esatto
   (`emax` non deve prendere i repository di `emaxlele`);
3. l'**unico** account di quell'host;
4. il **primo** di più account — una supposizione, e la UI la dichiara (chip con bordo tratteggiato e
   titolo «primo di più account»).

Il root viaggia in `credentialEnvFor(host, root)`: la credenziale si risolve per repository, non solo
per host, altrimenti il primo account salvato vincerebbe sempre. `repoAccounts` è una preferenza, non
un segreto: sta nelle impostazioni normalizzate e la finestra la riporta intatta quando salva il resto.

### 2.12.2 L'originale di un fork e le esecuzioni non stanno nel repository

Parent di un fork e workflow run sono **dati del provider**, non oggetti Git: il repository non li ha
e `git` non li può leggere. Per questo il core costruisce gli indirizzi e legge le risposte
(`src/core/fork.ts`, `src/core/actions.ts`), il main fa le chiamate con il token dell'account risolto,
e il renderer riceve solo dati già normalizzati.

Due conseguenze di sicurezza: l'**id** di un'esecuzione deve essere numerico prima di diventare un
pezzo di percorso (`/actions/runs/<id>/rerun`), e il **commit** di un fork non viene mai forzato: il
sync è `fetch` + `merge`/`rebase`, quindi un conflitto è un'operazione annullabile come le altre. Il
remoto `upstream` si crea solo se manca: un remoto già configurato (un mirror, un fork interno) non
viene riscritto da un'euristica.

### 2.13 Un percorso che arriva dalla finestra non è un percorso fidato

La finestra non ha accesso al filesystem, ma può chiedere «apri questo file», «mostralo nella sua
cartella», «salvane una copia»: richieste che finiscono in `shell.openPath`, `readFile` e
`dialog.showSaveDialog`. Un `../../.ssh/id_rsa` sarebbe una lettura arbitraria con i permessi
dell'utente, e un percorso che inizia con `-` diventerebbe un'opzione di git.

Quindi ogni percorso relativo passa da `resolveInside` nel main: assoluto, con `..` che esce dal
repository, con byte NUL, o che inizia con `-` viene **rifiutato** — non corretto, rifiutato, con il
nome nel messaggio. Per un file di un commit il percorso viaggia dentro `git show <sha>:<path>` come
**un solo argomento**, e lo SHA è validato prima. Lo stesso principio vale per `openExternal`: solo
`http` e `https`, mai `file://` o schemi che lanciano programmi.

Il caso che rende la regola necessaria non è l'attacco: è l'errore. Un percorso costruito con un
`join` sbagliato, che sembra innocuo, aprirebbe la cartella sbagliata invece di fermarsi.

## 3. I contratti, in concreto

```ts
// src/main/backend.ts — ciò che l'app può chiedere al mondo
export interface GitBackend {
	open(dir: string): Promise<Snapshot>;
	refresh(): Promise<Snapshot>;
	commitFiles(sha: string): Promise<CommitFile[]>;
	commitPatch(sha: string, path: string): Promise<DiffFile>;
	worktreePatch(path: string, staged: boolean): Promise<DiffFile>;
	stage(paths: string[]): Promise<Snapshot>;
	applyPatch(path: string, patch: string, mode: PatchMode): Promise<Snapshot>;
	unstage(paths: string[]): Promise<Snapshot>;
	discard(paths: string[]): Promise<Snapshot>;
	commit(message: string, all: boolean): Promise<Snapshot>;
	checkout(branch: string): Promise<Snapshot>;
	checkoutCommit(sha: string): Promise<Snapshot>;
	createBranch(name: string): Promise<Snapshot>;
	fetch(): Promise<Snapshot>;
}
```

```ts
// src/shared/api.ts — ciò che il renderer può chiedere, uno a uno
export interface GitApi {
	open(path?: string): Promise<Snapshot | null>;
	refresh(): Promise<Snapshot>;
	commitFiles(sha: string): Promise<CommitFile[]>;
	commitPatch(sha: string, path: string): Promise<DiffFile>;
	worktreePatch(path: string, staged: boolean): Promise<DiffFile>;
	stage(paths: string[]): Promise<Snapshot>;
	applyPatch(path: string, patch: string, mode: PatchMode): Promise<Snapshot>;
	unstage(paths: string[]): Promise<Snapshot>;
	discard(paths: string[]): Promise<Snapshot>;
	commit(message: string, all: boolean): Promise<Snapshot>;
	checkout(branch: string): Promise<Snapshot>;
	checkoutCommit(sha: string): Promise<Snapshot>;
	createBranch(name: string): Promise<Snapshot>;
	fetch(): Promise<Snapshot>;
}
```

Le due liste si somigliano di proposito: sono lo stesso vocabolario, ma il primo vive nel main e può
crescere (metodi che il renderer non usa), il secondo è la superficie pubblica e va tenuta minima.

**Come si sostituisce il backend.** Si implementa `GitBackend` con un'altra tecnologia, si sceglie in
un punto solo quale istanziare, e si tiene il vecchio adapter come oracolo nei test: gli stessi input
sui due backend devono produrre lo stesso `Snapshot`. La UI non cambia.

## 4. Dove si paga, misurato

Il motivo per cui questa architettura regge è che il costo è **noto e localizzato**. Numeri misurati
il 2026-11-08 (Ubuntu 26.04, Node 24, git 2.53, `npm run bench`):

| Voce                                 | Costo                   | Contromisura                                        |
| ------------------------------------ | ----------------------- | --------------------------------------------------- |
| `git log` 5.000 commit               | 35 ms                   | —                                                   |
| parsing + layout in TS               | 11,5 ms                 | — (non è il problema)                               |
| `git log` 50.000 commit              | 370 ms                  | paginazione, caricamento progressivo                |
| `git status` 100.000 file            | 82 ms (cache calda)     | `fs.watch` + refresh incrementale, `core.fsmonitor` |
| payload di 50.000 commit al renderer | ~8,4 MB da serializzare | paginazione, modelli compatti                       |
| diff di un file grande               | disegno del DOM         | virtualizzazione, rendering a stringhe, poi WASM    |

**L'"overload" di Electron non è il linguaggio: sono tre costi distinti.** Vale la pena nominarli,
perché si confondono facilmente:

1.  **Payload IPC.** Ogni oggetto che attraversa `ipcRenderer.invoke` viene serializzato
    (structured clone) e ricostruito: con decine di MB il costo si vede e la memoria del renderer
    raddoppia. Si risolve **non mandando tutto**: paginazione e chiamate mirate.
2.  **Disegno del DOM.** Migliaia di nodi in una lista fanno scattare layout e paint a ogni scroll.
    Si risolve con la virtualizzazione, non con un altro linguaggio.
3.  **Blocco del main process.** Un'operazione sincrona pesante nel main ferma IPC e finestra. Si
    risolve rendendo asincrono o spostando in `worker_threads`/`utilityProcess`.

A questi si aggiungono le trappole di piattaforma del §5, che sono un'altra categoria (avvio, non
prestazioni).

**Regola**: nessuna ottimizzazione senza una riga di misura che la giustifichi. Le soglie e l'ordine
di intervento sono in [`backend-performance.md`](backend-performance.md).

## 5. Trappole verificate di Electron su Linux

Vengono da due progetti reali (`clevo-control`, `githandler`) su Ubuntu 26.04.

| Trappola                         | Sintomo                                                                                              | Rimedio                                                                                                          |
| -------------------------------- | ---------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| **Processo GPU non disponibile** | `GPU process isn't usable`, schermo nero, crash all'avvio                                            | `app.disableHardwareAcceleration()` di default per app testuali; `GITHANDLER_GPU=1` per riaccenderla dove funziona |
| **AppArmor su Ubuntu 23.10+**    | il sandbox di Chromium (`chrome-sandbox`) fallisce: `kernel.apparmor_restrict_unprivileged_userns=1` | profilo AppArmor nel `.deb`/`.rpm`; `--no-sandbox` **solo** in sviluppo (abbassa la sicurezza)                   |
| **Nessun display**               | non si può verificare la resa in CI o via SSH                                                        | modalità headless con screenshot pilotati (`--ozone-platform=headless`, `--disable-gpu`), come `npm run shots`   |
| **`sandbox: true` e preload**    | il preload non ha accesso a `require`                                                                | solo `contextBridge` + `ipcRenderer`, niente `nodeIntegration`                                                   |

Conseguenza di progetto: un'app Electron su Linux **non è "build e via"**. Il pacchetto deve includere
il profilo AppArmor e va provato su un'installazione pulita, non solo con `npm start`.

## 6. Verifica: come si sa che è solida

Quattro livelli, dal più economico al più costoso. Se un livello manca, gli altri non bastano.

1.  **Test del core** (`node --test`): parser, geometria, patch, con input reali e casi limite.
2.  **Test di integrazione contro la tecnologia vera**: repository Git temporaneo creato nel test,
    comandi eseguiti davvero, si controlla il contenuto dell'indice e non solo l'exit code.
3.  **`typecheck` e `build`** con `strict` attivo: il confine tipizzato non serve se i tipi sono larghi.
4.  **Verifica visiva senza display**: screenshot headless, e quando serve pilotare la UI
    (`executeJavaScript`) per dimostrare che un'azione ha davvero l'effetto atteso. Un'azione non è
    "fatta" finché non si è visto l'effetto, non il pulsante.

Più, quando si parla di prestazioni, un **benchmark riproducibile** (`npm run bench`): repository
generato, tempi mediani, numeri nel documento. Le decisioni di architettura si prendono su quelli.

## 7. Checklist per un nuovo progetto

Copiabile così com'è; le voci in corsivo sono le più facili da saltare e le più costose da recuperare.

1.  Renderer senza privilegi: `contextIsolation: true`, `nodeIntegration: false`, `sandbox: true`.
2.  _Un solo file che tocca il sistema_, dietro un'interfaccia.
3.  _Core puro_ in una cartella senza import del framework, con test che non avviano l'app.
4.  Contratto IPC tipizzato, un canale per operazione, nessuna stringa sparsa.
5.  Errori del backend mostrati all'utente, con il messaggio reale.
6.  Liste virtualizzate e payload paginati fin dall'inizio.
7.  _Niente shell_: `execFile` con array di argomenti; validare i path che arrivano dalla UI.
8.  Mutazioni sullo strumento che le sa fare davvero (CLI), letture sostituibili.
9.  Preferenze nel renderer (`localStorage`), non nel main.
10. Packaging che include i profili di sicurezza (AppArmor su Linux) e modalità headless per la
    verifica.
11. Benchmark e soglie scritte **prima** di discutere di ottimizzazioni.
12. Se serve un secondo consumatore (CLI, API per agenti), importa il backend esistente e resta in
    sola lettura finché non c'è un consenso esplicito.

## 8. Cosa questa architettura non risolve

Va detto, per non venderla per quello che non è:

-   **Non dà un aspetto nativo.** Un'app Electron si riconosce; se il criterio è "sembrare parte del
    sistema", servono GTK/Qt e un altro stack.
-   **Non è leggera**: ~100-150 MB di runtime e un processo Chromium. Per un'app testuale è
    accettabile, per un'utilità da 2 MB no.
-   **Non elimina il costo di avvio del processo** per ogni query: ~5-20 ms a chiamata. Per query
    ripetute e minute (blame riga per riga, storia di un file) è il punto in cui un backend
    in-process (`koffi` + libgit2) si ripaga.
-   **Non rende gratuita la sicurezza**: sandbox, preload minimale, AppArmor e path validati restano
    lavoro da fare.

## 9. Riuso

Per un altro progetto cambia solo il §3: il vocabolario del backend e i tipi del dominio. Le regole
del §2, le trappole del §5 e la checklist del §7 restano identiche — è esattamente il motivo per cui
questo documento esiste.

Esempi di traduzione:

| Progetto                            | Backend                       | Core puro                                             |
| ----------------------------------- | ----------------------------- | ----------------------------------------------------- |
| client Git                          | `git` CLI → `koffi`+libgit2   | parsing porcelain, diff, patch, layout del grafo      |
| pannello hardware (`clevo-control`) | `koffi` su `/dev/*` e `ioctl` | parsing dei valori, isteresi delle ventole, curve     |
| editor                              | filesystem + watcher          | parsing della sintassi, indici, ricerca               |
| client di database                  | driver + CLI                  | parsing dei risultati, piano di query, diff di schema |

## Riferimenti

-   [`backend-performance.md`](backend-performance.md) — misure del backend e soglie di intervento
-   [`../README.md`](../README.md) — avvio, comandi, note Linux
-   [`../src/core/`](../src/core) — le funzioni pure
-   [`../src/main/backend.ts`](../src/main/backend.ts) — il confine
