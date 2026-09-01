---
"prismalens": minor
---

Replace BullMQ/Redis with an in-process dispatch layer: a SQLite JobStore (claim / heartbeat / reclaim-as-rerun) and an EventBus carrying the SSE relay and cancel, under a global concurrency cap — Redis is no longer a dependency of running the app.
