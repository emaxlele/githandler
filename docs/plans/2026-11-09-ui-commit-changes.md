# UI — una sola vista delle modifiche, il commit come scheda

> Piano del 2026-11-09. Obiettivo: togliere la duplicazione della scheda _Changes_, rendere il contatore
> delle modifiche leggibile a colpo d'occhio e ridisegnare la sezione _Commit_ perché non sembri un
> _File Tree_ più povero.

## Contesto

Tre richieste dell'utente, dopo la rifinitura della v0.10:

-   «changes qui non serve a nulla visto che abbiamo l'altro sul pannello laterale». La causa era
    strutturale: `#panel-changes` è **un unico elemento** che `setSide` spostava tra `#changes-main`
    (voce della barra laterale) e `#panes` (pannello inferiore). Non erano due viste simili: era la
    stessa vista mostrata in due posti.
-   «un contatore che faccia capire a colpo d'occhio se ci sono modifiche». Il badge esisteva ma era
    sempre visibile, anche a `0`.
-   «va fatta diversa questa visualizzazione della sezione commit perché così com'è è come ripetere la
    sezione File tree ma in modo brutto». Il pannello _Commit_ aveva una colonna di percorsi a fianco
    del diff: la stessa forma del _File Tree_.

Vincoli: nessuna dipendenza nuova, stessa palette e stesso linguaggio visivo, nessun cambio al backend.

## Decisioni

-   **La scheda _Changes_ sparisce**, non viene nascosta: `Tab` e `PanelTab` perdono `"changes"` e
    `PanelState` perde `side` (la finestra staccata non lo leggeva). Le modifiche si aprono solo dalla
    barra laterale, a tutta area.
-   **Il contatore è un indicatore, non una decorazione**: a zero non si vede; verde quando tutto è in
    stage (basta il commit), ambra quando resta qualcosa fuori. Il `title` dice quanti file sono in
    stage e quanti fuori.
-   **Il commit diventa una scheda, non un elenco**: identità su una riga (autore, data, SHA copiabile,
    genitori, numero di file), messaggio su due righe al massimo, file come pastiglie orizzontali con
    stato e cartella, diff a tutta larghezza. _File Tree_ resta l'unica vista ad albero e l'unica a due
    colonne. Alternativa scartata: due colonne con albero nel pannello _Commit_ — sarebbe stata la
    stessa forma del _File Tree_.

## Passi

-   [x] `index.html`: togliere `#tab-changes`, spostare `#panel-changes` dentro `#changes-main` come
        figlio fisso, svuotare `#panel-commit` e lasciare `#commit-head` + diff.
-   [x] `app.ts`: `Tab = PanelTab`, `syncPanels` senza _changes_, `setSide` senza spostamenti di nodi,
        `setTab` che riporta la storia quando si è nelle modifiche.
-   [x] `renderCommitHead` al posto di `renderCommitMeta`/`renderCommitFiles`: riga di identità,
        corpo del messaggio, pastiglie dei file; click e tasto destro delegati a `#commit-head`.
-   [x] `renderChangesBadge`: totale, tono (`ready`/`dirty`), `is-zero`, `title` sul badge e sulla voce.
-   [x] `styles.css`: `.commit-head`/`.commit-line`/`.commit-chips`, toni del badge, `#panel-commit` a
        una colonna; via le regole `.commit-meta`/`.meta-*` rimaste senza uso.
-   [x] `src/main/index.ts`: il passo screenshot che cliccava `#tab-changes` ora passa dalla barra
        laterale; tolto lo screenshot duplicato di _Changes_.
-   [x] Verifica: `npm run typecheck`, `npm test` (140 verdi), `npm run build`, screenshot headless a
        1440 e 940 px, prova CDP su `/tmp/gitdemo` (contatore, stadi, passaggio modifiche ↔ storia,
        intestazione, larghezze) e `/tmp/gitclean` (contatore nascosto a zero), pannello staccato.
-   [x] Documenti: CHANGELOG 0.10.0, TODO, registro attività; commit di githandler e aggiornamento di
        AI_Knowledge.

## Rischi

-   **Perdere l'accesso alle modifiche** con la scheda rimossa: la voce della barra laterale c'è sempre e
    il contatore la rende evidente. Una scheda del pannello scelta mentre si è nelle modifiche riporta
    la storia (`setTab`).
-   **Finestra staccata**: il protocollo `panel:sync` cambia forma. Le due finestre sono lo stesso build,
    quindi non c'è convivenza tra versioni; lo stato pubblicato contiene solo campi ancora letti.
-   **Intestazione troppo alta** nel pannello basso: corpo del messaggio limitato a due righe, pastiglie
    su una riga sola che scorre in orizzontale, nessuna intestazione quando non c'è un commit.

## Verifica

-   `npm run typecheck`, `npm test` (140 verdi), `npm run build`: puliti.
-   CDP su `/tmp/gitdemo`: nessun `#tab-changes`; `#panel-changes` dentro `#changes-main`; badge
    `dirty:4` con «4 file con modifiche · 2 in stage, 2 fuori»; stage → contatore ancora ambra per il
    file non tracciato; clic su _File Tree_ dalle modifiche → storia e scheda attiva; intestazione del
    commit con oggetto, fatti e 1 pastiglia selezionata; `#panel-tree` `340px 876px` contro
    `#panel-commit` a una colonna.
-   CDP su `/tmp/gitclean`: badge `display: none`, `is-zero`, titolo «nessuna modifica».
-   CDP con pannello staccato: la seconda finestra mostra la scheda _Commit_ con l'intestazione e segue
    il cambio a _File Tree_.
-   Screenshot: commit (anche con corpo del messaggio, commit di merge e cinque file), modifiche a tutta
    area, _File Tree_ invariato, larghezza minima 940 px.

## Esito

Fatto e verificato. La duplicazione è sparita insieme al nodo spostato; il contatore usa il colore per
dire se c'è solo da committare; il pannello _Commit_ ha una gerarchia diversa da _File Tree_ (scheda in
alto, diff a tutta larghezza).

## Prompt di ripresa

Riprendi il ridisegno UI di GitHandler in `~/Projects/githandler` leggendo
`docs/plans/2026-11-09-ui-commit-changes.md`: scheda _Changes_ del pannello inferiore rimossa (le
modifiche restano solo a tutta area dalla barra laterale), contatore con tono verde/ambra e nascosto a
zero, pannello _Commit_ trasformato in scheda (identità, messaggio su due righe, pastiglie dei file,
diff a tutta larghezza). Stato: implementato, verificato con typecheck, 140 test, build, screenshot e
CDP.
