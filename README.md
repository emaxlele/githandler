# gitlattice

Client Git desktop **Linux-first**, in TypeScript su Electron. Apre un repository vero, mostra la
storia con il grafo, mostra i diff e copre il flusso quotidiano: stage (anche parziale), unstage,
scarto, commit, checkout, undo. Lo stesso repository è leggibile da un agente AI tramite un server
MCP, spento di default e abilitabile comando per comando.

Il nome viene dal **lattice**, il reticolo di corsie che il grafo dei commit disegna sullo schermo —
la firma visiva dell'app — col prefisso `git` davanti, perché è così che si cerca un client Git. Il
progetto si è chiamato `gitcraft` e, per poche ore dell'8 novembre 2026, `lanecraft`: il primo nome
era già usato da un altro client Git visuale, il secondo perdeva la parola `git`.

Non è un fork di altri client: è una reimplementazione indipendente, clean-room. Nessun codice, stringa,
icona o asset preso da prodotti esistenti.

## Stato (v0.5)

| Funzione                                           | Stato          |
| -------------------------------------------------- | -------------- |
| Apertura repository                                | ✅             |
| Storia con grafo a corsie, paginata (2.000/pagina) | ✅             |
| Rami, remoti, tag con ahead/behind                 | ✅             |
| Staging per file, unstage, scarto                  | ✅             |
| **Staging parziale per hunk e per riga**           | ✅             |
| Diff unified e **affiancato** con intra-riga       | ✅             |
| Commit (anche `-a`), checkout, nuovo ramo          | ✅             |
| Fetch                                              | ✅             |
| **Undo generale** (commit, checkout, scarto)       | ✅             |
| **File non tracciati recuperabili** (oggetti Git)  | ✅             |
| **Ricerca nella storia** (`author:`, `file:`)      | ✅             |
| **Aggiornamento automatico** (`--watch`)           | ✅             |
| **Blame nella UI** (pannello virtualizzato)        | ✅             |
| **Server MCP con permessi configurabili**          | ✅             |
| Syntax highlighting (CodeMirror 6)                 | ⏳ milestone 2 |
| `.deb` con profilo AppArmor, rebase, stash         | ⏳ milestone 4 |

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

Flag di avvio: `--repo <path>`, `--watch` (sorveglianza del repository, o `GITLATTICE_WATCH=1`),
`--no-watch` per spegnerla quando è attiva per ambiente.

## API per l'AI

`dist/mcp/index.js` è un server MCP su stdio che può esporre `repo_status`, `history`,
`show_commit`, `worktree_diff` e `blame`. Nessun tool scrive: legge con lo stesso backend della UI.

**I permessi si decidono nell'app**, non nel file di configurazione del client: _Impostazioni → API
per l'AI_. Il default è **spento**; si può abilitare tutto, solo la lettura, o scegliere i singoli
comandi. Il server rilegge la policy a ogni richiesta, quindi un client già collegato smette di
vedere i tool appena li si toglie. La policy vive in
`$XDG_CONFIG_HOME/gitlattice/settings.json` (override con `GITLATTICE_CONFIG_DIR`) ed è la stessa per
UI e MCP. Configurazione per OpenCode, Claude e limiti in [`docs/mcp.md`](docs/mcp.md).

## File non tracciati scartati

Git non può annullare la cancellazione di un file che non ha mai tracciato. Prima di cancellarlo
l'app ne scrive i byte come **oggetti Git**: un blob per file, un albero e un commit raggiungibile da
`refs/gitlattice/trash/<scope>/<id>`. `Annulla` li ripristina come gli altri, compresi cartelle
annidate, link simbolici, permesso eseguibile e contenuto binario.

-   La copia è attiva di default e si spegne dalle impostazioni.
-   Limiti modificabili: **25 MB e 2.000 file per operazione**, **5 GB in totale**. Oltre il limite
    di una singola operazione lo scarto si ferma e lo dice; quando lo spazio totale è pieno si
    eliminano per prime le copie più vecchie, mai quella appena creata.
-   I ref stanno in un namespace separato (`refs/gitlattice/*`): non compaiono nella storia, non
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
    il rendering software è invisibile, quindi è il default; `GITLATTICE_GPU=1` riattiva
    l'accelerazione.
-   **Screenshot senza display**: `npm run shots -- --repo .` (guida la UI e salva i PNG).

## Licenza

MIT — vedi `LICENSE`.
