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

Senza `--repo` usa `GITCRAFT_REPO`, altrimenti la directory corrente. Se il percorso non è un
repository, esce con codice 2 e un messaggio su stderr.

Il server parla JSON-RPC a righe: una richiesta per riga su stdin, una risposta per riga su stdout.
Tutto ciò che non è protocollo va su stderr, quindi il canale non si corrompe.

Verifica manuale:

```bash
printf '%s\n' \
  '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{}}}' \
  '{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"repo_status","arguments":{}}}' \
  | node dist/mcp/index.js --repo .
```

## Configurazione

### OpenCode V2

```jsonc title="opencode.jsonc"
{
	"$schema": "https://opencode.ai/config.json",
	"mcp": {
		"servers": {
			"gitcraft": {
				"type": "local",
				"command": [
					"node",
					"/home/emaxlele/Projects/gitcraft/dist/mcp/index.js",
					"--repo",
					"/home/emaxlele/Projects/gitcraft"
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
		"gitcraft": {
			"command": "node",
			"args": [
				"/home/emaxlele/Projects/gitcraft/dist/mcp/index.js",
				"--repo",
				"/home/emaxlele/Projects/gitcraft"
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

-   **Nessuna scrittura.** Non esistono tool che modificano il repository: niente `stage`, `commit`,
    `reset`. Se servirà, sarà un flag esplicito e un consenso, non il default.
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

| File                                        | Ruolo                                                 |
| ------------------------------------------- | ----------------------------------------------------- |
| `src/mcp/server.ts`                         | protocollo, definizione dei tool, chiamate al backend |
| `src/mcp/index.ts`                          | trasporto stdio (una riga JSON per messaggio)         |
| `src/main/backend.ts`                       | il backend condiviso con la UI                        |
| `src/core/blame.ts`, `search.ts`, `diff.ts` | parser e formattazione, puri e testati                |

Test: `tests/mcp.test.mts` (protocollo e tool in-process su un repository temporaneo vero).
