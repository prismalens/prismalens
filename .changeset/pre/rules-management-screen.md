---
"prismalens": minor
---

frontend: a `/rules` screen for correlation and alert-mapping rules (#294)

Correlation and alert-mapping rules existed only as API endpoints — twelve of
them, with no way to reach any from the app. `/rules` gives them one screen with
two tabs: list, create, edit, delete, and an enabled toggle per row, all
round-tripping to the real endpoints and re-rendering from a refetch rather than
local state. The action selector offers exactly the three actions the engine
honours (`correlate`, `suppress`, `create_incident`), and the duplicate-name
conflict from the server is shown in the dialog instead of being swallowed.

Each tab also carries a *Test with sample alert* dialog over the real
`POST /correlation/test` and `POST /alert-mapping/test`. Those endpoints evaluate
a sample alert against the **saved, enabled** rule set — there is no
test-before-save, and the dialog says so rather than implying otherwise.

Also fixes the alert-mapping list endpoint, which ignored its declared query
input and hard-filtered to enabled rules: a rule you switched off vanished from
the list with no way to switch it back on.
