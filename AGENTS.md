# Agent instructions for GitHandler

These rules apply to every change in this repository, human or automated.

## Language

-   **Code is English**: identifiers, types, comments, test names, log messages, commit messages.
    Never Italian text in source files — accents and wording do not belong there.
-   **User-facing text is bilingual.** Italian and English are both supported. A user-visible string
    goes through the translation catalogue and is referenced by key; do not paste a literal into HTML
    or into logic. The UI language follows the setting, defaulting to the system locale.
-   **Documentation is Italian** (`docs/`, `README.md`, `CHANGELOG.md`, `TODO.md`,
    `docs/registro-attivita.md`), with the English mirror `README.en.md` kept in sync. `CONTRIBUTING.md`,
    `SECURITY.md`, `ROADMAP.md` and this file are in English for contributors.
-   **Never name another Git client** in code, comments, documentation, tests, commit messages or
    branch names. Describe functionality, not similarity. Generic phrases such as "desktop Git clients"
    are fine.

## Architecture

-   `src/core/`: pure TypeScript — parsers and algorithms, no Electron, no filesystem. Everything here
    is unit-testable with plain objects.
-   `src/main/`: Electron main process — backend, git invocation, settings, IPC, watcher.
-   `src/preload/`: the narrow bridge exposed to the renderer.
-   `src/renderer/`: the window — DOM, views, no Node access. It talks to the main process only
    through the preload API.
-   `src/mcp/`: the MCP server, which reuses the same backend and the same permission policy as the UI.

Do not move logic across these boundaries to save a few lines. A parser belongs in `core` even when
only one caller uses it.

## Safety

-   **Never force-push, never prune the user's objects, never discard uncommitted changes silently.**
    The app already chooses the recoverable path (trash refs, undo entries); keep it that way.
-   Destructive operations in the UI need an explicit confirmation that says what is lost and what can
    be recovered.
-   Never write tokens, credentials or repository contents to logs or to files the app owns.
-   Validate paths that come from the renderer or from MCP: they must stay inside the repository.

## Verification

```bash
npm run typecheck && npm test && npm run build
```

All three must pass before a commit. Every behaviour change needs a test in `tests/*.test.mts`; tests
run against a real `git` in a temporary repository, not mocks.

Performance changes need a measurement:

```bash
npm run bench -- --commits 50000 --files 100000
```

Put before/after numbers in the commit or pull request, and update `docs/backend-performance.md` when
a threshold is crossed. Optimize only above the documented thresholds.

## Commits and tracking

-   Commit style: `type: short imperative summary`, English, one logical change per commit.
-   Every change adds an entry to `docs/registro-attivita.md` (newest first, one `## YYYY-MM-DD`
    section per day, plain words for non-technical readers). Keep `CHANGELOG.md` and `TODO.md` current
    when they have a matching section.
-   Multi-step work gets a plan in `docs/plans/YYYY-MM-DD-<slug>.md` with checkbox steps and a
    **Resume prompt** at the end.
-   Do not rewrite published history or force-push without an explicit request.
