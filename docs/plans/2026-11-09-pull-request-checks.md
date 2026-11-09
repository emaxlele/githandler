# Controlli delle pull request

> Esito dei controlli automatici sul commit in testa a una pull request, dentro la finestra delle
> richieste. Creato il 2026-11-09.

## Obiettivo

Prima di unire una richiesta la domanda è una: «i controlli sono passati?». Finora la risposta stava
solo sul sito. Questa fase mette il riepilogo nella riga della pull request, con un pulsante che legge
i controlli quando serve, senza pagare la chiamata per ogni richiesta dell'elenco.

Fuori perimetro: ri-eseguire i controlli da qui (le GitHub Actions hanno già la loro finestra) e le
notifiche dal tray, che sono la fase successiva.

## Contesto

-   `src/core/pulls.ts` e `src/main/pulls.ts`: elenco e creazione delle richieste, con il contesto
    (remoto `origin`, account scelto, token) e un `request` con timeout ed errori leggibili.
-   `src/main/actions.ts`: esempio di chiamata all'API con `authHeaders`; le GitHub Actions restano il
    posto dove ri-eseguire o annullare un workflow.
-   `src/renderer/app.ts`: `renderPullItem` disegna una riga dell'elenco; il dialogo `#pulls-dialog`
    contiene elenco e modulo di creazione.
-   `PullRequest` non aveva lo SHA del ramo: senza, non c'è un indirizzo da chiedere.

## Passi

-   [x] `PullRequest.headSha`: `head.sha` su GitHub/Gitea, `sha` su GitLab, `source.commit.hash` su
        Bitbucket; una richiesta senza SHA resta valida, con il pulsante spento.
-   [x] `src/core/checks.ts`: `CheckRun` (`ok`/`failed`/`pending`/`neutral`), `CheckSummary`,
        `assertCommitSha` (7–64 cifre esadecimali), `checksUrl` per i quattro servizi, `parseChecks`
        delle quattro risposte, `summarizeChecks` (il peggiore vince, senza controlli `none`).
-   [x] Indirizzi web dei controlli accettati solo se `https` e sull'host dell'account.
-   [x] `src/main/pulls.ts`: `pullChecks(root, sha)` riusa `contextFor` e `request`; IPC
        `pulls:checks`, contratto e preload.
-   [x] UI: pulsante _Controlli_ per riga, riepilogo colorato (verde solo con un successo e nessun
        rosso), elenco dei controlli con dettaglio e apertura nel browser, stato di lettura ed errore.
-   [x] Test `tests/checks.test.mts` (8 casi) e `headSha` nei campioni di `tests/pulls.test.mts`.
-   [x] README (italiano e inglese), CHANGELOG, registro, TODO, ROADMAP.

## Rischi

-   **Servizi diversi**: ogni provider ha nomi e stati propri; la traduzione sta in un solo punto e
    uno stato sconosciuto diventa «in corso», mai verde.
-   **GitHub**: le check run dei workflow e i vecchi status sono due elenchi; qui si leggono le check
    run, che sono quelle dei workflow moderni. Un repository che usa solo i vecchi status mostrerà
    «Nessun controllo», non un errore.
-   **Rate limit**: una chiamata per pulsante premuto, non una per riga; nessun polling.

## Verifica

```bash
npm run typecheck && npm test && npm run build
```

I test coprono indirizzi, SHA non validi, le quattro risposte ridotte e il riepilogo. La prova dal
vivo richiede un repository con account e controlli reali: in un repository senza remoto la finestra
delle pull request mostra l'errore già noto, come prima.

## Prompt per riprendere

> In `~/Projects/githandler` leggi `docs/plans/2026-11-09-pull-request-checks.md`. I controlli delle
> pull request sono fatti; la prossima voce è «notifiche CI dal tray», che richiede una sessione
> desktop per la verifica. Regole: codice in inglese, UI bilingue via `src/renderer/i18n.ts`, nessun
> nome di altri client Git. Verifica con `npm run typecheck && npm test && npm run build`, aggiorna
> registro, CHANGELOG e TODO.
