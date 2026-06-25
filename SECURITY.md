# Security Policy

## Supported versions

prismalens is pre-1.0 and under active development. Security fixes land on the
latest line of development; there are no maintained older releases yet.

| Version | Supported |
| ------- | --------- |
| latest `main` / `first` | yes |
| older snapshots | no — please update |

## Reporting a vulnerability

**Please do not report security issues through public GitHub issues.**

Use GitHub's private vulnerability reporting:

- Go to the repository's **Security** tab and choose
  **[Report a vulnerability](https://github.com/prismalens/prismalens/security/advisories/new)**.

If you cannot use that, email **sumitpatel.14may@gmail.com** with the details.

Please include:

- A description of the issue and its impact.
- Steps to reproduce or a proof of concept.
- The prismalens version/commit and your environment.
- Any suggested remediation, if you have one.

Do **not** include real secrets, tokens, or private content in your report.

## What to expect

- Acknowledgement within a few days.
- An assessment of severity and a fix plan for confirmed issues.
- Credit in the release notes if you would like it.

## Scope notes

prismalens is a local-first SRE incident-investigation app. It runs on the
operator's machine and reaches their observability/infrastructure systems
**through the user's own CLIs**, by design under **read-only credentials**, and
uses a **bring-your-own-key** model for the LLM backend. The areas where a
vulnerability would be most impactful — and where reports are especially
valuable — are:

- **Credential handling** — leakage of API keys, tokens, or connection strings
  into logs, telemetry, reports, or the UI.
- **Shell / command execution** — command injection or sandbox escape in the
  shell-first integration layer, or any path that turns a read-only integration
  into a write.
- **Secret exposure in artifacts** — investigation reports or stored state that
  capture sensitive values they should have redacted.
- **Path traversal** in any file-write path.

Reports that strengthen those guarantees are prioritized.
