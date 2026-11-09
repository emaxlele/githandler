# Ricerca nel contenuto (`git grep`)

## Obiettivo

Cercare una parola o un'espressione regolare dentro i file tracciati, in una finestra separata dalla
ricerca della storia: percorso, riga e testo di ogni corrispondenza, con apertura nel sistema.

## Contesto

-   La ricerca della storia (`search.ts`) guarda i messaggi di commit; `git grep` guarda i file.
-   `git grep -n -I -z` separa percorso, riga e testo con NUL: i due punti in un nome di file non
    rompono il parsing. Exit code 1 significa «nessun risultato», non errore.
-   Il testo cercato deve passare con `-e`: così un valore che inizia con `-` non diventa un'opzione.
-   L'output può essere enorme: il limite va applicato nel core, non lasciando che la UI riceva
    centinaia di migliaia di righe.

## Passi

-   [x] `src/core/content.ts`: `ContentQuery`, `ContentMatch`, `ContentSearchResult`,
        `contentSearchArgs`, `parseContentMatches`, limite 1.000 e validazione del testo.
-   [x] `CliGitBackend.searchContent`: `allowFailure`, timeout 60 s, errore solo per exit code > 1.
-   [x] Canale `git:searchContent`, preload, tipi in `src/shared/api.ts`.
-   [x] Dialog «Cerca nel contenuto»: campo, «Espressione regolare», «Distingui maiuscole», elenco dei
        risultati con «Apri», stato con conteggio o limite raggiunto.
-   [x] Voce nella palette dei comandi e i18n italiano/inglese.
-   [x] Test `tests/content-search.test.mts`: argomenti, parsing con `:`, limite, tre ricerche reali.
-   [x] README, CHANGELOG, TODO, ROADMAP, registro attività.

## Rischi

-   Un repository enorme può produrre molto output prima del taglio: `execFile`/`runGit` ha un tetto
    di 64 MiB e il timeout di 60 s, quindi il caso peggiore è un errore detto, non un blocco.
-   I file non tracciati non compaiono: è il comportamento di `git grep` senza `--untracked`, e il
    dialog lo dice («file tracciati»).
-   Aprire il risultato usa l'app del sistema: l'app non ha un editor di testo integrato, e fingere
    una vista di sola lettura sarebbe un'altra funzione.

## Verifica

```bash
npm run typecheck && npm test && npm run build
```

Schermata: `GITHANDLER_LOCALE=en npm run shots -- --repo /tmp/gitdemo --shots-output /tmp/shots/app.png`
produce `app-content-results.png` con due risultati per `export`.

## Resume prompt

Leggi `docs/plans/2026-11-09-ricerca-contenuto.md`. La ricerca nel contenuto è completa: il dialog
dalla palette chiama `api.searchContent`, il backend esegue `git grep -n -I -z` e il core interpreta
l'output con NUL e il limite di 1.000. Per riprenderlo: verifica che il testo passi sempre con `-e`,
che l'exit code 1 non sia un errore, che i file non tracciati restino esclusi e che il conteggio
mostri anche il caso tagliato. Poi passa al prossimo elemento di `TODO.md`.
