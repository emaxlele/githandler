# Avvio di un workflow e tentativi delle esecuzioni

## Obiettivo

Avviare un workflow di GitHub Actions dall'app, sul ramo o tag scelto e con gli input che il workflow
dichiara, e distinguere nell'elenco i tentativi di una stessa esecuzione.

## Contesto

-   GitHub espone `GET /repos/{owner}/{repo}/actions/workflows` per l'elenco e
    `POST /repos/{owner}/{repo}/actions/workflows/{id}/dispatches` per avviare un workflow con
    `workflow_dispatch`. Solo GitHub: gli altri servizi non hanno la stessa API.
-   Il dispatch accetta `{ ref, inputs }`, dove `inputs` è un oggetto di **stringhe** e al massimo
    dieci voci; un workflow senza `workflow_dispatch` risponde 422 con il proprio messaggio.
-   Gli indirizzi e la validazione stanno nel core (`src/core/actions.ts`), la rete e il token in
    `src/main/actions.ts`, che riusa `contextFor` (remoto `origin`, account, token).
-   `run_attempt` è già nella risposta delle esecuzioni: basta portarlo nella forma comune.

## Passi

-   [x] `src/core/actions.ts`: `WorkflowInfo`, `workflowsUrl`, `parseWorkflows`,
        `assertWorkflowRef`, `dispatchPayload`, `dispatchWorkflowUrl`; `attempt` su `WorkflowRun`.
-   [x] `src/main/actions.ts`: `listWorkflows` (solo attivi) e `dispatchWorkflow`.
-   [x] IPC `actions:workflows` / `actions:dispatch`, preload e tipi condivisi.
-   [x] Finestra «Avvia un workflow»: elenco, ramo precompilato, input JSON, stato, i18n.
-   [x] Pulsante nella finestra delle Actions; comando «GitHub Actions…» nella palette.
-   [x] Tentativo mostrato accanto a stato, ramo, evento e data.
-   [x] Test `tests/actions.test.mts` (indirizzi, parser, validazione degli input, tentativi).
-   [x] README (IT/EN), CHANGELOG, TODO, ROADMAP e registro attività; screenshot delle due finestre.

## Rischi

-   La lista dei workflow non dice quali dichiarano `workflow_dispatch`: un workflow senza l'evento
    viene rifiutato da GitHub e il messaggio si mostra. Non si indovina leggendo i file del
    repository.
-   Gli input sono solo stringhe: GitHub stesso li tratta così. Un numero scritto come `1` viene
    rifiutato prima della rete invece di essere convertito in silenzio.
-   Il dispatch non rilegge il file del workflow: un input con un nome che il workflow non dichiara
    viene ignorato o rifiutato dal servizio, non dall'app.

## Verifica

```bash
npm run typecheck && npm test && npm run build
GITHANDLER_LOCALE=en npm run shots -- --repo /tmp/gitdemo --shots-output /tmp/shots/app.png
```

Le due finestre sono state controllate in inglese su un repository di prova; l'avvio reale richiede
un remoto GitHub e un account collegato.

## Resume prompt

Leggi `docs/plans/2026-11-09-avvio-workflow.md`. L'avvio di un workflow è completo: elenco dei
workflow attivi, ramo o tag, input JSON validati in `dispatchPayload`, e il numero del tentativo
accanto a ogni esecuzione. Se riprendi, verifica che un input numerico venga rifiutato prima della
rete, che un workflow senza `workflow_dispatch` mostri il messaggio di GitHub e che dopo l'avvio
l'elenco si aggiorni. Poi passa al prossimo elemento di `TODO.md`.
