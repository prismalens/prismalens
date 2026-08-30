---
"prismalens": patch
---

Surface harness credential routes in the app (#501, ADR-0031).

- **Settings → AI Provider → "Investigation agent".** Pick `Auto` or an implemented harness, each badged from `GET /settings/harnesses`: signed-in Claude session, API key, or not authenticated with the server's own remedy text. Pinning a harness whose credential is missing, or whose protocol does not match the active provider, shows the mismatch inline — PrismaLens never reroutes to a different harness, because that would change the read-only fidelity class behind the user's back.
- **Setup wizard step 2.** When a usable `cli-session` verdict is reported, the step offers "Use your Claude subscription — no API key needed", which saves an anthropic provider config with no key and continues.
- **Raw-report banner.** A report with `reportMode: "raw"` now says why it is unsynthesized and links to the provider settings. Keyed on the host-stamped field, never on text in the report body.
