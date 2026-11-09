# Evidenziazione della sintassi nel diff

## Obiettivo

Colorare il codice nel diff secondo il tipo di file, senza perdere la velocità del disegno a stringa
HTML e senza toccare il testo: l'escape resta in un solo punto.

## Contesto

-   `src/renderer/diff-view.ts` costruisce l'HTML di ogni riga (`renderUnifiedBody`, `renderSplitBody`);
    il diff affiancato ha già l'evidenza della porzione cambiata (`changedRanges`).
-   Il renderer è un bundle IIFE senza runtime Node (`esbuild.mjs`): le librerie nuove vengono
    compilate dentro `dist/renderer/app.js`.
-   Le impostazioni di aspetto vivono in `AppearanceSettings` (`src/core/settings.ts`) e vengono
    applicate al documento prima del primo disegno (`applyAppearance` in `src/renderer/app.ts`).

## Scelte

-   CodeMirror 6 come parsers (licenza MIT): `@codemirror/language`, `@codemirror/legacy-modes`,
    `@codemirror/lang-markdown`, `@lezer/highlight`.
-   Le modalità legacy sono tokenizzatori a flusso, quindi leggono un hunk riga per riga senza
    costruire un editor.
-   Il core produce solo intervalli con classi `tok-…`; l'HTML lo compone il renderer con
    `escapeHtml`.
-   Il diff affiancato taglia i pezzi sui confini dei token e dell'intervallo cambiato, così il
    carattere evidenziato resta esatto.
-   Nuova impostazione `appearance.syntax` (default acceso): con i colori spenti non si tokenizza e
    il testo resta quello della riga. Il cambio è immediato perché `applyAppearance` scrive
    `data-syntax` sul documento.

## Passi

-   [x] Dipendenze e modulo puro `src/core/syntax.ts` (lingua dal percorso, token per riga, limiti).
-   [x] Integrazione in `diff-view.ts` per unito e affiancato.
-   [x] Variabili colore per i tre temi e spegnimento via CSS.
-   [x] Impostazione «Colora la sintassi nel diff» (HTML, `app.ts`, i18n, test).
-   [x] Test `tests/syntax.test.mts`.
-   [x] Verifica: typecheck, test, build, screenshot in inglese con un diff TypeScript.
-   [x] Documentazione: README (italiano e inglese), CHANGELOG, TODO, ROADMAP, registro attività.

## Rischi

-   Un hunk unisce righe rimosse e aggiunte: ai punti di sutura un blocco di commento o una stringa
    può essere letto male, ma nessun carattere cambia e nessun testo viene interpretato come HTML.
-   Il diff affiancato evidenzia l'intero token quando il cambio lo attraversa: il taglio sui confini
    evita di colorare caratteri non cambiati.
-   Il bundle del renderer cresce; il caso peggiore misurato è ~30 ms per 3.000 righe di TypeScript.

## Verifica

```bash
npm run typecheck && npm test && npm run build
GITHANDLER_LOCALE=en npm run shots -- --repo /tmp/gitdemo --shots-output /tmp/shots/app.png
```

## Resume prompt

Implement syntax highlighting in the GitHandler diff views with CodeMirror 6, keeping the
HTML-string renderer and `escapeHtml`. Core module `src/core/syntax.ts` returns `tok-…` spans per
line; `src/renderer/diff-view.ts` merges them with the changed-range highlight. Add the
`appearance.syntax` toggle and theme colours, then verify with `npm run typecheck && npm test &&
npm run build` and a screenshot of a TypeScript diff.
