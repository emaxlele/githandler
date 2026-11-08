# lanecraft — piano v0.1: slice verticale Electron + TypeScript

> Stato: in esecuzione. Creato 2026-11-08. Il piano sostituisce
> `AI_Knowledge/docs/plans/2026-11-07-lanecraft-client-git-rust.md` (Rust + egui, superato).

## 1. Obiettivo

Un client Git desktop **Linux-first** che apra un repository vero, mostri la storia con il grafo,
mostri i diff e permetta il flusso quotidiano (stage, commit, checkout), scritto in **TypeScript su
Electron**, con il backend affidato al binario `git` di sistema.

Non è una demo: ogni schermata legge dati reali da `git`, senza mock e senza dati inventati.

## 2. Decisione: nessuna base di codice esistente

Domanda posta: "quale di questi client può essere una base?". Risposta: **nessuno, per codice**.
Le ragioni sono legali e tecniche insieme:

| Progetto          | Licenza                                            | Linguaggio            | Riutilizzabile?                                                                                                            |
| ----------------- | -------------------------------------------------- | --------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| **un client open source**       | MIT                                                | C++ / Qt 6            | ✅ **legalmente sì**, ma tecnicamente no (Qt ≠ Electron). Diventa il **riferimento di comportamento** e l'oracolo dei test |
| **un client Fair Source**     | Fair Source ("non puoi costruirci un concorrente") | Rust / Tauri          | ❌ **vietato per contratto**: siamo un concorrente                                                                         |
| **un client closed source**       | closed source                                      | Rust / Tauri          | ❌ codice chiuso, solo riferimento UX                                                                                      |
| **un client commerciale**      | proprietaria                                       | Java / SWT            | ❌                                                                                                                         |
| **un altro client commerciale** | proprietaria                                       | C++ / toolkit proprio | ❌                                                                                                                         |
| **un client closed source** | proprietaria                                       | .NET / WPF            | ❌ clean-room obbligatoria, già in essere                                                                                  |

Quindi: **architettura nostra**, con componenti pubblici e documentati al posto del fork di codice.

### Cosa prendiamo, e da dove

| Pezzo                    | Fonte                                                                | Perché è lecito e sensato                                                                   |
| ------------------------ | -------------------------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| Semantica Git            | **`git` CLI** (`--porcelain=v2`)                                     | protocollo documentato e stabile; il binario è GPL ma invocarlo come processo non contamina |
| Grafo, diff, parsing     | **codice nostro** (`src/core`)                                       | funzioni pure, testabili, portabili su WASM se un giorno servirà                            |
| Editor/diff evoluto      | **CodeMirror 6** (MIT) — milestone 3                                 | sintassi, selezione, tema; evita di scrivere un editor                                      |
| Letture calde in-process | **`koffi` + libgit2** (GPLv2 + linking exception) — solo dopo misura | già provato su `clevo-control` per `ioctl`                                                  |
| Comportamento UI         | osservazione dell'uso reale           | nessuna copia di asset o stringhe                                                           |

## 3. Architettura

```
┌──────────────────────────── renderer (Chromium) ────────────────────────────┐
│  UI in TypeScript puro, DOM + virtualizzazione. Zero React, zero runtime.   │
│  Nessuna API Node, nessun accesso al filesystem.                            │
└───────────────────────────────────┬─────────────────────────────────────────┘
                                    │ preload: contextBridge, canali tipizzati
┌───────────────────────────────────▼─────────────────────────────────────────┐
│  main process (Node)                                                        │
│                                                                             │
│   GitBackend  ── interfaccia ──► CliGitBackend   (oggi)                     │
│        │                          Libgit2Backend (dopo misura, koffi)       │
│        └─ esegue `execFile("git", …)`, mai una shell → niente quoting      │
└─────────────────────────────────────────────────────────────────────────────┘
                                    │
                              src/core (puro)
                     porcelain · graph layout · diff parse
```

Perché questa forma:

-   **Il core non conosce Electron.** `src/core` importa solo tipi propri: si testa con `node --test`
    e, se un giorno il diff va accelerato, si estrà in WASM dietro la stessa funzione.
