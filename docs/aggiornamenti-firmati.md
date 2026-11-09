# Aggiornamenti firmati

L'applicazione può controllare se esiste una versione nuova e scaricarla, ma solo se il pacchetto
porta una firma che corrisponde alla chiave pubblicata con l'app. Il feed è un elenco: la fiducia
arriva dalla firma, non dall'indirizzo da cui arriva il file.

## Come funziona

1.  Nelle impostazioni, sezione **Aggiornamenti**, si mette l'indirizzo `https` del feed. Vuoto
    significa spento: l'app non contatta nessun server.
2.  La palette dei comandi ha **Aggiornamenti…**: legge il feed, confronta le versioni e mostra
    l'ultima release più nuova di quella installata, con le note.
3.  **Scarica e verifica** scarica il pacchetto e fa due controlli: la firma Ed25519 della release
    (testo canonico: versione, indirizzo, digest) e il digest SHA-256 del file scaricato. Se uno dei
    due non torna, il file non viene scritto.
4.  **Apri il pacchetto** passa il file verificato all'installatore del sistema. L'app non installa
    niente da sola e non avvia il pacchetto: l'ultima parola resta all'utente.

## Formato del feed

```json
{
	"releases": [
		{
			"version": "0.11.0",
			"url": "https://esempio.org/githandler/githandler_0.11.0_amd64.deb",
			"sha256": "…64 caratteri esadecimali…",
			"signature": "…firma Ed25519 in base64…",
			"notes": "Cosa cambia in questa versione",
			"date": "2026-11-10"
		}
	]
}
```

Il parser (`parseFeed` in `src/core/update.ts`) scarta le voci con versione non valida, indirizzo
non `https`, digest che non è SHA-256 o firma malformata. Un file corrotto produce un feed vuoto.

## Firmare una release

La chiave privata resta un file locale e non entra mai nel repository; quella pubblica va in
`build/update-key.pub` e viaggia con i pacchetti (`resources/app/build/update-key.pub`).

```bash
openssl genpkey -algorithm ed25519 -out update-key.pem
openssl pkey -in update-key.pem -pubout -out build/update-key.pub

node build/sign-update.mjs update-key.pem \
    release/githandler_0.11.0_amd64.deb \
    https://esempio.org/githandler/githandler_0.11.0_amd64.deb \
    0.11.0
```

Il comando stampa la voce JSON da mettere in `releases`. Senza `build/update-key.pub` l'app dice
«Chiave pubblica degli aggiornamenti assente» e non scarica nulla: è lo stato attuale del
repository, che non ha una chiave né un feed pubblicato.

## Cosa è firmato e cosa no

-   **Firmati**: versione, indirizzo e digest, una riga ciascuno, con l'intestazione
    `githandler-update/1`. Cambiare uno di questi campi invalida la firma.
-   **Non firmate**: `notes` e `date`. Sono testo informativo, mostrato con `textContent` (mai
    interpretato come HTML). Un feed compromesso può cambiarle, non può cambiare il pacchetto che
    l'app accetta.

## Limiti voluti

-   Feed e pacchetto devono stare su `https`: un indirizzo in chiaro viene rifiutato prima di
    qualunque richiesta.
-   Timeout di 30 secondi e tetto di 512 MiB per il pacchetto: un server lento o un file enorme sono
    errori, non attese senza fine.
-   I pacchetti finiscono in `<temp>/githandler-updates`; il pulsante «Apri» accetta solo percorsi
    dentro quella cartella.
-   Le release pre-rilascio (`0.11.0-beta.1`) non superano la versione definitiva: la stessa regola
    del confronto semantico.

## Verifica

```bash
node --test tests/update.test.mts
```

I test generano una coppia di chiavi Ed25519, firmano release vere e sostituiscono `fetch`: la
firma sbagliata, il digest sbagliato, l'errore del server e l'indirizzo in chiaro sono provati senza
rete. Una prova con un feed pubblicato e un pacchetto reale resta da fare.
