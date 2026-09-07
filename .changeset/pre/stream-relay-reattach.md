---
"prismalens": patch
---

Retrying an investigation now streams new events from a clean buffer instead of inheriting the previous attempt's completed stream, preventing retries from appearing inactive or ending prematurely.
