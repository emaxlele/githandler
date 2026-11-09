# API per l'AI: server MCP

> Server [Model Context Protocol](https://modelcontextprotocol.io) su stdio che espone un repository
> Git: i tool di lettura sono separati da quelli che scrivono, e i secondi vanno abilitati uno per
> uno. Riusa lo stesso backend della UI (`CliGitBackend`), quindi legge e scrive con le stesse regole
> dello stesso output: non esiste una seconda verità.
> Ultimo aggiornamento: 2026-11-09

## Perché

Un agente che lavora su un repository ha bisogno di leggere stato, storia, diff e attribuzione delle
righe; quando gli si chiede di agire, però, servono anche poche operazioni che cambiano il
repository. Il server le espone, ma **mai per default**: la lettura e la scrittura sono due gruppi
distinti, si abilitano dal client delle impostazioni e ogni scrittura lascia una riga nell'audit log
dentro il repository.

## Avvio

```bash
npm run build
node dist/mcp/index.js --repo ~/Projects/qualche-repo
```

Senza `--repo` usa `GITHANDLER_REPO`, altrimenti la directory corrente. Se il percorso non è un
repository, esce con codice 2 e un messaggio su stderr.

Il server parla JSON-RPC a righe: una richiesta per riga su stdin, una risposta per riga su stdout.
Tutto ciò che non è protocollo va su stderr, quindi il canale non si corrompe.

Verifica manuale (con l'API abilitata nelle impostazioni; altrimenti `repo_status` risponde con
l'errore "not enabled"):

```bash
printf '%s\n' \
  '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{}}}' \
  '{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"repo_status","arguments":{}}}' \
  | node dist/mcp/index.js --repo .
```

## Permessi: spento di default

Il server non espone niente finché non lo si abilita dall'app, in **Impostazioni → API per l'AI**.
Prima di collegare un client, quindi, il server risponde a `initialize` ma `tools/list` è vuoto e
qualsiasi `tools/call` restituisce un errore.

| Modo     | Cosa espone                                                        |
| -------- | ------------------------------------------------------------------ |
| `off`    | niente (default)                                                   |
| `read`   | i cinque tool di lettura, mai un tool che scrive                   |
| `all`    | i dieci tool: lettura e scrittura                                  |
| `custom` | solo i tool spuntati nella lista, lettura e scrittura mescolate    |

La modalità `read` non è «tutto tranne la scrittura per ora»: il server ricava il gruppo dal nome del
tool (`API_READ_TOOLS`, `API_WRITE_TOOLS` in `src/core/settings.ts`), quindi non esiste un percorso in
cui una modalità di sola lettura esponga `commit`.

La policy è un file JSON letto a **ogni richiesta**:

```
$GITHANDLER_CONFIG_DIR/githandler/settings.json   # override, per test e installazioni portabili
$XDG_CONFIG_HOME/githandler/settings.json
~/.config/githandler/settings.json              # tipico
```

```json
{
	"api": { "mode": "custom", "tools": ["history", "blame"] },
	"trash": {
		"enabled": true,
		"maxBytes": 26214400,
		"maxFiles": 2000,
		"quotaBytes": 5368709120
	}
}
```

I limiti della copia dei file non tracciati (`trash`) sono in byte: 25 MiB per operazione, 2.000
file per operazione, 5 GiB in totale. Si modificano dall'app; i valori fuori intervallo vengono
riportati dentro al caricamento. Il vecchio `trashUntracked` (v0.4) è ancora letto una volta, per
non perdere la scelta di accensione.

Conseguenze pratiche:

-   **Si cambia dall'app, non dal client.** Il server è un processo figlio del client MCP: non ha un
    canale per ricevere la policy, la rilegge dal disco. Togliere un tool dalle impostazioni lo fa
    sparire alla richiesta successiva, senza riavviare né l'app né il client.
-   **Un file corrotto o assente equivale a `off`.** Il parser scarta campi ignoti, duplicati e
    valori non validi; non esiste un input che apra l'API per errore.
-   **Il client non può allargare i permessi.** `tools/list` è filtrato e `tools/call` ricontrolla:
    chiedere un tool non esposto restituisce `Tool "..." is not enabled in the githandler settings.`,
    non un'esecuzione.
-   **L'app scrive il file in modo atomico** (`settings.json.tmp` + `rename`) con permessi `0600`,
    così un file a metà non può aprire l'API.

## Configurazione

### OpenCode V2

```jsonc title="opencode.jsonc"
{
	"$schema": "https://opencode.ai/config.json",
	"mcp": {
		"servers": {
			"githandler": {
				"type": "local",
				"command": [
					"node",
					"/home/emaxlele/Projects/githandler/dist/mcp/index.js",
					"--repo",
					"/home/emaxlele/Projects/githandler"
				]
			}
		}
	}
}
```

Con `"cwd": "."` e senza `--repo` il server usa la directory del progetto in cui gira OpenCode: è la
forma comoda se lo si vuole in ogni progetto.

### Claude Desktop

```json title="claude_desktop_config.json"
{
	"mcpServers": {
		"githandler": {
			"command": "node",
			"args": [
				"/home/emaxlele/Projects/githandler/dist/mcp/index.js",
				"--repo",
				"/home/emaxlele/Projects/githandler"
			]
		}
	}
}
```

## I tool

Tutti dichiarano uno schema JSON chiuso (`additionalProperties: false`).

### Lettura

| Tool            | Argomenti                                 | Cosa restituisce                                                                                             |
| --------------- | ----------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| `repo_status`   | —                                         | ramo, HEAD staccato, ahead/behind, elenco modifiche con codici index/worktree, ultima operazione annullabile |
| `history`       | `text`, `author`, `file`, `regex`, `change`, `diff`, `lines`, `limit` (1-500) | commit più recenti, con SHA, autore, data ISO, oggetto e genitori                     |
| `show_commit`   | `sha`, `path`                             | metadati e file del commit; con `path` anche il diff unified di quel file                                    |
| `worktree_diff` | `path`, `staged`                          | diff unified di un file nel working tree o nell'indice, con conteggi                                         |
| `blame`         | `path`, `start`, `end`                    | una voce per riga: commit, autore, data, oggetto e testo                                                     |

### Scrittura

Ognuno restituisce la stessa fotografia di `repo_status` dopo l'operazione, così il client vede
subito ramo e modifiche aggiornati. Sono le stesse funzioni del backend usato dalla UI, quindi ogni
modifica compare nell'app e resta annullabile con «Annulla».

| Tool              | Argomenti                | Cosa fa                                                                                          |
| ----------------- | ------------------------ | ------------------------------------------------------------------------------------------------ |
| `stage`           | `paths` (almeno uno)     | mette i file in stage (`git add --`, solo path dentro il repository)                             |
| `unstage`         | `paths` (almeno uno)     | toglie i file dall'indice senza toccare il working tree                                          |
| `commit`          | `message`, `all`         | crea il commit dai file in stage; con `all` mette prima in stage le modifiche dei file tracciati |
| `create_branch`   | `name`                   | crea un ramo su HEAD e ci passa sopra (`git switch -c`)                                          |
| `checkout_branch` | `name`                   | passa a un ramo esistente; se Git rifiuta (modifiche non committate) torna l'errore di Git       |

Un errore di Git o un argomento non valido tornano come contenuto con `isError: true`, non come
crash del server.

### Audit log

Ogni chiamata a un tool di scrittura — riuscita o rifiutata — aggiunge una riga a
`.git/githandler/mcp-audit.jsonl`, accanto al journal di undo:

```json
{"timestamp":"2026-11-09T10:00:00.000Z","tool":"commit","ok":true,"arguments":{"message":"correggi il parser","all":false}}
```

-   **Cosa contiene**: data ISO, nome del tool, esito, argomenti ridotti a scalari (gli oggetti si
    scartano, i testi si tagliano a 200 caratteri, un elenco di path diventa una riga per voce), e il
    messaggio d'errore quando c'è.
-   **Dove**: dentro il repository che descrive, quindi si muove con lui e non finisce in una cartella
    di sistema condivisa fra progetti.
-   **Permessi `0600`**, cartella `0700`: non è un file da leggere ad altri.
-   **Non cresce all'infinito**: superato 1 MiB diventa `mcp-audit.jsonl.1` (uno solo, il precedente
    viene sostituito) e si riparte da un file nuovo.
-   **Non può far fallire un'operazione**: se la scrittura del log non riesce, l'errore va su stderr
    e il repository resta com'è. Lo stato del repository è la verità, il log è la traccia.

Le letture non si registrano: l'audit parla delle conseguenze, non di ogni sguardo.

Esempi di richieste che funzionano bene:

-   `history` con `file: src/main/backend.ts` → chi ha toccato il file e quando;
-   `history` con l'argomento `change` → in quali commit è cambiato il numero di occorrenze di quel
    testo (pickaxe); con `lines` (`"10,40:src/file.ts"`) → la storia di quell'intervallo di righe;
-   `show_commit` con `sha` e `path` → il diff esatto di una modifica, senza aprire l'app;
-   `blame` su una funzione → da quale commit viene quella riga e con quale messaggio;
-   `repo_status` prima di proporre un commit → cosa è in stage e cosa no.

## Garanzie e limiti

-   **Niente è esposto per default.** Con `off` il server non ha tool; i cinque che scrivono non sono
    mai impliciti, non compaiono con `read` e ogni chiamata lascia una riga nell'audit log. Non
    esistono `reset`, `push` o `rebase`: il server fa le poche operazioni che un agente deve poter
    fare, non tutte quelle che Git sa fare.
-   **Un solo strato tocca il disco.** Il server importa `CliGitBackend`; non esegue Git per conto
    suo. Lo stesso vale per i parser: sono quelli del core, testati dalla UI.
-   **Path validati.** I path passano da `assertSafePath`: niente path assoluti, niente `..`, niente
    argomenti che iniziano con `-`.
-   **Niente shell.** `execFile` con argomenti come array.
-   **Limiti dichiarati**: `history` restituisce al massimo 500 commit per chiamata; `blame` legge il
    file intero (usare `start`/`end` su file grandi); i diff sono quelli di Git, senza
    evidenziazione; non ci sono resource e prompt MCP, solo tool.
-   **Protocollo**: `2024-11-05`, il più diffuso fra i client; `initialize`, `ping`, `tools/list`,
    `tools/call`. Le notifiche non ricevono risposta.

## Codice

| File                                        | Ruolo                                               |
| ------------------------------------------- | --------------------------------------------------- |
| `src/mcp/server.ts`                         | protocollo, definizione dei tool, filtro per policy |
| `src/mcp/index.ts`                          | trasporto stdio (una riga JSON per messaggio)       |
| `src/mcp/audit.ts`                          | audit log delle scritture, rotazione e riduzione    |
| `src/core/settings.ts`                      | modello e validazione della policy API              |
| `src/main/settings.ts`                      | posizione e scrittura atomica del file impostazioni |
| `src/main/backend.ts`                       | il backend condiviso con la UI                      |
| `src/core/blame.ts`, `search.ts`, `diff.ts` | parser e formattazione, puri e testati              |

Test: `tests/mcp.test.mts` (protocollo, tool di lettura e scrittura, filtro per policy e voci di
audit in-process su un repository temporaneo vero), `tests/audit.test.mts` (righe JSON, permessi,
rotazione, argomenti ridotti), `tests/settings.test.mts` (normalizzazione, limiti, gruppi di
lettura e scrittura, file).
