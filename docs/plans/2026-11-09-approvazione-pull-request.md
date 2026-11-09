# Approvazione delle pull request

## Obiettivo

Dopo aver letto i commenti, approvare una pull request dalla finestra dell'app, con lo stato di chi
ha già approvato, per GitHub, GitLab, Gitea/Forgejo e Bitbucket.

## Contesto

-   Approvare non è la stessa chiamata ovunque: GitHub e Gitea creano una review con
    `event` (`APPROVE` per GitHub, `APPROVED` per Gitea); GitLab ha
    `POST /merge_requests/{iid}/approve`; Bitbucket `POST /pullrequests/{id}/approve`.
-   Anche lo stato arriva da fonti diverse: lista delle review (GitHub, Gitea), `approved_by`
    (GitLab), `participants` con `approved` (Bitbucket).
-   Ritirare l'approvazione e «chiedi modifiche» non sono disponibili su tutti e quattro i servizi
    nello stesso modo: restano nella pagina web, e il TODO lo dice.
-   L'approvazione è visibile agli altri: la UI chiede conferma prima di inviarla.

## Passi

-   [x] `src/core/reviews.ts`: `ReviewSummary`, `reviewsUrl`, `approveUrl`, `approvePayload`,
        `parseReviewSummary`; le review respinte o ritirate non contano e la stessa persona non conta
        due volte.
-   [x] `src/main/pulls.ts`: `pullReviews` e `approvePull`, che rilegge lo stato dopo il `POST`.
-   [x] IPC `pulls:reviews` / `pulls:approve`, preload e tipi condivisi.
-   [x] Pulsante «Revisioni» su ogni richiesta, pannello con stato, nomi e pulsante «Approva» solo su
        richieste aperte e non ancora approvate; conferma prima dell'invio; i18n.
-   [x] Test `tests/reviews.test.mts` (indirizzi, corpi, risposte dei quattro servizi, casi vuoti).
-   [x] README (IT/EN), CHANGELOG, TODO, ROADMAP e registro attività.

## Rischi

-   Un'approvazione può essere respinta da regole del repository (review obbligatorie, permessi,
    branch protetti): l'errore del servizio si mostra così com'è.
-   Su GitLab il conteggio dipende dalla configurazione delle approvazioni del progetto; se l'endpoint
    non è disponibile, la finestra lo dice invece di mostrare zero.
-   Gitea e GitHub tengono la review come storico: un'approvazione precedente non sparisce se poi si
    commenta, quindi conta ancora. È il comportamento del servizio, non una scelta dell'app.

## Verifica

```bash
npm run typecheck && npm test && npm run build
```

Il pannello è stato controllato in inglese su un repository di prova; l'approvazione reale richiede
un remoto su un servizio web e un account collegato.

## Resume prompt

Leggi `docs/plans/2026-11-09-approvazione-pull-request.md`. L'approvazione è completa: «Revisioni»
legge chi ha approvato e permette di approvare con una conferma, quattro servizi normalizzati in
`src/core/reviews.ts`. Se riprendi, verifica che una richiesta già approvata non mostri il pulsante,
che una richiesta chiusa non lo mostri e che lo stato si aggiorni dopo l'invio. Poi passa al prossimo
elemento di `TODO.md`.
