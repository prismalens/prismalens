---
"prismalens": minor
---

Redis is no longer required to run PrismaLens. Job queueing and event streaming are now handled by an embedded SQLite job store and in-process event bus under a global concurrency cap.
