# Roadmap

Ordered by what makes the app usable every day. Status is honest: ✅ shipped, 🚧 in progress, ⏳ planned.

## 1. Publication

| Item                                          | Status                        |
| --------------------------------------------- | ----------------------------- |
| GPL-3.0-or-later license                      | ✅                            |
| CI: typecheck, tests, build, benchmark smoke  | ✅                            |
| `SECURITY.md`, `CONTRIBUTING.md`, issue forms | ✅                            |
| README badges, roadmap                        | ✅                            |
| `AGENTS.md` with the contribution rules       | ✅                            |
| Public repository                             | ⏳ decision of the maintainer |

## 2. Conflicts, without leaving the app

-   ✅ Three-way view: the working file, the two sides of every hunk, one choice per hunk.
-   ✅ "Use mine" / "Use theirs" on a whole file, including the deletion side of a delete/modify clash.
-   ✅ Editor for the result, with the hunks listed and their content side by side.
-   ✅ "Mark resolved" and "Continue" (`merge --continue`, `rebase --continue`, `cherry-pick --continue`),
    with "Abort" one click away.
-   ✅ Interactive rebase (reorder, squash, fixup, drop, reword) on top of the existing history view,
    with the full message for a reword and an undo entry for the whole operation.
-   ✅ Worktrees: list, create on an existing or new branch, open in a tab, remove when clean.

## 3. From repository to pull request

-   ✅ Pull request / merge request: list the open ones, open them, create one from two branches.
-   ✅ Review comments: read the conversation and answer, without leaving the app.
-   ✅ Reviews: who approved, who asked for changes, and the actions each service allows the author
    — approve everywhere, request changes on GitHub, Gitea and Bitbucket, withdraw an approval on
    GitLab and Bitbucket. A missing action means the service does not offer it.
-   ✅ Checks: status per pull request, with a link to the run.
-   ✅ GitHub Actions: list the runs, retry the failed jobs, re-run or cancel, and start a workflow
    with its inputs on the chosen branch or tag.
-   ✅ CI notifications from the tray, without keeping the window in front.

## 4. Daily quality

-   ✅ User interface in Italian **and** English (`i18n`), language switchable in settings.
-   ✅ Command palette (`Ctrl+K`) with a single command registry, and `?` for the shortcut list.
-   ✅ Stronger search: `regex:` on the message, `change:` (`-S`), `diff:` (`-G`) and `lines:`
    (`log -L`), while free text stays literal.
-   ✅ Content search across the working tree (`git grep`), as a separate tool.
-   ✅ Reflog panel and "go to commit by SHA"; the undo history is visible instead of implicit.
-   ✅ Network progress from `git` stderr during clone, fetch, pull and push.
-   ✅ Partial stash with a file checklist.
-   ✅ Drag a file out of the window.
-   ✅ Lazy tree in the file view: "All files" reads one folder at a time, the working-tree mode keeps
    the list of changed files.
-   ✅ Syntax highlighting (CodeMirror 6): the file type picks the parser, the diff keeps the
    string-based renderer, and the setting can turn the colours off.
-   ✅ Commit message templates (`commit.template`) and hook/signature output visible in the UI.
-   ✅ Signed commits: a "sign (GPG)" switch adds `-S`, so the key already configured in Git signs
    the commit; the app never handles keys.
-   ✅ Themes and preferences: light / dark / OLED, density, text size.

## 5. Differentiators

-   ✅ MCP write tools (`stage`, `unstage`, `commit`, `create_branch`, `checkout_branch`) under the
    same per-command permissions, with an audit log of what an agent did.
-   ✅ Repository health panel: diverged branches, forgotten stashes, outdated submodules, detached
    HEAD.
-   ✅ Reachability of remotes: "Check the remotes" contacts each one with `git ls-remote` and says
    whether it answers and how many branches it has.
-   ✅ Repositories that outgrew the measured layout: the same panel counts commits and tracked files
    and says so above 50,000 commits or 100,000 files, with the measurement from
    `docs/backend-performance.md` behind the threshold.
-   ✅ Recovery explained: one screen that says what can be recovered and from where — the last
    operation, stashes, copies under `refs/githandler/trash/*`, the reflog.

## 6. Distribution

-   ✅ AppArmor profile inside the `.deb`, loaded by `postinst`, with the setuid sandbox helper as
    the primary path and the launcher fallback only when both are unavailable.
-   ✅ AppImage and `.rpm` packages; the AppImage is the portable option, the RPM follows the `.deb`
    layout and derives its dependencies from the ELF sonames.
-   🚧 Flatpak: manifest, zypak launcher and `npm run flatpak` ship; the build was not run here
    because `flatpak-builder` is missing, and a Flathub submission needs the public repository.
-   🚧 Signed updates: an `https` feed of releases signed with Ed25519, verified against the
    public key shipped with the app, with the digest of the package checked after the download. The
    app never installs by itself: the verified package goes to the system installer. No key and no
    feed are published yet, so the feature reports itself as unconfigured.

## Out of scope

-   Anything that rewrites history or pushes with force without an explicit, reversible step.
-   A closed-source plugin API: the app is GPL-3.0-or-later and stays so.
