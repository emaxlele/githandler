# Aggiornamenti firmati

## Obiettivo

L'applicazione legge un feed `https` di release, ne verifica la firma, scarica il pacchetto, ne
controlla il digest e lo passa all'installatore del sistema. Nessuna installazione automatica,
nessuna richiesta di rete quando il feed non è configurato.

## Contesto

-   `src/core/settings.ts` normalizza un file JSON scritto a mano; ogni campo nuovo è un'aggiunta
    con un default, non una migrazione.
-   `src/main/index.ts` registra i canali IPC con `handle(...)`; `src/shared/api.ts` dichiara il
    contratto `GitApi` e i nomi dei canali; `src/preload/index.ts` li espone al renderer.
-   `src/renderer/app.ts` ha un catalogo di comandi per la palette e una sezione per ogni finestra.
-   Non esistono chiavi né feed pubblicati: la funzione deve funzionare (e dire «non configurato»)
    senza.

## Scelte

-   **Ed25519 con `node:crypto`**, non `gpg`: nessun binario esterno, verifica sincrona, test che
    generano una coppia di chiavi in memoria. La firma copre il testo canonico
    (`githandler-update/1` + versione + indirizzo + digest), quindi l'indirizzo non è modificabile a
    firma invariata.
-   **Il digest si controlla dopo il download**, non solo la firma: la firma dice che la release è
    nostra, l'impronta dice che il file è quello della release.
-   **La chiave pubblica viaggia con l'app** (`build/update-key.pub` in `resources/app/build/`), non
    nel feed: chi controlla il feed non può firmarsi da solo un aggiornamento.
-   **Il feed è una preferenza**, non un URL cablato: vuoto = spento, e nessuna telefonata a casa
    quando l'utente non lo configura.
-   **Niente installazione automatica**: il pacchetto verificato resta in `<temp>/githandler-updates`
    e solo il pulsante «Apri» lo passa a `shell.openPath`; l'IPC ricontrolla che il percorso stia lì.
-   **Le note non sono firmate**: sono testo mostrato con `textContent`, non comandi. Un feed
    compromesso può cambiarle, non può cambiare il pacchetto accettato.
-   **Messaggi del main tradotti nel renderer**: `t(readableError(error))` sul catalogo, così anche
    gli errori del processo principale escono nella lingua scelta.

## Passi

-   [x] Core: `parseFeed`, `compareVersions`, `isNewer`, `pickRelease`, `checkUpdate`,
        `canonicalRelease`, `verifyRelease`, `sha256Hex`.
-   [x] Trasporto: `fetchFeed`, `downloadUpdate`, `readUpdateKey` in `src/main/update.ts`, con
        `https` obbligatorio, timeout 30 s e tetto 512 MiB.
-   [x] Impostazioni: `updates.feedUrl` normalizzato (`https` o vuoto) e campo nella finestra.
-   [x] IPC `app:updateCheck`, `app:updateDownload`, `app:updateOpen`, con la chiave letta da
        `build/update-key.pub` e il controllo del percorso del pacchetto.
-   [x] UI: finestra _Aggiornamenti…_ dalla palette, stato, note, «Scarica e verifica», «Apri il
        pacchetto»; voci italiane e inglesi, compresi gli errori del main.
-   [x] Comando per chi pubblica: `build/sign-update.mjs` (digest + firma + voce JSON).
-   [x] Packaging: le quattro ricette copiano `build/update-key.pub` quando esiste.
-   [x] Test: `tests/update.test.mts` (8 casi) e il caso del feed nella normalizzazione delle
        impostazioni.
-   [x] Documentazione: `docs/aggiornamenti-firmati.md`, README (italiano e inglese), CHANGELOG,
        TODO, ROADMAP, registro attività.

## Rischi

-   Senza chiave pubblicata la funzione resta spenta: è voluto, ma vuol dire che finché il
    maintainer non genera la coppia di chiavi non c'è nessun aggiornamento possibile.
-   Le note non firmate possono essere cambiate da chi controlla il feed: il testo è mostrato, mai
    eseguito, ma resta un canale di persuasione.
-   `shell.openPath` apre il pacchetto con l'applicazione associata: su un sistema senza
    l'installatore giusto il file si apre con qualcos'altro. Il percorso verificato è dentro la
    cartella dell'app, ma non è una garanzia sull'associazione.
-   Il pacchetto non viene cancellato dopo l'apertura: la cartella temporanea cresce finché il
    sistema non la svuota.

## Verifica

```bash
npm run typecheck && npm test && npm run build
node build/sign-update.mjs /percorso/chiave.pem /percorso/pacchetto https://esempio.org/x.deb
GITHANDLER_LOCALE=en npm run shots -- --repo /tmp/gitdemo --shots-output /tmp/shots/app.png
```

## Resume prompt

GitHandler now checks signed updates: `src/core/update.ts` parses an https release feed, compares
versions, and verifies an Ed25519 signature over `canonicalRelease` (version, url, sha256);
`src/main/update.ts` fetches the feed, downloads the package, checks the digest and returns it;
`src/main/index.ts` wires `app:updateCheck`, `app:updateDownload`, `app:updateOpen` reading the key
from `build/update-key.pub` and only opening files inside `<temp>/githandler-updates`. The renderer
has the _Aggiornamenti…_ palette command and the settings field `updates.feedUrl`; `build/sign-update.mjs`
signs a package. Verify with `npm run typecheck && npm test && npm run build`, then generate the real
key pair, publish a feed and try a real update; update CHANGELOG, TODO, ROADMAP, README and
`docs/registro-attivita.md`.