-   **Il confine è dichiarato.** `GitBackend` è l'unico punto che tocca il disco. Sostituire CLI con
    libgit2 è un cambio di implementazione, non un refactor dell'app.
-   **Le mutazioni passano dal binario `git`.** Hooks, LFS, credential helper, `core.autocrlf`,
    `skip-worktree`: nessuna libreria le replica davvero. Invocare `git` è l'unico modo di essere
    compatibili per costruzione.
-   **`execFile` senza shell.** Argomenti come array: un path con spazi, apici o `$` non può diventare
    un comando. È il bug classico dei client Git scritti in fretta.

## 4. Protocollo comandi (milestone 1)

| Operazione        | Comando                                                                      | Note                                        |
| ----------------- | ---------------------------------------------------------------------------- | ------------------------------------------- |
| Radice del repo   | `git rev-parse --show-toplevel --absolute-git-dir`                           | distingue worktree e `.git`                 |
| Storia            | `git log --all --date-order -n 5000 --pretty=format:…%x1e`                   | campi separati da `%x00`, record da `%x1e`  |
| Stato             | `git status --porcelain=v2 -z --branch --untracked-files=all`                | formato documentato, path NUL-terminati     |
| File di un commit | `git show --name-status --format= -z <sha>`                                  | `--first-parent` implicitamente per i merge |
| Diff di un file   | `git diff <parent> <sha> -- <path>` / `git show <sha> -- <path>` per il root |                                             |
| Diff worktree     | `git diff` (unstaged) · `git diff --cached` (staged)                         |                                             |
| Stage             | `git add -- <path>`                                                          |                                             |
| Unstage           | `git restore --staged -- <path>`                                             |                                             |
| Scarta            | `git restore -- <path>` (tracciati) · `fs.rm` (untracked, con conferma)      |                                             |
| Commit            | `git commit -F -` con il messaggio su **stdin**                              | evita quoting e argomenti troppo lunghi     |
| Branch            | `git branch --format=…` · `git switch <name>` · `git switch -c <name>`       |                                             |

Ambiente imposto a ogni chiamata: `LC_ALL=C`, `GIT_TERMINAL_PROMPT=0`, `GIT_OPTIONAL_LOCKS=0`,
`-c core.quotepath=false`. Serve a output stabile su path non ASCII e a non bloccare mai su un prompt.

## 5. Passi

### Milestone 1 — slice verticale (questa sessione)

-   [x] Scheletro: `package.json`, `tsconfig.json`, `esbuild.mjs`, `.gitignore`, `LICENSE` MIT
-   [x] `src/core/types.ts` — modelli `Commit`, `Ref`, `StatusEntry`, `DiffFile`, `DiffHunk`
-   [x] `src/core/log.ts` — parsing di `git log` (record `%x00`/`%x1e`)
-   [x] `src/core/graph.ts` — assegnazione lane, merge, edge per il grafo
-   [x] `src/core/status.ts` — parsing `--porcelain=v2 -z`, inclusi rename e conflitti
-   [x] `src/core/diff.ts` — parsing unified diff in file/hunk/righe con numerazione
-   [x] `tests/` — test con `node --test` sui tre parser e sul grafo
-   [x] `src/main/git.ts` — runner `execFile`, timeout, errori tipizzati
-   [x] `src/main/backend.ts` — `GitBackend` + `CliGitBackend`
-   [x] `src/main/index.ts` — finestra, IPC, `disableHardwareAcceleration` selettivo
-   [x] `src/preload/index.ts` — bridge tipizzato
-   [x] `src/renderer/` — lista virtualizzata con grafo SVG, pannello dettagli, diff, stato, commit
-   [x] `docs/registro-attivita.md`, `CHANGELOG.md`, `TODO.md`, `README.md`
-   [x] Verifica: `npm run typecheck`, `npm test`, `npm run build`, avvio reale su un repo vero

### Scostamenti dal piano (registrati durante l'esecuzione)

-   `commitFiles` e `commitPatch` sono due chiamate separate invece di un solo `commitDetail`: la
    prima è veloce e popola la lista dei file, la seconda arriva solo per il file selezionato.
-   I file **non tracciati** non compaiono in `git diff`: la patch arriva da
    `git diff --no-index /dev/null <path>`, con exit code 1 accettato.
