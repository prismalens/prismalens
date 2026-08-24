---
"prismalens": minor
---

feat(api,frontend): mapping-health query + an honest "Alert Mapping Issues" card (closes #452, #294)

- Adds `GET /alert-mapping/health` to compute mapping health across services and mapping rules over a configurable bounded window.
- Distinguishes unmapped services, dead rules that have never matched any alert, and inactive rules that have stopped matching.
- Replaces the hardcoded placeholder card removed in #284 with a live `Alert Mapping Issues` NeedsAttentionCard on the Command Center dashboard, querying the real issue total and linking to `/rules?tab=mapping`.
- Surfaces unmapped services and inline rule health badges on `/rules?tab=mapping`.
