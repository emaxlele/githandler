# Gestire il remoto `upstream` dei fork (2026-11-10)

## Obiettivo

Dare un posto dove vedere e cambiare il remoto `upstream` — quello che nei fork punta al repository
originale — invece di dipendere da `git remote add` nel terminale: mostrare l'originale e l'indirizzo
in uso, permettere di impostarlo, cambiarlo o toglierlo, senza toccare commit e rami.

## Contesto

-   `src/core/fork.ts` conosce già il parent di un fork (`ForkParent`, letto dall'API del provider) e
    i rami dell'originale (`parseRemoteBranches`); `src/main/fork.ts` crea il remoto `upstream` da
    solo la prima volta che si sincronizza (`ensureUpstream`) e non lo cambia mai.
-   Oggi l'unico modo per cambiare quell'indirizzo è il terminale, e `git remote add upstream` con un
    remoto già presente fallisce: chi ha sbagliato namespace o vuole passare da HTTPS a SSH resta
    fermo. `forkInfo().upstreamUrl` dice solo se c'è.
-   L'API del provider è rete: la finestra deve aprirsi subito con quello che il repository dice da
    solo (`git remote -v`, `git remote get-url upstream`) e riempire l'originale quando la risposta
    arriva. Se non arriva, lo dice senza bloccare niente.
-   Regole di sicurezza già in vigore: nessun valore che cominci con `-` può finire in un argomento di
    Git, e i percorsi restano dentro il repository. Il nuovo indirizzo è un argomento di
    `git remote add/set-url`: va validato nel core, non nella finestra.

## Passi

-   [x] Core (`src/core/fork.ts`): `parseRemotes` (righe di `git remote -v`), `checkRemoteUrl`
        (rifiuta opzioni, caratteri di controllo e spazi in un URL), `remoteUrlKey` (forma
        confrontabile di due indirizzi: schema, utente e `.git` non contano) e `describeUpstream`
        (stato `missing` / `aligned` / `different` / `configured`, remoto che punta già all'originale,
        indirizzo consigliato).
-   [x] Main: `listRemotes` in `src/main/remote.ts`; in `src/main/fork.ts` `upstreamRemotes` (solo
        git, nessuna rete), `setUpstream` (`remote add` o `set-url`), `removeUpstream` (`remote
        remove`, errore esplicito se non c'è).
-   [x] Contratto: tre metodi in `src/shared/api.ts`, tre canali `repo:upstream*`, preload e handler
        in `src/main/index.ts`.
-   [x] Finestra: voce «Remoto dell'originale…» nel menu della scheda, accanto alle due
        «Sincronizza con l'originale»; dialog con originale, indirizzo attuale, stato, campo per
        l'indirizzo e pulsanti Salva / Rimuovi / Chiudi. L'originale arriva dopo, senza bloccare
        l'apertura.
-   [x] Catalogo inglese per tutte le stringhe nuove, compresi i messaggi di validazione del core.
-   [x] Test: core puro in `tests/fork.test.mts`, backend contro git vero in un repository temporaneo
        (aggiunta, cambio, rimozione, rifiuto di un indirizzo che sembra un'opzione).
-   [x] Documentazione: CHANGELOG, README italiano e inglese, `docs/registro-attivita.md`, TODO se la
        sezione esiste.
-   [x] `npm run typecheck && npm test && npm run build` (297 test).

## Rischi

-   `git remote -v` elenca anche il lato push: si tiene solo `(fetch)`, che è quello che l'app usa.
-   Il confronto fra indirizzi non è una prova crittografica: serve a dire «sembra lo stesso
    repository», non a garantire che sia lo stesso. Forme esotiche (porte, path con `~`) restano
    `different` e non bloccano niente.
-   `git remote remove` porta via anche i ref `refs/remotes/upstream/*`: la finestra lo dice
    («i riferimenti già scaricati da lì vengono rimossi») e rami locali e commit non vengono toccati.
-   Il remoto si chiama `upstream` come da convenzione: se un fork usa un altro nome, l'app non lo
    indovina e lo dice (nessun remoto `upstream`).

## Verifica

```bash
npm run typecheck && npm test && npm run build
```

Nei test del backend: repository temporaneo, `setUpstream` crea e poi cambia l'URL, `removeUpstream`
lo toglie, `upstreamRemotes` riflette il cambiamento, un indirizzo che comincia con `-` viene rifiutato
prima di arrivare a Git. Nella finestra: dialog aperto su un repository senza `upstream`, aggiunta con
l'indirizzo suggerito, modifica e rimozione, con il menu della scheda che riflette lo stato.

## Resume prompt

GitHandler could create the `upstream` remote of a fork while syncing but never let the user see or
change it. This work adds upstream management: pure helpers in `src/core/fork.ts`
(`parseRemotes`, `checkRemoteUrl`, `remoteUrlKey`, `describeUpstream`), backend functions in
`src/main/fork.ts` (`upstreamRemotes`, `setUpstream`, `removeUpstream`) exposed as `repo:upstream*`
channels, and a dialog reached from the repository tab menu that shows the original repository, the
current address and its state, and can set, change or remove the remote without touching commits.
Finish with real-git tests, the bilingual catalogue, the changelog, the README in both languages and
`docs/registro-attivita.md`, then run `npm run typecheck && npm test && npm run build`.
