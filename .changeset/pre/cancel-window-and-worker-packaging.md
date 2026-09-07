---
"prismalens": patch
---

Cancelling an investigation right as it finishes no longer marks it as failed or retriggers it. Cancelling an abandoned run cancels the queued job immediately so it cannot restart. The API container image now bundles the worker package so investigations can start properly.
