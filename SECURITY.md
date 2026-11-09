# Security policy

## Reporting a vulnerability

Please **do not open a public issue** for security problems.

Use GitHub's private vulnerability reporting: [Security → Report a
vulnerability](https://github.com/emaxlele/githandler/security/advisories/new). If that is not
available, open an issue that says only that you have a security report and how to reach you, without
details.

Include the version (`git describe --tags` or the app's About panel), the distribution, and the steps
that reproduce the problem. A proof of concept helps; never include a real token, private key or
confidential repository content.

You can expect an acknowledgement within a few days. The fix and the advisory are published together;
credit is given unless you ask otherwise.

## Supported versions

Only the latest release receives security fixes. The project is pre-1.0, so a fix ships as a new
release rather than as a patch to an old one.

## What the app touches

Knowing the data flow makes reports easier to triage:

-   **Access tokens are never written by GitHandler.** They are kept in memory for the session and
    handed to `git` through `GIT_ASKPASS`, using a script in `~/.config/githandler/askpass.sh`
    (`0700`) that reads user and token from the child process environment. `git` arguments never
    contain a token. If you use a Git credential helper, the token is also passed with
    `git credential approve`; Git stores it, not this app.
-   **Account metadata** (provider, host, API URL, user, label, OAuth client ID) lives in
    `$XDG_CONFIG_HOME/githandler/accounts.json` with mode `0600`.
-   **Settings**, including which MCP tools are enabled, live in
    `$XDG_CONFIG_HOME/githandler/settings.json`. The MCP server is **off by default** and re-reads the
    policy on every request.
-   **No repository content leaves the machine** except through the operations you ask for
    (`fetch`, `pull`, `push`, provider API calls, GitHub Actions, clone).

The MCP server runs on stdio and is only started by a client you configure, so it does not listen on a
network port.

## Out of scope

-   Vulnerabilities in `git`, Electron, Node.js or the user's distribution; report them upstream.
-   Problems that require an attacker to already control the user's account or machine.
-   Missing hardening that has no demonstrated impact (for example, a missing CSP report from a page
    that loads no remote content).
