---
"prismalens": patch
---

fix(api,frontend): gate the investigate affordance on "a run would start", not "a provider is picked" (closes #521)

- The dashboard, the incident-detail header and the detail progress tab each derived their own `isLlmConfigured` boolean from `activeProvider` (and, latterly, from `harnesses.some((h) => h.runnable)`). Neither is the question the worker answers: a provider with no key, no model, an unusable harness or a protocol mismatch all read as ready, and the investigation was then refused.
- `GET /settings/harnesses` now carries a `selection` field — the shared `harness-selection` gate's verdict for the *current* configuration, including the persisted harness setting and the `PRISMALENS_HARNESS` override. The per-harness rows answer "if you pinned this one", which is a different question.
- All three surfaces consume one `useInvestigationReadiness()` hook over that field. When a run would not start they disable the affordance and render the gate's own reason verbatim, rather than a generic "configure an AI provider" string that can be wrong.
- The dashboard's warning banner is retitled "AI Investigations Unavailable" and carries the same reason, because "AI Provider Not Configured" was false for a configured-but-unusable provider.
