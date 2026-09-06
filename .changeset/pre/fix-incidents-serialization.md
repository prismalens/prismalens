---
"prismalens": patch
---

Correct the `IncidentWithRelations` type so it matches the rows the incident queries actually return — the joined `service` is the full Service row (`service: true`), and investigations carry `completedAt`. Adds a regression guard pinning both the query shape and the serialized payload's conformance to the oRPC output contract (#320).
