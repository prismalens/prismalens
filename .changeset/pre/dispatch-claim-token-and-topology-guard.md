---
"prismalens": patch
---

A dispatch loop can no longer run two children for one investigation. Claims are now owned by a token minted per attempt rather than per process, so a run whose job was reclaimed and re-claimed — including by the loop that is already running it, after its heartbeats failed for longer than the staleness cutoff — discovers on its next heartbeat that it was displaced, instead of heartbeating a claim that had been rewritten as itself. A loop handed a job it is already running now kills and silences the displaced attempt before starting its replacement, rather than overwriting its handle and leaving a child that nothing could kill, whose dying end-of-stream would have truncated the replacement's live stream.

`PRISMALENS_DISPATCH_ENABLED=false` is refused at boot instead of quietly starting an API process that cannot serve the runs it accepts. The EventBus is in-process only, so a process that serves the API without running the dispatch loop streams no events and receives no cancel — and then writes a terminal state over a run that is still executing. The flag's description said the opposite; it now documents the constraint.
