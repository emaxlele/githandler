# Prestazioni del backend: misure e soglie

> Misurato il 2026-11-08 su Ubuntu 26.04, 16 core, Node 24.22, git 2.53.
> Riproducibile con `npm run bench` (e `npm run bench -- --commits 50000 --files 100000`).

## Perché questo documento

La domanda ricorrente è: _conviene spostare il core in un linguaggio nativo_ (Zig + libgit2,
Rust + `git2`, C++ + libgit2)? Senza numeri la risposta è un'opinione. Questi sono i numeri.

## Cosa costa davvero

| Operazione                  | Tempo      | Note                           |
| --------------------------- | ---------- | ------------------------------ |
| `git log` 5.000 commit      | **35 ms**  | output 0.8 MB, cache calda     |
| `parseLog` 5.000 commit     | 7,3 ms     | codice TypeScript              |
| `layoutGraph` 5.000 commit  | 4,2 ms     | codice TypeScript              |
| `git log` 50.000 commit     | **370 ms** | output 8,4 MB                  |
| `parseLog` 50.000 commit    | 69 ms      | codice TypeScript              |
| `layoutGraph` 50.000 commit | 16 ms      | codice TypeScript              |
| `git status` 100.000 file   | **82 ms**  | cache calda, repository pulito |
| `parseStatus` (stesso repo) | 0,3 ms     | l'output è minuscolo           |

Conclusioni che si leggono direttamente:

-   Al limite attuale dell'app (5.000 commit) il parsing costa **11 ms su ~47 ms** totali. Un core
    nativo perfetto, che azzerasse il parsing, guadagnerebbe il 20-25% di un'operazione che dura
    meno di un battito di ciglia.
-   A 50.000 commit — **dieci volte** il limite attuale — il parsing è 85 ms su 370 ms. Il resto è
    git stesso: avvio del processo, camminata del grafo, formattazione.
-   `git status` su 100.000 file è 82 ms. Su cache fredda domina l'I/O (`stat` di ogni file), non il
    linguaggio con cui è scritto il client: né Zig né libgit2 evitano quel costo.
-   `parseStatus` è irrilevante: l'output di `status` non è grande, il tempo se ne va in Git.

Quindi, oggi, **il collo di bottiglia non è TypeScript**. Quando l'app sembrerà lenta, lo sarà per
altri motivi, misurabili separatamente: serializzazione IPC di 50.000 commit verso il renderer,
disegno del DOM, e refresh non incrementale.

## Cosa un core nativo non risolverebbe

Il vantaggio di invocare `git` non è la velocità: è la **compatibilità per costruzione**.

| Comportamento                                          | `git` CLI        | libgit2                                                                                                                                      |
| ------------------------------------------------------ | ---------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| Hook (`pre-commit`, `commit-msg`, `pre-push`, …)       | eseguiti         | **non supportati**: la PR di supporto è aperta dal 2018 ([libgit2#4620](https://github.com/libgit2/libgit2/pull/4620))                       |
| Filtri `clean`/`smudge` arbitrari (Git LFS)            | eseguiti         | non esegue comandi esterni: solo `crlf` e `ident` integrati ([filter.h](https://github.com/libgit2/libgit2/blob/main/include/git2/filter.h)) |
| Credential helper, `ssh`                               | delegati a `git` | da reimplementare                                                                                                                            |
| Sparse checkout                                        | supportato       | nell'elenco dei lavori aperti di libgit2 ([projects.md](https://github.com/libgit2/libgit2/blob/main/docs/projects.md))                      |
| `core.autocrlf`, `.gitattributes`, submodule, worktree | completi         | copertura parziale e con differenze                                                                                                          |

Se il core calcola lo stato con libgit2 ma le modifiche passano da `git`, si ottengono **due verità
sullo stesso repository**: un file può risultare modificato per uno e pulito per l'altro. È la
classe di bug più costosa che un client Git possa avere, perché l'utente perde fiducia nell'app
prima ancora di perdere dati.

## Zig: cosa è cambiato nel 2026

L'argomento "in Zig basta `@cImport`" non è più valido:

-   `@cImport` è deprecato da Zig 0.16 (aprile 2026) e **rimosso in Zig 0.17** (ottobre 2026). Oggi
    si genera un `c.zig` da un header con il passo `addTranslateC` del build system, e il file
    generato dipende da sistema operativo e architettura.
-   I binding Node-API per Zig esistono e sono promettenti ([zapi](https://github.com/ChainSafe/zapi),
    [napigen](https://github.com/cztomsik/napigen), [tokota](https://github.com/kofi-q/tokota)), ma
    sono molto più giovani di `napi-rs` (Rust) e non hanno un equivalente di `koffi`, che un addon
    non lo richiede affatto.
-   Compilare libgit2 resta un passaggio a sé: header, dipendenze (zlib, pcre2, TLS) e una libreria
    per ogni piattaforma da impacchettare.

Nessuno di questi è un motivo per non usare Zig in assoluto; sono motivi per non usarlo **adesso**,
al posto di una CLI che funziona, per guadagnare millisecondi che non si vedono.

## Soglie e ordine di intervento

Si cambia architettura solo se una misura supera una soglia, e nell'ordine di costo crescente.

| Soglia                       | Misura                                   | Reazione                                                  |
| ---------------------------- | ---------------------------------------- | --------------------------------------------------------- |
| primo paint > 150 ms         | apertura di un repository di riferimento | paginazione della storia                                  |
| `git log` + parsing > 300 ms | 5.000 commit, cache calda                | paginazione e caricamento progressivo                     |
| refresh > 200 ms             | dopo un `git add`                        | `fs.watch` con debounce, refresh incrementale             |
| `status` > 500 ms            | 100.000 file                             | `core.fsmonitor`; poi valutare libgit2 con test di parità |

Solo dopo queste quattro, se il collo di bottiglia è ancora l'elaborazione e non l'I/O:

1.  parsing in `worker_threads` (zero nuovi linguaggi, nessun artefatto da distribuire);
2.  `koffi` + libgit2 per le **letture calde** dove la semantica coincide con Git (commit, alberi,
    diff), tenendo `git` come verità per stato e mutazioni;
3.  addon nativo, con `napi-rs` come prima scelta per maturità; Zig se il progetto decide di
    scommettere su un linguaggio pre-1.0.

Ogni passo richiede un **test di parità**: gli stessi dati letti da libgit2 e da `git` devono
coincidere su un repository di prova con hook, LFS, attributi e submodule. Senza quel test, la
seconda via non si apre.

## Come si rimisura

```bash
npm run bench                                  # 20.000 commit, 20.000 file
npm run bench -- --commits 50000 --files 100000
```

Il benchmark crea un repository temporaneo con `git fast-import`, quindi misura processo, parsing e
layout con la mediana su più giri, e cancella tutto alla fine.
