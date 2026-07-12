---
"prismalens": patch
---

Fix issue where starting `pl listen` against a stale workspace DB hard-crashes at startup by automatically backing up the incompatible DB file and creating a fresh store.
