# API per l'AI: server MCP

> Server [Model Context Protocol](https://modelcontextprotocol.io) su stdio che espone un repository
> Git in **sola lettura**. Riusa lo stesso backend della UI (`CliGitBackend`), quindi legge il
> repository con le stesse regole e con lo stesso output: non esiste una seconda verità.
> Ultimo aggiornamento: 2026-11-08

## Perché

Un agente che lavora su un repository ha bisogno di leggere stato, storia, diff e attribuzione delle
righe, non di muovere file. Questo server dà quelle quattro cose in forma strutturata, senza
concedergli la possibilità di fare `commit`, `reset` o `checkout`: la parte che scrive resta in mano
all'utente, nell'app.

## Avvio

```bash
npm run build
node dist/mcp/index.js --repo ~/Projects/qualche-repo
```

Senza `--repo` usa `LANECRAFT_REPO`, altrimenti la directory corrente. Se il percorso non è un
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

| Modo     | Cosa espone                                                    |
| -------- | -------------------------------------------------------------- |
| `off`    | niente (default)                                               |
| `read`   | i cinque tool di lettura                                       |
| `all`    | tutto, compresi eventuali tool che scrivono quando esisteranno |
| `custom` | solo i tool spuntati nella lista                               |

La policy è un file JSON letto a **ogni richiesta**:

```
$LANECRAFT_CONFIG_DIR/lanecraft/settings.json   # override, per test e installazioni portabili
$XDG_CONFIG_HOME/lanecraft/settings.json
~/.config/lanecraft/settings.json              # tipico
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
    chiedere un tool non esposto restituisce `Tool "..." is not enabled in the lanecraft settings.`,
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
			"lanecraft": {
				"type": "local",
				"command": [
					"node",
					"/home/emaxlele/Projects/lanecraft/dist/mcp/index.js",
					"--repo",
					"/home/emaxlele/Projects/lanecraft"
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
		"lanecraft": {
			"command": "node",
			"args": [
				"/home/emaxlele/Projects/lanecraft/dist/mcp/index.js",
				"--repo",
				"/home/emaxlele/Projects/lanecraft"
			]
		}
	}
}
```

## I tool

Tutti sono di sola lettura e dichiarano uno schema JSON chiuso (`additionalProperties: false`).

| Tool            | Argomenti                                 | Cosa restituisce                                                                                             |
| --------------- | ----------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| `repo_status`   | —                                         | ramo, HEAD staccato, ahead/behind, elenco modifiche con codici index/worktree, ultima operazione annullabile |
| `history`       | `text`, `author`, `file`, `limit` (1-500) | commit più recenti, con SHA, autore, data ISO, oggetto e genitori                                            |
| `show_commit`   | `sha`, `path`                             | metadati e file del commit; con `path` anche il diff unified di quel file                                    |
| `worktree_diff` | `path`, `staged`                          | diff unified di un file nel working tree o nell'indice, con conteggi                                         |
| `blame`         | `path`, `start`, `end`                    | una voce per riga: commit, autore, data, oggetto e testo                                                     |

Esempi di richieste che funzionano bene:

-   `history` con `file: src/main/backend.ts` → chi ha toccato il file e quando;
-   `show_commit` con `sha` e `path` → il diff esatto di una modifica, senza aprire l'app;
-   `blame` su una funzione → da quale commit viene quella riga e con quale messaggio;
-   `repo_status` prima di proporre un commit → cosa è in stage e cosa no.

## Garanzie e limiti

-   **Nessuna scrittura, e niente è esposto per default.** Non esistono tool che modificano il
    repository: niente `stage`, `commit`, `reset`. L'elenco dei tool è deciso dalla policy delle
    impostazioni (vedi sopra), non da una costante nel codice. Se un giorno arriveranno tool che
    scrivono, saranno dietro un consenso esplicito, mai attivi per default.
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
| `src/core/settings.ts`                      | modello e validazione della policy API              |
| `src/main/settings.ts`                      | posizione e scrittura atomica del file impostazioni |
| `src/main/backend.ts`                       | il backend condiviso con la UI                      |
| `src/core/blame.ts`, `search.ts`, `diff.ts` | parser e formattazione, puri e testati              |

Test: `tests/mcp.test.mts` (protocollo, tool e filtro per policy in-process su un repository
temporaneo vero), `tests/settings.test.mts` (normalizzazione, limiti, file).
