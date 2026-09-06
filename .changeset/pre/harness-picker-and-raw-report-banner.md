---
"prismalens": patch
---

Surface harness credential routes in the app (#501, ADR-0031).

- **Settings → AI Provider → "Investigation agent".** Pick `Auto` or an implemented harness, each badged from `GET /settings/harnesses`: signed-in Claude session, API key, or not authenticated with the server's own remedy text. Pinning a harness whose credential is missing, or whose protocol does not match the active provider, shows the mismatch inline — PrismaLens never reroutes to a different harness, because that would change the read-only fidelity class behind the user's back.
- **Setup wizard step 2.** When a usable `cli-session` verdict is reported, the step offers "Use your Claude subscription — no API key needed", which saves an anthropic provider config with no key and continues.
- **Raw-report banner.** A report with `reportMode: "raw"` now says why it is unsynthesized and links to the provider settings. Keyed on the host-stamped field, never on text in the report body.

Tell "not installed" apart from "not authenticated", and answer "would this run?" in one place (#518, closes #517).

- **One shared gate.** `@prismalens/config/harness-selection` now owns the worker's job-time logic — provider-scoped key, protocol compatibility, harness setting, env override — and the worker, the setup-status predicate and the Settings picker all call it. They used to answer the same question from different inputs, which produced a badge saying usable for a job the worker refused, a warning against a working config, and a setup step going green on one that throws.
- **Honest remedies.** `HarnessAuthVerdict` carries a `cause` (`not-installed` / `not-authenticated` / `not-implemented`), so a machine with no Claude Code is told the CLI is missing instead of being sent to run `claude /login`, which it does not have.
- **Agents that cannot run are disabled** in the picker, with their reason on screen, and the card states plainly when no agent is available at all.
