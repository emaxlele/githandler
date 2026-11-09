# Rinomina in GitHandler e interfaccia sul modello dei client desktop

> Obiettivo: il progetto si chiama **GitHandler** e la finestra principale segue la struttura dei
> client desktop affermati: toolbar con azioni etichettate, scheda repository, barra laterale con Changes/All Commits e i ref,
> storia a colonne (grafo, messaggio, autore, SHA, data), pannello inferiore con
> Commit / Changes / File Tree. Ultimo aggiornamento: 2026-11-08

## Contesto

La v0.5 funziona ma la disposizione è nostra: barra superiore con cinque pulsanti generici, barra
laterale con tre liste, storia con tre colonne, pannello inferiore con Modifiche/Commit/Blame. Le
foto di riferimento indicano la struttura attesa: le azioni hanno icona **e** etichetta, il repository ha una
scheda, la barra laterale distingue _Changes_ da _All Commits_, la storia mostra autore con avatar,
SHA breve e data, e il dettaglio del commit separa AUTHOR e COMMITTER con SHA e PARENTS.

Vincoli: tema scuro del progetto (palette `--bg`/`--panel`/`--accent`), nessun asset preso da altri
client, solo la disposizione. Le funzioni che non esistono (pull, push, stash, submodule, tab multipli) non
diventano pulsanti finti: le voci corrispondenti si omettono.

## Passi

-   [x] Rinomina completa `gitlattice` → `githandler` (pacchetto, `refs/githandler/*`,
        `~/.config/githandler`, `GITHANDLER_*`, cartella, repository GitHub, launcher, icona)
-   [x] Dettaglio commit dal backend: `git show -s` con autore, committer, date ISO, corpo del
        messaggio; nuovo canale IPC `git:commitDetails` e test sul parser
-   [x] Nuovo scheletro HTML: toolbar, scheda repository, barra laterale, storia, pannello inferiore
-   [x] Riscrittura della shell CSS (toolbar, tab, sidebar, tabella storia) mantenendo gli stili di
        diff, blame, impostazioni e file list
-   [x] Storia a cinque colonne: grafo, messaggio con badge dei ref, autore con avatar a iniziali, SHA
        breve, data assoluta
-   [x] Pannello inferiore: `Commit` (AUTHOR/COMMITTER, SHA, PARENTS, messaggio, file), `Changes`
        (Staged/Unstaged separati, diff, riquadro del commit), `File Tree` (albero dei file del
        commit, diff a destra), `Blame`
-   [x] Barra laterale: nome repository con ingranaggio, _Changes (n)_, _All Commits_, filtro,
        Branches/Remotes/Tags con intestazioni comprimibili
-   [x] Screenshot di verifica (storia, commit, changes, file tree) e ritocco di spaziature
-   [x] README, CHANGELOG, TODO, registro aggiornati; commit e push; reinstallazione locale

## Rischi

-   La lista della storia è virtualizzata: aggiungere colonne significa toccare `LogView` e il CSS
    della riga, non solo l'HTML. Un errore qui rompe scroll e selezione.
-   `Changes` con Staged e Unstaged separati cambia il flusso di stage: i test non coprono la UI,
    quindi serve una prova manuale su `/tmp/gitdemo` (file modificato e file non tracciato).
-   Il dettaglio del commit aggiunge un giro IPC per selezione: va tenuto leggero e tollerante ai
    repository senza commit (HEAD assente).

## Verifica

```bash
npm run typecheck && npm test && npm run build
./node_modules/.bin/electron . --repo /tmp/gitdemo --shots /tmp/githandler --no-sandbox
./build/install-local.sh
```

## Prompt per riprendere

> Nel repo `~/Projects/githandler` leggi `docs/plans/2026-11-08-ui-githandler.md` e
> `docs/registro-attivita.md`. Rinomina in GitHandler e interfaccia sul modello dei client Git
> desktop sono fatte (99 test verdi). Prossimi passi aperti: sintassi evidenziata (CodeMirror 6,
> dipendenza da approvare), schede multiple di repository, packaging `.deb`. Per provare l'app:
> `githandler` dal menu, oppure `./node_modules/.bin/electron . --repo /tmp/gitdemo --no-sandbox`.
