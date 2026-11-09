# Revisioni: chiedere modifiche e ritirare l'approvazione

## Obiettivo

Completare il pannello _Revisioni_: oltre all'approvazione, offrire «chiedi modifiche» e «ritira
l'approvazione» dove il servizio le espone all'autore, senza mai mostrare un pulsante che finisce
in un errore di permessi.

## Contesto

-   `src/core/reviews.ts` conosceva una sola azione: `reviewsUrl`, `approveUrl`, `approvePayload`,
    `parseReviewSummary`. Il commento in testa diceva esplicitamente che le altre due restavano
    fuori.
-   Il trasporto vive in `src/main/pulls.ts` (`pullReviews`, `approvePull`), l'IPC in
    `src/shared/api.ts`, `src/preload/index.ts` e `src/main/index.ts`.
-   Il renderer disegna la riga nella lista delle pull request (`renderPullItem`) e il riepilogo in
    `renderReviewSummary`; il servizio non era disponibile lì, quindi è stato passato come
    `ProviderId` da `pullsCache.provider`.
-   `toast()` accetta solo `"ok" | "error"`: non esiste una severità di avviso.

## Scelte

-   **Matrice di supporto nel core** (`supportsReviewAction`): «chiedi modifiche» ovunque tranne
    GitLab, che non ha lo stato; il ritiro solo su GitLab e Bitbucket, perché GitHub e Gitea
    richiedono permessi da maintainer per dismissare una review.
-   **Una sola funzione** (`reviewActionRequest`) restituisce indirizzo, metodo e corpo, oppure
    `null` se il servizio non offre l'azione: la UI decide su `supportsReviewAction`, il main non
    inventa richieste.
-   **Differenze dei servizi**: GitHub e Gitea passano dalla review con `event: REQUEST_CHANGES` e il
    messaggio è obbligatorio (max 60.000 caratteri); Bitbucket ha `POST .../request-changes` senza
    corpo; il ritiro è `POST .../unapprove` su GitLab e `DELETE .../approve` su Bitbucket.
-   **Stato riletto dopo ogni azione**: le risposte dei quattro servizi sono troppo diverse per
    essere la verità.
-   **Ultima review vince** su GitHub e Gitea, con le due grafie dello stato (`CHANGES_REQUESTED`
    GitHub, `REQUEST_CHANGES` Gitea); Bitbucket usa `state: changes_requested` nei partecipanti.
-   **Testo sempre dal catalogo i18n**: pulsanti, tooltip, motivo e conferme.

## Passi

-   [x] Core: `ReviewAction`, `supportsReviewAction`, `reviewActionRequest`, `changesRequested` nel
        riepilogo e ultima review per persona.
-   [x] Trasporto in `src/main/pulls.ts` con `readReviewSummary` condiviso; IPC e preload.
-   [x] UI: pulsanti nel riepilogo, finestra del motivo, conferme, messaggi; `toast` con la severità
        ammessa.
-   [x] Catalogo inglese e `.review-actions` nel foglio di stile.
-   [x] Test: matrice di supporto, indirizzi e corpi, messaggio obbligatorio e limite, ultima review.
-   [x] Documentazione: README (italiano e inglese), CHANGELOG, TODO, ROADMAP, registro attività.

## Rischi

-   Su GitHub non si possono chiedere modifiche alla propria pull request: il servizio risponde con
    un errore e l'app lo mostra, invece di nascondere il pulsante (servirebbe sapere chi ha aperto la
    richiesta).
-   Un'approvazione scritta prima di un nuovo commit può diventare obsoleta: la regola «ultima review
    vince» segue quella dei servizi, che è quanto si vede nella pagina web.
-   Il limite di 60.000 caratteri è validato nel core ma non nell'input: un testo più lungo mostra
    l'errore al momento della conferma.

## Verifica

```bash
npm run typecheck && npm test && npm run build
GITHANDLER_LOCALE=en npm run shots -- --repo /tmp/gitdemo --shots-output /tmp/shots/app.png
```

## Resume prompt

Finish the pull-request reviews panel in GitHandler: `src/core/reviews.ts` exposes
`supportsReviewAction` and `reviewActionRequest` for "request changes" (GitHub, Gitea, Bitbucket;
message required for GitHub/Gitea) and "withdraw approval" (GitLab, Bitbucket only), and
`parseReviewSummary` returns `changesRequested` with the latest review per person winning on GitHub
and Gitea. The renderer shows the buttons only where the provider supports them. Verify with
`npm run typecheck && npm test && npm run build`, then update CHANGELOG, TODO, ROADMAP, README and
`docs/registro-attivita.md`.
