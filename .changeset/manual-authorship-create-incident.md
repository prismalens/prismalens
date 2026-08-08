---
"prismalens": patch
---

ui: create an incident by hand and investigate it, with no alert source wired (issue #286)

`/incidents` now offers **Create Incident** — in the page header and in the empty state a
fresh install actually lands in. The dialog calls the existing `incidents.create` procedure
and routes to the new incident, where **Start Investigation** runs the ordinary investigation
path on it. This is the demo journey for an install that has no Alertmanager pointed at it.

Both Start Investigation affordances on the incident detail page now respect the same
AI-provider gate; previously the Investigation tab offered a live button while the header's
was disabled.
