# Discussione delle pull request

## Obiettivo

Leggere i commenti di una pull request e rispondere dalla finestra dell'app, per GitHub, GitLab,
Gitea/Forgejo e Bitbucket, senza aprire il browser.

## Contesto

-   I quattro servizi non chiamano la conversazione allo stesso modo: GitHub e Gitea usano i commenti
    di una issue (`/issues/{n}/comments`), GitLab le `notes` della merge request, Bitbucket
    `/pullrequests/{id}/comments` con il testo in `content.raw`.
-   La forma comune sta in `src/core/comments.ts`; il trasporto e il token restano in
    `src/main/pulls.ts`, che riusa `contextFor` (remoto `origin`, account scelto, token).
-   Il testo di un commento arriva dall'esterno: si mostra sempre come testo (`textContent`), mai
    come HTML. La formattazione del servizio resta nella pagina web.
-   Le revisioni (approva / chiedi modifiche) non entrano in questo lavoro: le API non concordano.

## Passi

-   [x] `src/core/comments.ts`: `commentsUrl`, `commentPayload`, `parseComments`, `parseComment`; i
        commenti di sistema (GitLab), le risposte su una riga e i commenti cancellati (Bitbucket) si
        scartano; un commento vuoto o oltre 60.000 caratteri non parte.
-   [x] `src/main/pulls.ts`: `pullComments` e `addPullComment` con lo stesso `contextFor`.
-   [x] IPC `pulls:comments` / `pulls:comment`, preload e tipi condivisi.
-   [x] Finestra «Discussione»: elenco con autore, data e collegamento, casella per il nuovo
        commento, aggiornamento, apertura nel browser, i18n.
-   [x] Test `tests/comments.test.mts` (indirizzi, corpo, risposte vere dei quattro servizi, voci
        scartate, ordine cronologico).
-   [x] README (IT/EN), CHANGELOG, TODO, ROADMAP e registro attività.

## Rischi

-   Il testo non viene interpretato: un elenco puntato o una menzione si vedono come testo. È una
    scelta di sicurezza, non una mancanza.
-   Bitbucket restituisce anche i commenti in revisione: si mostrano solo quelli della conversazione.
-   Il limite di 50 commenti è per richiesta: una conversazione lunghissima si legge a blocchi dal
    servizio, non tutti insieme.
-   Senza rete o con il token scaduto la finestra mostra l'errore e non perde il testo già scritto.

## Verifica

```bash
npm run typecheck && npm test && npm run build
```

La finestra è stata controllata in inglese su un repository di prova; il contenuto reale richiede un
remoto su un servizio web e un account collegato.

## Resume prompt

Leggi `docs/plans/2026-11-09-commenti-pull-request.md`. La discussione è completa: elenco dei commenti
dal più vecchio, nuovo commento, quattro servizi normalizzati in `src/core/comments.ts`. Se riprendi,
verifica che un commento vuoto non parta, che il testo con caratteri speciali resti testo e che la
finestra si riapra su un'altra richiesta senza mostrare i commenti della precedente. Poi passa al
prossimo elemento di `TODO.md`.
