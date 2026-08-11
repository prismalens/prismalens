---
"prismalens": patch
---

Completing the setup wizard now leaves you signed in. `POST /api/setup` created
the owner through Better Auth server-side, so the `Set-Cookie` that a normal
sign-in returns never reached the browser — the app looked authenticated until
the first reload, which bounced a brand-new owner to the login screen. Setup now
establishes the session through the same `/sign-in/email` route the login form
posts to, and forwards its cookies on the setup response. The session is minted
after the owner role is written, so Better Auth's signed session cache carries
`role: owner` rather than the sign-up default.
