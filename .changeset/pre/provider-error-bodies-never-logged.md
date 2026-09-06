---
"prismalens": patch
---

integrations: never put a provider response body in a thrown error (#347)

A non-2xx provider response used to be rendered into the error message
verbatim, and the OAuth callback handler logs that error. A token endpoint
routinely echoes what it was sent, so a bearer token, a refresh token, the
authorization code or the client credentials could be written to logs — and on
the refresh path, persisted on the connection row.

The four call sites that did this — the OAuth2 code exchange plus the GitHub,
Vercel and Render API clients — now share one helper that reads nothing from
the response except the status code. The error still names the operation, the
provider and the HTTP status, so a reader can still tell which call failed and
why. The reason phrase is looked up from the status code rather than taken
from the provider's `statusText`, and the OAuth `error` field is fenced against
the codes registered in RFC 6749 §5.2 / RFC 8628 §3.5 rather than echoed;
`error_description` is dropped. A malformed 2xx body no longer surfaces the raw
`SyntaxError` either, since `JSON.parse` quotes the input it choked on — a
truncated token response quotes the token.

Regression tests assert that a sentinel secret placed in the body, the reason
phrase, the OAuth error field or a truncated JSON body reaches none of the
thrown error's message, string form, stack or serialized form.
