---
"prismalens": patch
---

Incident API responses now restrict serialized service fields to an explicit allowlist, preventing internal database columns like `tenantId` and `discoveryMetadata` from leaking into responses. (#532)
