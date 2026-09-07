---
"prismalens": patch
---

Alert labels, annotations, tool-output previews and agent transcripts now render inside fences when they reach an investigation prompt, so text an attacker controls cannot address the model directly. Nothing is filtered or truncated, and an injection attempt still reaches the model to be reported. (#229)
