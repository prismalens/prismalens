---
"prismalens": patch
---

Provider error responses are no longer copied into thrown errors, so a token or client secret echoed back by a provider cannot reach the logs or the connection row. Errors still name the provider, the operation and the HTTP status. (#347)
