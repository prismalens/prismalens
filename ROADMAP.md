# PrismaLens Roadmap

> **North star: the control plane where AI agents earn the right to operate production.**
>
> Anyone can point a coding agent at a cluster and ask "what broke?" — that part is free.
> PrismaLens is everything a free agent structurally cannot be: **awake when nobody is**,
> **grouping an alert storm into one incident**, **keeping a permanent evidence record**,
> **capping the API bill**, and **sandboxing the agent** so it can be trusted with
> production credentials. Bring your own agent — we bring the pager, correlation, record,
> sandbox, and report.

## Where we are

`prismalens` (CLI) and `@prismalens/engine` are on npm (Apache-2.0). Today you can run
`pl investigate` against a real alert and get an evidence-linked root-cause report, or
drive the same engine from the web app.

## What's next

### 1 · The 3 AM Release — investigations that start themselves
`pl listen`: point Alertmanager at it; when an alert fires at 3 AM, the investigation runs
under hard budget caps and the report is in Slack before you wake up. Alert storms become
one incident, not fifty runs. Claude Code becomes the default investigation engine
(sandboxed); local incident history via `pl status` / `pl report`.

### 2 · The proving ground *(internal)*
Reproducible incident scenarios with known root causes, scored head-to-head: plain agent
+ a skill file vs. PrismaLens. We don't claim we're better — we measure it, and we publish
the harness.

### 3 · The Smart Release — reports that know your history
"This started 4 minutes after deploy #841 touched checkout-service — and it resembles the
May 3rd incident." Reports correlated with your deploys and change events (pulled on
demand — PrismaLens stays reactive, no standing feeds), suspects ranked by your service
graph, similarity against your own incident history. Self-hosted app feature.

### 4 · The Trust Release — from reporting to acting *(first commercial features)*
The agent proposes a fix; a human approves; it executes — fully logged. **Transparency
up front:** the act/approval capabilities (letting the agent *touch* production) will be
a paid add-on, developed in a separate proprietary plugin and unlocked with a license
key. Everything this repo ships — investigation, reports, the record — stays free.

### 5 · The Team Release — run it yourself
One-command deploy (compose / Helm) in your own VPC: Postgres, teams and roles, Slack and
email notifications, full alert-source coverage (Datadog, Grafana, New Relic, Prometheus,
and more), a second engine (Codex) with cross-agent corroboration. Your keys, your data,
your cluster. An enterprise add-on (SAML/SCIM, compliance exports, governed connectors)
will be paid; basic teams, roles, and local audit are free.

### Later
Desktop app · managed cloud (hosted convenience — never features the self-hosted app lacks).

## Free forever vs. paid — the honest line

**One rule: investigation is free; production mutation is paid.**

Free forever (Apache-2.0, this repo): unattended investigation (`pl listen`), alert
intake and storm grouping, smart reports with deploy/history correlation, the visual
review UI, basic teams + roles + local audit log, notification channels, basic MCP tools
and standard connectors, record migration between CLI/app/cloud, self-hosted at any
scale, bring-your-own key or AI endpoint.

Paid (separate proprietary plugin, license key): the act phase (approve → execute),
approval policies and the per-service trust ledger; enterprise SSO/compliance/governed
connectors. We publish this now, before anyone depends on us, so there is never a
rug-pull moment.

---

Work is tracked as GitHub issues per active phase (milestone per phase). The detailed
engineering roadmap lives in the project knowledge base; issues link back to it.
