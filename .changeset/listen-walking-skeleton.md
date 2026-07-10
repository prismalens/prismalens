---
"prismalens": minor
---

New `pl listen` command (Phase 1 R1, #58): a token-authed local HTTP receiver
for Alertmanager webhooks. Each firing alert triggers a full investigation —
config, repo, and sandbox resolved per payload — with the report written to the
run workspace. Invalid payloads get a 4xx with the validation reason; a bounded
intake queue 503s overflow so Alertmanager's retry absorbs alert storms.
Configure via the new `listen: { port, token }` section (`pl init` scaffolds
it, `pl doctor` checks it).
