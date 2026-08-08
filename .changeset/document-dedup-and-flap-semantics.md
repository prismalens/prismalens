---
"prismalens": patch
---

The `pl listen` README now says what happens when the same alert is delivered twice, and points at a new page that spells out the rules in full: what counts as the same alert, what window governs that judgement, and what happens when an alert flaps. Behaviour is unchanged — the rules were simply never written down, and the CLI's answers turn out to differ from the app's on almost every question, including what the word "suppressed" means.
