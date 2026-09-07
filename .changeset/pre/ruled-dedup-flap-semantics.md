---
"prismalens": patch
---

A resolved alert that fires again within `PRISMALENS_ALERT_FLAP_WINDOW_MINUTES` (default 15) reopens its incident; outside the window it opens a new alert. Suppressed alerts stay suppressed. GitHub webhook redeliveries no longer create duplicate alerts. (#231)