-   Aggiunta la modalità `--shots` con passi pilotati da `executeJavaScript`: serve a verificare la
    resa senza display (usata per gli screenshot di questa sessione).
-   Rimosso `root()` dal contratto IPC: non era usato dal renderer.
-   Il grafo usa una lista di corsie con SHA attesi, non indici di colonna: così un merge che
    confluisce in una linea già presente non duplica la corsia.

### Milestone 2 — il diff che conta (prossima sessione)

-   [x] Diff side-by-side, non solo unified, con evidenza della parte cambiata
-   [ ] Syntax highlighting con CodeMirror 6 (side-by-side e inline)
-   [x] Staging per hunk e per riga
-   [x] Undo generale (snapshot di `HEAD` in refs `refs/lanecraft/snapshots/*`) — il differenziatore
        che i client concorrenti non hanno, o riservano al piano a pagamento
-   [ ] Blame con timeline
-   [x] Ricerca nella storia con filtro (`author:`, `file:`)

### Milestone 3 — repo grandi e affidabilità

-   [x] Refresh incrementale su `fs.watch` con debounce
-   [ ] Paginazione della storia (`--skip`/`--max-count`) e caricamento progressivo
-   [ ] `core.fsmonitor` quando disponibile
-   [ ] Misura: `status` e primo paint su repo da 100k file e 50k commit
-   [ ] Solo se sopra soglia: `koffi` + libgit2 per le letture calde

### Milestone 4 — prodotto

-   [ ] Packaging `.deb` **con profilo AppArmor** (i sandbox Chromium su Ubuntu 24.04+ non partono
        senza: vedi `AI_Knowledge/raw/scelta-stack-desktop-2026-analisi.md` §8.2)
-   [ ] Multi-finestra, preferenze, temi chiaro/scuro
-   [ ] Rebase interattivo, cherry-pick, stash, worktree, submodule
-   [ ] LFS e credential helper (delegati a `git`)

## 6. Rischi

| Rischio                                                | Mitigazione                                                                          |
| ------------------------------------------------------ | ------------------------------------------------------------------------------------ |
| Il grafo è sbagliato su merge complessi                | test con repo sintetici con ottavi e merge multipli; confronto con `git log --graph` |
| `--porcelain=v2` ha casi limite (rename + unicode)     | test su fixture, `core.quotepath=false`, split NUL                                   |
| Commit con messaggio vuoto o `-F -` che apre un editor | `-F -` legge da stdin, mai TTY; test esplicito                                       |
| 5000 commit non bastano o sono troppi                  | limite configurabile, poi paginazione                                                |
| GPU assente su alcune macchine                         | rendering software di default, `LANECRAFT_GPU=1` per riattivare                       |
| Il renderer diventa lento                              | virtualizzazione fin da subito, zero framework                                       |
| Deriva verso il "clone di Fork"                        | nessun asset, nessun nome, nessuna stringa copiata; specifiche in `docs/reverse/`    |

## 7. Verifica

1. `npm run typecheck` — zero errori, `strict` attivo.
2. `npm test` — parser e grafo coperti da test con input reali.
3. `npm run build` — i tre bundle escono in `dist/`.
4. Avvio su questo repository (`~/Projects/AI_Knowledge` o lo stesso `lanecraft`): la storia si vede,
   il diff si legge, un commit di prova si crea e si annulla.
5. Screenshot con `--ozone-platform=headless` per verificare la resa senza dipendere dal display.

## 8. Prompt di ripresa

```
Lavoro su ~/Projects/lanecraft (Electron + TypeScript, Linux-first, client Git).
Leggi docs/plans/2026-11-08-lanecraft-v0.1.md: è la fonte di verità sullo stato.
Architettura: src/core = funzioni pure testabili; src/main = GitBackend su `git` CLI via execFile;
src/renderer = DOM puro con liste virtualizzate, zero framework.
Prossimo passo: milestone indicata dalle caselle non spuntate.
Vincoli: nessuna copia di codice o asset da altri client; un client open source (MIT) solo come
riferimento di comportamento; niente Rust/WASM/koffi prima di una misura che superi le soglie.
Verifica sempre con: npm run typecheck && npm test && npm run build.
```
