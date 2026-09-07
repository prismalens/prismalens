---
"prismalens": patch
---

Investigations with invalid payloads now immediately mark their status as failed instead of remaining pending indefinitely. Automatically triggered investigations now bundle their alerts into the job payload, and alert responses exclude internal database columns. (#302)
