# Stash parziale

## Obiettivo

Salvare nello stash solo i file scelti, lasciando gli altri nel working tree, senza cambiare il
comportamento classico quando sono selezionati tutti.

## Contesto

-   `stashSaveArgs` in `src/core/ops.ts` costruisce `git stash push --include-untracked`.
-   `CliGitBackend.stashSave` includeva sempre tutto; i path arrivano dal renderer e non sono
    attendibili.
-   `StatusEntry` porta `path`, `kind` e `label`; gli `unmerged` non possono entrare in uno stash.
-   Il renderer ha già il dialog dello stash con messaggio ed elenco; mancava la scelta dei file.

## Passi

-   [x] `stashSaveArgs(message, paths?)` con `--` davanti ai path.
-   [x] `stashSave(message, paths?)` nel backend: deduplica, rifiuta elenco vuoto e verifica ogni
        path con `assertSafePath`.
-   [x] Canale IPC e preload aggiornati; il main passa i path al backend.
-   [x] Dialog: elenco con caselle tutte attive, «Tutti» / «Nessuno», messaggio che spiega gli altri
        file, errore se non c'è nessuna selezione.
-   [x] i18n delle etichette di stato (`Modificato`, `Non tracciato`, `Conflitto`…) e dei testi nuovi.
-   [x] Test degli argomenti e test reale con due file modificati e uno non tracciato.
-   [x] README, CHANGELOG, TODO, ROADMAP, registro attività.

## Rischi

-   Un pathspec che sembra un'opzione (`-p`) deve essere rifiutato: `assertSafePath` lo fa e il test
    lo copre.
-   Con tutti i file selezionati si usa il comando senza pathspec, così il comportamento resta
    identico a prima.
-   I file in conflitto sono esclusi dall'elenco: uno stash durante un merge non ha senso.

## Verifica

```bash
npm run typecheck && npm test && npm run build
```

Test reale: `a.txt` e `b.txt` modificati, `nuovo.txt` non tracciato; stash di `a.txt`; `a.txt` torna
alla base, `b.txt` e `nuovo.txt` restano; applicando lo stash `a.txt` torna modificato.

## Resume prompt

Leggi `docs/plans/2026-11-09-stash-parziale.md`. Lo stash parziale è completo: il dialog elenca i
file, il backend valida i path e `stashSaveArgs` aggiunge `-- <path>…` solo per una selezione
parziale. Per riprenderlo: controlla che «Tutti» usi ancora il comando senza pathspec, che i file in
conflitto non compaiano e che `assertSafePath` copra `..`, path assoluti e nomi con `-`. Poi passa al
prossimo elemento di `TODO.md`.
