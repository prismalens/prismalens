---
"prismalens": patch
---

A client that joins an investigation's live stream partway through no longer loses the first events it should have seen. The relay carried a counter that suppressed as many live events as it had just replayed, guarding against an event arriving in the middle of the replay — which cannot happen, because the replay is synchronous. The counter never dropped a duplicate; it dropped the first genuinely new events of every late joiner.

Opening an investigation's stream more than a minute after the run finished no longer hangs. The relay treated "no buffer for this id" as "assume the run is live", so once a completed run's buffer expired the endpoint answered 200 with no events and never closed. The relay now distinguishes a live run from one it holds nothing for, and closes the stream immediately in the latter case.

That close is deliberately not reported as a clean finish. The API holds its stream buffers in memory, so "nothing here for this id" is also what a still-running investigation looks like to a process that has just restarted or has not yet reclaimed the job — and answering that with the same end-of-stream marker a genuinely finished run gets would make the page show a live investigation as completed, with nothing left to correct it. The stream is now ended without that marker, which is what the investigation page treats as a lost connection: it falls back to polling the run's status and picks the real outcome up from there.

An investigation that runs longer than ten minutes no longer has its live stream cut off. The relay's cleanup of abandoned buffers measured a run's total age, so at minute ten it closed the stream and stopped relaying a run that was still working, with nothing to reconnect it. Cleanup now measures silence instead: a run that is still producing events is never swept, however long it takes.
