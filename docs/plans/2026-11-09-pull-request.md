# Pull request e merge request dall'app

> Elenco delle richieste aperte sul servizio del repository e creazione da due rami, per GitHub,
> GitLab, Gitea/Forgejo e Bitbucket. Creato il 2026-11-09.

## Obiettivo

Oggi per aprire una pull request bisogna uscire dall'app e andare sul sito. Il flusso quotidiano
finisce lì: commit, push, e poi il browser. Questa fase porta dentro la finestra le due cose che
servono davvero: **vedere** le richieste aperte e **crearne** una dai rami che sono già stati inviati.

Fuori perimetro, per ora: commenti e revisioni, stato dei check per richiesta (fase successiva della
roadmap), merge della richiesta dall'app, richieste fra fork (l'API vuole `owner:branch` su GitHub e
`source_project_id` su GitLab).

## Contesto

-   `src/core/providers.ts`: account e provider, `authHeaders`, `remoteIdentity`, `remoteWeb`.
    Gli account sono metadati su disco, il token vive in memoria (`src/main/accounts.ts`).
-   `src/main/actions.ts`: esempio completo di chiamata all'API con il token dell'account scelto per
    il repository. La nuova parte segue lo stesso schema: indirizzi e parser nel core, `fetch` nel main.
-   `src/main/fork.ts`: stesso `context()` (remoto `origin`, account, token).
-   IPC: `src/shared/api.ts` (contratto e canali), `src/preload/index.ts`, `src/main/index.ts`.
-   UI: dialogo `#actions-dialog` come modello (elenco `.repo-list`, stato, pulsanti).

## Passi

-   [x] `src/core/pulls.ts`: tipo `PullRequest`, `PullList`, `NewPullRequest`; indirizzi per elenco,
        creazione, pagina web della richiesta e pagina dell'elenco; corpo della richiesta per servizio;
        parser per le quattro forme (`number`/`iid`/`id`, `head.ref`, `source.branch.name`), stato
        normalizzato (`open`/`closed`/`merged`), bozza, ordinamento dalla più recente.
-   [x] Validazione: titolo non vuoto, rami diversi, nome di ramo senza spazi, caratteri di controllo,
        trattino iniziale o `..`; un indirizzo che arriva dall'API si accetta solo se è `https` e resta
        sull'host dell'account (niente `file://` o altri domini da una risposta).
-   [x] `src/main/pulls.ts`: `listPulls` e `createPull` con il contesto del repository, errori leggibili
        (`message` o `error.message` dell'API), timeout di 20 s, token mai scritto.
-   [x] IPC `pulls:list` / `pulls:create`, contratto in `src/shared/api.ts`, preload.
-   [x] UI: dialogo «Pull request» (titolo «Merge request» su GitLab) con elenco, bozza, apertura nel
        browser, modulo di creazione con valori proposti (ramo corrente e `main`/`master`), stato ed
        errori. Voce nel menu della scheda del repository e nella palette.
-   [x] Test `tests/pulls.test.mts`: indirizzi per i quattro servizi, corpi delle richieste, validazioni,
        parsing delle risposte vere ridotte, indirizzi non affidabili, ordinamento.
-   [x] Screenshot: la palette apre il dialogo; verifica della resa in inglese.

## Rischi

-   **Rami non ancora inviati**: il servizio risponde con un errore; il dialogo lo mostra e non
    inventa un push. Il messaggio dice che i rami vanno inviati prima.
-   **Fork**: una richiesta da un fork vuole il nome completo del ramo di partenza. Non è coperto:
    il campo accetta il nome semplice e l'API spiega il rifiuto.
-   **Token**: senza account o con token scaduto la finestra dice cosa manca; non c'è un percorso che
    usi un token di un altro host.
-   **Nomi**: nessun nome di altri client Git; «pull request» e «merge request» sono i termini dei
    servizi.

## Verifica

```bash
npm run typecheck && npm test && npm run build
GITHANDLER_LOCALE=en npm run shots -- --repo /tmp/gitdemo --shots-output /tmp/shots-pulls/app.png
```

La prova senza rete mostra l'errore atteso (remoto assente o account mancante) e la resa del dialogo;
il parsing e gli indirizzi sono coperti dai test.

## Prompt per riprendere

> In `~/Projects/githandler` leggi `docs/plans/2026-11-09-pull-request.md`. Fase: pull request e merge
> request nell'app (elenco e creazione), fatta; la prossima voce della roadmap è lo stato dei check per
> richiesta e le notifiche CI dal tray. Regole: codice in inglese, UI bilingue via
> `src/renderer/i18n.ts`, nessun nome di altri client Git. Verifica con
> `npm run typecheck && npm test && npm run build`, aggiorna registro, CHANGELOG e TODO.
