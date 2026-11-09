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
-   ⏳ Interactive rebase (reorder, squash, drop, reword) on top of the existing history view.
-   ⏳ Worktrees: list, create, open in a tab.

## 3. From repository to pull request

-   ✅ Pull request / merge request: list the open ones, open them, create one from two branches.
-   ⏳ Review comments: read and answer, without leaving the app.
-   ✅ Checks: status per pull request, with a link to the run.
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
-   ⏳ Drag a file out of the window, lazy tree in the file view, syntax highlighting.
-   ⏳ GPG-signed commits, commit message templates, hook output in the UI.
-   ✅ Themes and preferences: light / dark / OLED, density, text size.

## 5. Differentiators

-   ✅ MCP write tools (`stage`, `unstage`, `commit`, `create_branch`, `checkout_branch`) under the
    same per-command permissions, with an audit log of what an agent did.
-   ✅ Repository health panel: diverged branches, forgotten stashes, outdated submodules, detached
    HEAD.
-   ⏳ Reachability of remotes and repositories that outgrew the layout, in the same panel.
-   ⏳ Recovery explained: one screen that says what can be recovered and from where
    (`refs/githandler/trash/*`, snapshots), instead of leaving it implicit.

## 6. Distribution

-   ⏳ AppArmor profile inside the `.deb` (Ubuntu 24.04+ restricts the Chromium sandbox).
-   ⏳ AppImage and Flatpak: on Linux, discovery happens through Flathub.
-   ⏳ Signed automatic updates, only after the AppArmor profile exists.

## Out of scope

-   Anything that rewrites history or pushes with force without an explicit, reversible step.
-   A closed-source plugin API: the app is GPL-3.0-or-later and stays so.
