---
"prismalens": patch
---

Support CLI-session authentication routes alongside API keys for investigation harnesses (ADR-0031). Add Node-side `resolveHarnessAuth` to detect credentials and local CLI sessions (e.g. `claude` CLI logins) with truthful diagnostic remedies. Allow worker executions to run keyless with Claude Code harness when a CLI session is present, and add `GET /settings/harnesses` to report real-time harness readiness to the settings UI.
