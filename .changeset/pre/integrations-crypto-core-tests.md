---
"prismalens": patch
---

Integration credential handling now rejects successful HTTP responses that omit access tokens rather than storing undefined credentials. Sensitive credential masking now reliably redacts `snake_case` and `kebab-case` keys such as `api_key` and `access-token`. (#253)
