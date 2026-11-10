# Changes: aggiornamento automatico, ordine, doppio clic, allineamento, stash per file

## Obiettivo

Cinque richieste dell'utente sulla vista _Changes_ e sui rami:

1.  modificare un file deve comparire in _Changes_ senza chiudere e riaprire il progetto;
2.  le modifiche fuori dallo stage stanno **sopra**, quelle in stage **sotto**;
3.  doppio clic su un file lo sposta tra stage e working tree;
4.  tasto destro su un ramo: una voce che lo **allinea all'upstream**, gestendo i conflitti;
5.  tasto destro su un file in _Changes_: le funzioni dello stash, più un pulsante per file accanto a
    `+`/`−` e `×`.

## Contesto

-   **Sorveglianza opt-in**: `src/main/index.ts` accendeva il watcher solo con `--watch` o
    `GITHANDLER_WATCH=1`. Ecco perché le modifiche fatte in un editor non comparivano: il main non
    rileggeva il repository. `src/main/watcher.ts` (debounce 400 ms, filtro sui path) e
    `api.onChanged` nel renderer funzionavano già: mancava solo l'accensione.
-   **Ordine**: `src/renderer/index.html` ha il blocco `Staged` prima di `Unstaged`; i due elenchi
    sono riempiti da `renderChanges` / `fillChangeList` con `dataset.side` che dice da quale parte
    arriva il clic.
-   **Clic**: `changeListClick` gestisce `stage`, `unstage`, `discard` e la selezione. Il doppio clic
    arriva come due `click` più un `dblclick`: la selezione resta, il cambio di lato è idempotente.
-   **Rami**: `openRefMenu` costruisce le voci con `ref.kind === "local"`; `RefInfo` porta `short`,
    `sha`, `current`, `ahead`, `behind`. Il backend ha già `fetch`, `merge`, `rebase`.
-   **Stash**: `stashSave(message, paths)` accetta già i percorsi (`git stash push -- <path>`), la
    finestra _Stash_ elenca e applica; mancavano le scorciatoie per file.

## Scelte

-   **Sorveglianza accesa di default**, spenta con `--no-watch` o `GITHANDLER_WATCH=0`, e spenta in
    modalità screenshot (che deve restare deterministica). `--watch` resta accettato come no-op.
-   **Solo la disposizione cambia**: gli elenchi restano due, lo stage resta lo stesso; si scambiano i
    due blocchi nel markup, così CSS e gestori non si toccano.
-   **Doppio clic = inverso del lato**: nella lista in stage toglie, in quella fuori aggiunge. Un file
    non tracciato si aggiunge e basta (non ha un lato "in stage" da cui tornare).
-   **Allineamento solo del ramo attuale**: `git merge --ff-only` non può aggiornare un ramo non
    caricato in HEAD senza toccare il working tree. La voce è disabilitata sugli altri rami con il
    motivo nel tooltip.
-   **Tre esiti dichiarati**: già allineato, avanti veloce, divergente. Nel terzo caso si chiede se
    riapplicare i commit locali con un rebase: i conflitti finiscono nella finestra che già esiste,
    niente `reset --hard` e niente commit buttati.
-   **Stash per file**: stesso comando del dialog (`stashSave` con un solo percorso), messaggio
    predefinito `Modifiche a <path>`. Nessuna nuova API: cambia solo chi la chiama.
-   **Menu del file in _Changes_**: le azioni che esistono già (apri, mostra, salva copia, copia
    percorso) più stage/unstage, scarto e le voci dello stash, con il separatore dove cambia il tipo
    di operazione.

## Passi

-   [x] Sorveglianza accesa di default, `--no-watch` e `GITHANDLER_WATCH=0` per spegnerla.
-   [x] Blocchi scambiati: _Unstaged_ sopra, _Staged_ sotto.
-   [x] Doppio clic che sposta il file tra stage e working tree.
-   [x] `alignToUpstream` nel backend (fetch, conteggi, `merge --ff-only`), IPC e voce di menu con i
        tre esiti e il rebase per il caso divergente.
-   [x] Pulsante stash per riga e menu contestuale del file in _Changes_.
-   [x] Catalogo inglese delle stringhe nuove.
-   [x] Test: conteggi e decisione dell'allineamento nel core, percorso singolo nello stash.
-   [x] Documentazione: README (italiano e inglese), CHANGELOG, TODO, registro attività.

## Rischi

-   Accendere la sorveglianza su un repository enorme rilegge lo stato a ogni salvataggio: c'è il
    debounce di 400 ms e il refresh incrementale, ma su 100.000 file il costo si sente. Resta lo
    spegnimento esplicito.
-   Il watcher può perdere eventi (limite di `inotify`): il chip _Live_ dice che è attivo, non che
    ogni modifica è stata vista; il refresh manuale resta.
-   Un rebase di allineamento può fermarsi su conflitti: è il comportamento voluto, ma il ramo resta
    in mezzo a un'operazione finché non si risolve o si annulla.
-   `git stash push -- <path>` con un file non tracciato richiede `--include-untracked`, che gli argomenti
    mettono già: senza, Git rifiuterebbe il percorso.

## Verifica

```bash
npm run typecheck && npm test && npm run build
GITHANDLER_LOCALE=en npm run shots -- --repo /tmp/gitdemo --shots-output /tmp/shots/app.png
```

Provato anche contro l'app vera, pilotando il renderer con il protocollo CDP di Electron
(`--remote-debugging-port`) su `/tmp/gitdemo`: un file scritto da fuori compare in _Changes_ da solo;
il doppio clic sposta la riga e la lascia selezionata; il menu del file mostra stage, scarto e stash;
«Allinea all'upstream» porta nel ramo un commit pubblicato da un secondo clone; il pulsante `⇩` salva
nello stash il solo file. Il doppio clic è stato provato con eventi di input veri: con le liste
ricostruite alla selezione il browser non emette `dblclick`, quindi `selectChange` ora tocca solo la
classe `is-selected` (`markSelectedChange`). Il caso divergente è coperto dai test del backend (rebase
esplicito, nessun `reset --hard`); la conferma `window.confirm` non è stata pilotata.

## Resume prompt

All five requests are implemented and verified: watcher on by default, unstaged above staged, double
click to move a file, a `⇩` button and a context menu with the stash entries per row, and
"align with its upstream" in the branch menu (`backend.alignToUpstream`: fetch, counts,
`merge --ff-only`, explicit rebase when diverged, conflicts in the existing window). Nothing is left
open in this plan; a future session that touches this area should keep the three outcomes separate,
never call `reset --hard` there, and re-run `npm run typecheck && npm test && npm run build` plus the
CDP check described under Verifica.
