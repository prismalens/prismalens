---
"prismalens": patch
---

Clients that connect to a live investigation partway through now reliably see all events without dropping initial output. Completed investigation streams close promptly instead of hanging indefinitely, and long-running investigations no longer cut off after ten minutes.
