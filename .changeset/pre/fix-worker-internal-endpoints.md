---
"prismalens": patch
---

Worker processes now authenticate with internal API endpoints using the shared internal secret, resolving 401 errors and missing request bodies when saving investigation status and timeline events. (#535)
