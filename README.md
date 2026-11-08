# gitcraft

Client Git desktop **Linux-first**, in TypeScript su Electron. Apre un repository vero, mostra la
storia con il grafo, mostra i diff e copre il flusso quotidiano: stage, unstage, scarto, commit,
checkout.

Non è un fork di altri client: è una reimplementazione indipendente, clean-room. Nessun codice, stringa,
icona o asset preso da prodotti esistenti.

## Stato (v0.1)

| Funzione                             | Stato          |
| ------------------------------------ | -------------- |
| Apertura repository                  | ✅             |
| Storia con grafo a corsie            | ✅             |
| Rami, remoti, tag con ahead/behind   | ✅             |
| Staging per file                     | ✅             |
| Diff unified con numerazione di riga | ✅             |
| Commit (anche `-a`)                  | ✅             |
| Checkout e creazione ramo            | ✅             |
| Fetch                                | ✅             |
| Staging per hunk/riga, rebase, undo  | ⏳ milestone 2 |

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
    arrivano solo se una misura supera una soglia (vedi `docs/plans/`).

## Comandi

```bash
npm install
npm start                 # build + avvio
npm start -- --repo ~/Projects/AI_Knowledge

npm test                  # parser, grafo e integrazione con git vero
npm run typecheck
npm run build             # dist/main, dist/preload, dist/renderer
npm run dev               # rebuild continuo dei bundle
```

## Note su Linux

-   **AppArmor**: su Ubuntu 24.04+ (`kernel.apparmor_restrict_unprivileged_userns=1`) il sandbox di
    Chromium non parte. In sviluppo serve `--no-sandbox` o un profilo AppArmor nel pacchetto: è
    previsto nel lavoro di packaging (milestone 4).
-   **GPU**: il processo GPU di Chromium non è disponibile su tutte le macchine. Per un'app testuale
    il rendering software è invisibile, quindi è il default; `GITCRAFT_GPU=1` riattiva
    l'accelerazione.
-   **Screenshot senza display**: `npm run shots -- --repo .` (guida la UI e salva i PNG).

## Licenza

MIT — vedi `LICENSE`.
