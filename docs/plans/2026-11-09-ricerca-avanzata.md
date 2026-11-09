# Ricerca nella storia, più forte

> Espressioni regolari, pickaxe (`-S`), ricerca nel diff (`-G`) e storia di un intervallo di righe
> (`-L`) nello stesso linguaggio della ricerca attuale. Creato il 2026-11-09.

## Obiettivo

La ricerca sa oggi tre cose: testo letterale, `author:`, `file:`. Sono le tre che si usano ogni
giorno, ma non bastano quando la domanda è «quando è cambiato questo comportamento». Questa fase
aggiunge quattro operatori, con lo stesso limite di prima: nessuna regex implicita (un messaggio con
`(` non deve diventare un'espressione rotta o lentissima) e nessuna query inventata dal client.

Fuori: ricerca nel contenuto dei file del working tree (è un `git grep`, un altro strumento) e
interfaccia dedicata con campi separati: il linguaggio resta una riga sola.

## Contesto

-   `src/core/search.ts`: tokenizzatore, `parseHistoryQuery`, `formatHistoryQuery`, `historyArgs`.
    Test in `tests/search.test.mts` su un repository temporaneo vero.
-   `GitBackend.search` riceveva una **stringa** e la riparsava: due passaggi e un round-trip fragile
    per valori con virgolette. Ora riceve direttamente `HistoryQuery`; la stringa si parse una volta
    sola al confine IPC (`git:search`).
-   `src/mcp/server.ts`: il tool `history` costruiva la query e la formattava in stringa. Ora passa
    l'oggetto, e i nuovi argomenti sono nello schema.

## Passi

-   [x] `HistoryQuery` con `regex`, `pickaxe`, `diff`, `lines` (`{start, end, path}`); `parseLineRange`
        con limiti (inizio ≥ 1, fine ≥ inizio, massimo 1000 righe, percorso senza caratteri di
        controllo).
-   [x] Prefissi `regex:`, `change:`, `diff:`, `lines:`; `grep:` resta alias di `file:` (prima finiva
        in `file` per un ramo sbagliato del parser). Testo libero e `regex:` insieme sono un errore
        esplicito, non una OR silenziosa.
-   [x] `historyArgs`: `--extended-regexp --grep=` per `regex:`; `-S` per `change:`; `-G` per `diff:`;
        per `lines:` niente `--all` (Git vuole un solo punto di partenza), `--no-patch` (senza, il
        diff di `-L` romperebbe il formato dei record) e `-Lstart,end:path`.
-   [x] `GitBackend.search(query: HistoryQuery)`; parse al confine IPC; MCP passa l'oggetto e dichiara
        i nuovi argomenti.
-   [x] UI: il suggerimento della sintassi compare sotto il campo quando è vuoto e ha il fuoco; resta
        finché c'è un filtro attivo.
-   [x] Test: parsing dei nuovi prefissi, errori degli intervalli, forma degli argomenti, e quattro
        ricerche vere (regex, pickaxe, diff, righe) sul repository di prova.
-   [x] README (italiano e inglese), `docs/mcp.md`, CHANGELOG, registro, TODO, ROADMAP.

## Rischi

-   **Regex dell'utente**: `regex:` è una regex estesa, quindi può essere lenta su storia enorme. Il
    limite resta 500 commit e Git la valuta su ogni messaggio; una regex patologica è responsabilità di
    chi la scrive, come in `git log --grep`.
-   **`-L`**: vale solo sul ramo corrente perché `--all` non è ammesso da Git con `-L`; la finestra lo
    dice nella documentazione, non nel campo.
-   **Combinazioni**: `change:` e `diff:` si sommano (AND) con gli altri filtri; testo e regex no,
    perché Git li tratterebbe in OR.

## Verifica

```bash
npm run typecheck && npm test && npm run build
```

Le prove vere sono in `tests/search.test.mts`: un repository temporaneo con tre commit, un ramo e un
file modificato due volte.

## Prompt per riprendere

> In `~/Projects/githandler` leggi `docs/plans/2026-11-09-ricerca-avanzata.md`. La ricerca avanzata è
> fatta; la prossima voce della roadmap è il pannello reflog con «vai al commit per SHA», poi le
> notifiche CI dal tray. Regole: codice in inglese, UI bilingue via `src/renderer/i18n.ts`. Verifica
> con `npm run typecheck && npm test && npm run build`, aggiorna registro, CHANGELOG e TODO.
