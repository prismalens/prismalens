---
"prismalens": patch
---

engine: fence every untrusted-text surface reaching a Tier-1 prompt (#229)

Extends #207's DATA-ONLY fence to the surfaces that predate it. Alert payloads
(`alertname`, `severity`, `labels`, `annotations`, related alerts), the agent
transcript (including raw tool-result previews), and the reduce-merge incident
header now render inside fences built by one shared helper, so an attacker who
can write an alert annotation or a log line can no longer address the model
directly. Nothing is filtered or truncated — only the fence sentinels and the
invisible characters that could rebuild them are neutralised, so an injection
attempt still reaches the model to be reported. The engine README now carries
the complete, closed list of untrusted surfaces.
