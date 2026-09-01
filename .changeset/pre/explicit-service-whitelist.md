---
"prismalens": patch
---

Enforce an explicit field whitelist when serializing the joined `service` relation on incidents in `serializeIncidentWithRelations`, preventing raw Prisma database columns (such as `tenantId` and `discoveryMetadata`) from leaking into API responses (#532).
