---
"prismalens": patch
---

The dispatch loop now prevents duplicate worker processes for the same investigation when claims are renewed or reclaimed. Setting `PRISMALENS_DISPATCH_ENABLED=false` is now rejected on startup because the API requires the in-process event bus to stream and cancel runs.
