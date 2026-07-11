---
"prismalens": minor
---

`pl listen` now sends a best-effort Slack notification when a group investigation finishes — successful, no-evidence, and errored runs all notify (an errored 3AM run is exactly what you want woken for); operator-cancelled runs don't. Set the single `listen.slack_webhook_url` config field to enable it; leave it unset and nothing is sent. Delivery is fire-and-forget with a 5s timeout and no retries, and a failed post can never change a run's outcome — it emits one structured `slack_delivery_failed` line and nothing more.
