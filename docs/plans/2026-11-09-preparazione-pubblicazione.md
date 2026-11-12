# Preparazione alla pubblicazione del repository

> Obiettivo: togliere dal progetto ogni riferimento ad altri client Git, chiudere i colli di bottiglia
> della pubblicazione (README internazionale, screenshot, topics, primo artefatto) e verificare le
> prestazioni con il benchmark. Ultimo aggiornamento: 2026-11-09

## Contesto

Il repository `emaxlele/githandler` è **privato** dal 2026-11-09. La licenza è stata scelta:
**GPL-3.0-or-later** (2026-11-09). Prima di riaprire il repository va eliminata ogni menzione di
prodotti concorrenti, sia nei documenti sia nella storia Git, per non dipendere da nomi e marchi
altrui.

Stato del codice: v0.10.0, 142 test, `npm run typecheck && npm test && npm run build` verdi.
Il prodotto è descritto in `README.md`; l'architettura in `docs/architettura.md`; le misure in
`docs/backend-performance.md`.

## Passi

### Riferimenti ad altri client

-   [x] README, registro, CHANGELOG, TODO e piani riscritti senza nomi di prodotti concorrenti
-   [x] Commenti nel codice (`src/core/graph.ts`, `src/core/align.ts`) riscritti
-   [x] Piano `2026-11-08-ui-githandler.md` rinominato (prima conteneva il nome di un prodotto)
-   [x] Memoria persistente aggiornata
-   [x] Storia Git riscritta (contenuti, messaggi e nome del piano) e force push

### Scoperta del progetto

-   [x] `README.en.md` con la traduzione inglese e rimando reciproco
-   [x] Screenshot nel README (`docs/screenshots/`)
-   [x] Topics GitHub (`git`, `git-client`, `electron`, `linux`, `typescript`, `mcp`…)
-   [x] Primo artefatto distribuibile in una release GitHub

### Prestazioni

-   [x] `npm run bench -- --commits 50000 --files 100000`: nessuna soglia superata
-   [x] Misura del refresh completo (`CliGitBackend.refresh`) aggiunta al benchmark
-   [x] Numeri aggiornati in `docs/backend-performance.md`

### Pubblicazione (2026-11-09)

-   [x] Licenza **GPL-3.0-or-later**: `LICENSE`, `package.json`, README e README.en.md
-   [x] CI GitHub Actions: typecheck, test, build, smoke del benchmark
-   [x] `SECURITY.md`, `CONTRIBUTING.md`, moduli per issue (bug e proposta), `ROADMAP.md`
-   [x] `AGENTS.md`: codice in inglese, UI bilingue, nessun nome di altri client, verifica e misure
-   [x] Badge nel README (CI, licenza, Node)
-   [x] `CLA.md`: i contributi esterni restano sotto il controllo del manutentore (2026-11-13)
-   [ ] Riapertura del repository: decisione dell'utente, dopo il primo giro di CI verde

Il resto del lavoro è nel piano `2026-11-09-roadmap-prodotto.md`.

## Rischi

-   La riscrittura della storia cambia tutti gli SHA: eventuali cloni locali vanno riallineati con
    `git fetch && git reset --hard origin/main`.
-   Gli screenshot devono venire da un repository di prova, non da percorsi personali.
-   Il pacchetto va provato su una macchina pulita prima di dichiararlo stabile: l'AppArmor di Ubuntu
    24.04+ richiede il profilo dedicato (milestone 4).

## Verifica

```bash
npm run typecheck && npm test && npm run build
npm run bench -- --commits 50000 --files 100000
git log --oneline | wc -l          # i commit riscritti
```

La storia è stata riscritta: i nomi di altri client non compaiono più in nessun commit della
storia (verificato con `git grep` su tutti i commit, non solo sull'ultimo).

## Prompt per riprendere

> Nel repo `~/Projects/githandler` leggi `docs/plans/2026-11-09-preparazione-pubblicazione.md`,
> `docs/plans/2026-11-09-roadmap-prodotto.md` e `docs/registro-attivita.md`. Licenza GPL-3.0-or-later,
> CI e documenti di progetto fatti; il repository è ancora privato. Il prossimo passo è la
> risoluzione dei conflitti in-app, poi i18n + command palette, poi gli strumenti MCP di scrittura.
> Il pacchetto `.deb` va verificato su macchina pulita con il profilo AppArmor.
