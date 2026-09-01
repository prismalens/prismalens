---
"prismalens": patch
---

Fix worker child-process 401 errors when writing investigation status and timeline entries (#535). The worker's `create()` and `fail()` calls now reach the internal REST endpoints (`PATCH /internal/investigations/:id/status` and `POST /internal/timeline`) using `X-Internal-Secret`, instead of the session-guarded oRPC routes that always returned 401 for the unauthenticated child process. A second pre-existing defect is also corrected: the internal controllers' request bodies were silently undefined because the app boots with `bodyParser: false` (required for oRPC) and no body-parsing middleware was scoped to the internal routes; `InternalModule` now applies `express.json()` for those four controllers.
