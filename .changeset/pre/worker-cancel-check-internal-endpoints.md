---
"prismalens": patch
---

Route worker investigation cancellation check and failure-handling writebacks through internal REST endpoints authenticated with `X-Internal-Secret` instead of session-guarded oRPC routes (#537). Add internal `GET /internal/investigations/:id` endpoint for the worker to verify investigation cancellation status before run execution. Remove dead `worker#lint` script from packages/worker (#529).
