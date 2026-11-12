# Contributing to GitHandler

Thanks for taking the time. This document covers the rules that keep the project reviewable and the
three commands that must stay green.

## Ground rules

-   **Code is written in English**: identifiers, comments, commit messages, test names, log output.
    This is a convention, not a preference; Italian accents and wording have no place in source files.
-   **User-visible text is translated.** Italian and English are both first-class. A new string goes
    into the translation catalogue and is used through its key; never paste a literal into the markup
    or into the logic.
-   **No references to other Git clients** in code, comments, documentation or commit messages. The
    project describes what it does, not what it is similar to.
-   **No new dependency without a decision.** Open an issue first. The project prefers the standard
    library and what is already installed; a dependency that only saves a few lines is refused.
-   **Performance work needs a measurement.** If something feels slow, measure it with
    `npm run bench`. An optimization without a number before and after is not accepted. Thresholds are
    in [`docs/backend-performance.md`](docs/backend-performance.md).
-   **No destructive shortcuts.** The app must keep choosing the recoverable path: no forced push, no
    `git gc --prune=now` on the user's repository, no silently discarded changes.

## Licence and contributions

GitHandler is released under **GPL-3.0-or-later** and the maintainer stays its only owner: one person
decides the licence, the roadmap and what gets merged.

**For now the project takes issues, not code.** That is a phase, not a rule for life: when the code
settles, pull requests open. The reason is practical. The conventions below — a bilingual UI, no
references to other Git clients, the `core`/`main`/`renderer`/`mcp` split, tests against a real `git`,
a measurement before every optimisation — make an outside patch expensive to review and, at this
stage, the maintainer would rewrite it anyway.

The [CLA](CLA.md) is already in place for the day that changes. It is a licence grant, not a transfer:
you keep the copyright of what you write, and the maintainer gains the right to use, sublicense and
relicense the contribution, so the project can change licence later without hunting down every author.
One signature covers all your future contributions. Merged contributions are published under
GPL-3.0-or-later, like the rest of the code.

## Setup

Requirements: Node.js 24, npm, and a `git` recent enough for `status --porcelain=v2` (2.11+, but the
tests assume a current Git). Linux is the primary platform; the app runs on any distribution with
Electron's libraries.

```bash
git clone https://github.com/emaxlele/githandler.git
cd githandler
npm ci
npm run build
npm start
```

`npm run dev` rebuilds on change. `npm run shots -- --repo <path>` drives the UI headlessly with an
isolated Electron profile and writes PNGs to `docs/screenshots/`.

## Verification

These are the commands the maintainer runs before every commit, and the ones a patch has to pass
before it can be considered:

```bash
npm run typecheck
npm test
npm run build
```

All three must pass. Add a test for every behaviour change: `tests/*.test.mts` run with `node --test`
against a real `git` binary in a temporary repository, so they exercise the parser and the command
line together. A test that only mocks Git proves little here.

If the change touches the backend hot paths (log parsing, graph layout, status, refresh), run the
benchmark and put the numbers in the patch or the issue:

```bash
npm run bench -- --commits 50000 --files 100000
```

## Commits and issues

-   **Commit messages**: `type: short imperative summary` (`feat:`, `fix:`, `perf:`, `docs:`,
    `refactor:`, `test:`, `build:`), body in English when the reason is not obvious. Keep one logical
    change per commit.
-   **Issues**: say what you expected, what happened, the version (`git describe --tags` or the About
    panel), the distribution and the steps that reproduce it. A screenshot of the window helps. An
    issue that reproduces on a repository with conflicts, a detached HEAD or a large working tree is
    worth two that do not.
-   **Pull requests**: not merged at the moment, see above. One that arrives anyway is read as a
    description of the change; if it is implemented, the author is named in the commit message.
-   **Activity log**: the maintainer updates `docs/registro-attivita.md`; contributors do not need to.

## Documentation

-   `docs/registro-attivita.md` is the running log of what changed and why, for non-technical readers.
-   `docs/architettura.md` explains the process split, the IPC surface and the backend interface.
-   `docs/mcp.md` describes the AI server and its permission model.
-   Multi-step work gets a plan in `docs/plans/YYYY-MM-DD-<slug>.md`.
-   Project documentation is in Italian; the README exists in both languages and the two versions stay
    in sync.

## Security

Do not report vulnerabilities in a public issue: see [`SECURITY.md`](SECURITY.md).
