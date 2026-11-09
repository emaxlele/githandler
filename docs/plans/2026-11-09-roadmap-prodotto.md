# Roadmap di prodotto: conflitti, bilingue, palette, MCP in scrittura

> Obiettivo: portare GitHandler da «client che legge e opera» a client quotidiano: risolvere i
> conflitti senza uscire dall'app, interfaccia in italiano e inglese, comandi dalla tastiera, e
> strumenti MCP che scrivono sotto permessi espliciti. Ultimo aggiornamento: 2026-11-09

## Contesto

Pubblicazione chiusa (vedi `2026-11-09-preparazione-pubblicazione.md`): licenza GPL-3.0-or-later, CI,
documenti, badge. Il repository resta privato fino a decisione dell'utente.

Regole nuove, valide per tutto il lavoro qui sotto:

-   **Codice in inglese**: identificatori, tipi, commenti, messaggi di commit, nomi dei test.
-   **Interfaccia bilingue**: ogni stringa visibile passa da un catalogo (`src/renderer/i18n.ts`), con
    italiano e inglese. La lingua predefinita segue il sistema; si cambia dalle impostazioni.
-   **Nessun nome di altri client Git** in codice, commenti, documenti o commit.

Stato del codice: v0.10.0, 143 test, `npm run typecheck && npm test && npm run build` verdi.
Architettura in `docs/architettura.md`; misure in `docs/backend-performance.md`.

## Fase 1 — Infrastruttura i18n

-   [ ] `src/renderer/i18n.ts`: tipo `Locale = "it" | "en"`, catalogo con chiavi semantiche,
        `t(key, params)`, `setLocale`, `getLocale`, `onLocaleChange`.
-   [ ] `Locale` in `Settings` (`auto` | `it` | `en`) con migrazione del file esistente e canale IPC
        delle impostazioni già presente.
-   [ ] Rilevamento del sistema al primo avvio (`app.getLocale()` nel main) e ripiego su `it`.
-   [ ] Attributi `data-i18n`, `data-i18n-title`, `data-i18n-placeholder` in `index.html`, applicati
        all'avvio e al cambio lingua.
-   [ ] Migrazione delle stringhe di `app.ts` a `t()`: toolbar, schede, pannello, dialog, toast,
        stati vuoti, impostazioni.
-   [ ] Test del catalogo: chiavi presenti in entrambe le lingue, nessuna stringa vuota, parametri
        interpolati.

## Fase 2 — Conflitti in-app

-   [ ] `src/core/conflicts.ts`: parser dei marcatori (`<<<<<<<`, `|||||||`, `=======`, `>>>>>>>`) in
        segmenti `{ ours, base, theirs }`, e ricostruzione del testo con una scelta per segmento
        (`ours` | `theirs` | `both` | `base`). Test su file con più conflitti, senza base (`diff3`
        disattivato), con marcatori incompleti.
-   [ ] Backend: `conflictFiles()` (path, tipo di conflitto dalle stage 1/2/3, binario), `conflictDetail(path)`
        (base, ours, theirs, testo del working tree normalizzato con `git checkout --conflict=diff3`),
        `resolveConflict(path, choices)` e `writeResolved(path, text)`, `markResolved(paths)`,
        `continueOperation()` (`git merge|rebase|cherry-pick --continue` con `GIT_EDITOR=true`).
-   [ ] Percorsi validati come le altre scritture; nessuna scrittura fuori dal repository.
-   [ ] IPC e `shared/api.ts` per le nuove operazioni; preload aggiornato.
-   [ ] UI: pannello dei conflitti quando `info.operation` non è nullo. Elenco dei file, vista a tre
        vie per file di testo, scelta per hunk, «usa mio» / «usa loro» per file, editor del risultato,
        «segna risolto», «continua», «annulla operazione».
-   [ ] Conflitti di cancellazione/modifica e file binari: solo scelta per file, spiegata.
-   [ ] Dopo «continua», refresh e uscita dal pannello quando l'operazione è conclusa.

## Fase 3 — Command palette e scorciatoie

-   [ ] Palette (`Ctrl+K`) con ricerca fuzzy sui comandi, azioni raggruppate (repository, storia,
        rami, stash, vista), tasti mostrati a destra.
-   [ ] Registro dei comandi unico: la palette e le scorciatoie chiamano le stesse funzioni della UI.
-   [ ] Scorciatoie documentate nel README, con `?` che apre l'elenco.
-   [ ] Nessuna scorciatoia che distrugga dati senza conferma.

## Fase 4 — MCP in scrittura, con audit

-   [ ] Tool `stage`, `unstage`, `commit`, `create_branch`, `checkout_branch`, sotto la stessa policy
        per comando (`off` / `read` / `all` / `custom`), default spento.
-   [ ] Audit log in `.git/githandler/mcp-audit.jsonl`: timestamp, tool, argomenti, esito; percorso
        dichiarato in `docs/mcp.md`, dimensione limitata.
-   [ ] Test: un tool non abilitato non compare e non risponde; le scritture finite nell'audit.
-   [ ] UI: i permessi di scrittura sono separati dalla lettura e si vedono nell'elenco.

## Rischi

-   **Rebase**: «mio» e «loro» si invertono rispetto al merge. L'etichetta deve dire da dove viene il
    contenuto (`HEAD` / commit in applicazione), non solo «mio/loro».
-   **File binari e conflitti di cancellazione**: nessuna vista a tre vie, solo scelta per file.
-   **i18n**: migrare 4.000 righe di UI in un colpo è rischioso. Si procede per aree, con il catalogo
    come unica fonte e un test che impedisce chiavi orfane.
-   **MCP**: un tool di scrittura può lasciare il repository in uno stato sospeso. Va registrato
    nell'audit e deve essere annullabile con l'undo dell'app.

## Verifica

```bash
npm run typecheck && npm test && npm run build
npm run bench -- --commits 50000 --files 100000     # solo se si tocca il backend caldo
```

Per i conflitti: repository di prova con un merge in conflitto vero (`git merge` di due rami che
modificano la stessa riga), poi risoluzione dall'app e verifica con `git status`.

## Prompt per riprendere

> Nel repo `~/Projects/githandler` leggi `docs/plans/2026-11-09-roadmap-prodotto.md` e
> `docs/registro-attivita.md`. Regole: codice in inglese, UI bilingue via `src/renderer/i18n.ts`,
> nessun nome di altri client. Stato: pubblicazione chiusa, repository privato. Prossimo passo non
> spuntato nel piano; verifica con `npm run typecheck && npm test && npm run build` e aggiorna
> registro, CHANGELOG e TODO.
