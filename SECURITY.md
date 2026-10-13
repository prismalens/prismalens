# Security Policy

## Supported versions

PrismaLens is pre-1.0. Security fixes land in the latest 0.5.x release; older
releases do not get fixes.

| Version | Supported |
| ------- | --------- |
| latest 0.5.x release | yes |
| anything older | no — please upgrade (`pl upgrade`) |

## Reporting a vulnerability

**Please do not report security issues through public GitHub issues.**

Use GitHub's private vulnerability reporting:

- Go to the repository's **Security** tab and choose
  **[Report a vulnerability](https://github.com/prismalens/prismalens/security/advisories/new)**.

If you cannot use that, email **sumitpatel.14may@gmail.com** with the details.

Please include:

- A description of the issue and its impact.
- Steps to reproduce or a proof of concept.
- The PrismaLens version (`pl --version`), how you installed it, and your OS.
- Any suggested remediation, if you have one.

Do **not** include real secrets, tokens, or private content in your report.

## What to expect

- Acknowledgement within a few days.
- An assessment of severity and a fix plan for confirmed issues.
- Credit in the release notes if you would like it.

## How PrismaLens works

PrismaLens is a self-hosted incident investigator. `pl up` runs the API and the
dashboard as one process on the user's machine, with a SQLite database in the
workspace (`~/.prismalens` by default). Every browser, this machine's included,
gets in only through a one-time pairing link; there is no account.

For each investigation PrismaLens clones the service's repository at its last
commit into a throwaway directory and starts the coding agent the user
installed, over the Agent Client Protocol (ACP), with that clone as its working
directory and an allowlisted environment. The run's permission level (Ask
always, Auto-accept edits, Auto or Full access) picks the agent's own mode and
decides which of its permission requests wait for the user; a run an alert
starts runs at Auto and refuses anything the agent asks. The agent's own mode is
the limit: PrismaLens adds no sandbox, and the agent runs as the user who
started `pl up`.

The agent signs in to its own provider; PrismaLens never reads or stores that
login, and never calls a model itself.

## Scope

Reports in these areas are especially valuable:

- **Pairing links and device cookies** — a one-time pairing link that works
  twice, outlives its expiry or can be guessed; a device cookie that can be
  stolen, replayed or forged; any path to the dashboard or API without a
  paired device.
- **The Alertmanager webhook token** — a webhook delivery accepted without the
  token, or a way to learn the token.
- **Binding beyond loopback** — anything that becomes reachable, or weaker,
  when `pl up` binds another address with `--host`.
- **Tailscale serve** — anything exposed, or trusted, wrongly when PrismaLens
  is published on a tailnet with `--tailscale-serve`.
- **Permission levels and asks** — a run that gets more than its level: a
  permission request answered without the user when the level says it waits,
  an alert-started run that lets through something it should refuse, or an
  approval that lands on a different request from the one shown. What the
  agent's own mode allows, and the agent's own sandbox, belong to the agent.
- **The agent's environment** — the agent receiving an environment variable
  outside its allowlist, or reading files outside its snapshot through
  PrismaLens.
- **Workspace data at rest** — secrets, integration credentials or report
  contents stored in the workspace in a form they should not be, and secrets
  that reach logs, reports or the UI.
- **Path traversal** in any file read or write PrismaLens performs.
