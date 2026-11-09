# Avanzamento delle operazioni di rete

## Obiettivo

Mostrare l'avanzamento di clone, fetch, pull e push mentre il comando lavora, non solo l'esito:
fase, barra e percentuale nella toolbar, con il dettaglio di Git come tooltip.

## Contesto

-   `src/main/git.ts` usava `execFile`: `stderr` arrivava solo alla chiusura del processo.
-   Git scrive l'avanzamento su `stderr`, con `\r` per aggiornare la stessa riga, e solo con un TTY
    oppure con `--progress`.
-   Le operazioni di rete sono in `CliGitBackend.fetch/pull/push` e `cloneRepository`; gli argomenti
    sono costruiti nel core (`ops.ts`, `providers.ts`) e quindi verificabili senza rete.
-   Il renderer ha più schede aperte: un evento deve dire a quale root appartiene, altrimenti
    l'avanzamento di un repository finirebbe sopra un altro.

## Passi

-   [x] `src/core/network.ts`: `NetworkProgress`, `parseProgressLine`, `ProgressReader` (righe divise,
        `\r`, ANSI, `remote:`, percentuali limitate).
-   [x] `src/main/git.ts`: `runGitStreaming` con `spawn`, pipe, limite 64 MiB, timeout e lo stesso
        `GitError` di `runGit`.
-   [x] `--progress` in `cloneArgs`, `pullArgs`, `pushArgs` e nel fetch del backend.
-   [x] Callback opzionale su `GitBackend.fetch/pull/push` e su `cloneRepository`; il main pubblica
        `NETWORK_CHANNEL` con root, scope e dettaglio.
-   [x] Preload `onNetwork`, tipi in `src/shared/api.ts`, barra `#network-status` con fase, barra e
        percentuale, nascosta a operazione conclusa; filtro per root nel renderer.
-   [x] i18n delle fasi di Git e del fallback «Rete».
-   [x] Test `tests/network.test.mts` e `tests/network-progress.test.mts` (clone reale da `file://`).
-   [x] README, CHANGELOG, TODO, ROADMAP, registro attività.

## Rischi

-   L'output di Git cambia fra versioni e lingue: il processo forza `LC_ALL=C`, e il parser scarta
    ciò che non riconosce invece di inventare una percentuale.
-   Un'operazione può essere lenta ma non produrre righe (trasporto locale): la barra resta a 0% e
    mostra la fase generica, poi sparisce alla fine.
-   Il timeout uccide il processo: `runGitStreaming` respinge con `GitError`, come `runGit`.

## Verifica

```bash
npm run typecheck && npm test && npm run build
```

Il test di integrazione crea un repository, lo clona da `file://` e controlla che gli eventi
arrivino, che le fasi siano note e che l'ultimo evento sia al 100%.

## Resume prompt

Leggi `docs/plans/2026-11-09-progresso-rete.md`. L'avanzamento di rete è completo: `runGitStreaming`
legge `stderr` a pezzi, `src/core/network.ts` lo interpreta, il main pubblica `NETWORK_CHANNEL` e la
toolbar mostra fase, barra e percentuale. Per riprenderlo: verifica che `fetch`, `pull`, `push` e
`cloneRepository` passino il callback, che il renderer ignori gli eventi di un altro root e che
`--progress` sia negli argomenti del core. Poi passa al prossimo elemento di `TODO.md`.
