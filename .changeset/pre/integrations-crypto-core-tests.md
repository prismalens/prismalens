---
"prismalens": patch
---

Harden the integrations credential core: a provider response that returns 2xx without an access token is now rejected instead of storing a credential whose token is `undefined` (OAuth2 code exchange, OAuth2 refresh, and GitHub App installation-token exchange). Credential masking also matches snake_case and kebab-case field names such as `api_key` and `access-token`, which previously passed through unmasked. Adds the first test coverage for the credential vault, RS256 JWT minting, the OAuth2 authorization-code exchange, and concurrent token refresh (#253).
