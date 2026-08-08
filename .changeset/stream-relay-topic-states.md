---
"prismalens": patch
---

A client that joins an investigation's live stream partway through no longer loses the first events it should have seen. The relay carried a counter that suppressed as many live events as it had just replayed, guarding against an event arriving in the middle of the replay — which cannot happen, because the replay is synchronous. The counter never dropped a duplicate; it dropped the first genuinely new events of every late joiner.

Opening an investigation's stream more than a minute after the run finished no longer hangs. The relay treated "no buffer for this id" as "assume the run is live", so once a completed run's buffer expired the endpoint answered 200 with no events and never closed. The relay now distinguishes a live run from one it holds nothing for, and closes the stream immediately in the latter case, so the client can fall back to the investigation's stored event record.

An investigation that runs longer than ten minutes no longer has its live stream cut off. The relay's cleanup of abandoned buffers measured a run's total age, so at minute ten it closed the stream and stopped relaying a run that was still working, with nothing to reconnect it. Cleanup now measures silence instead: a run that is still producing events is never swept, however long it takes.
