---
"prismalens": patch
---

Investigation event streams now survive a run retry. A second attempt on the same investigation starts from a clean replay buffer instead of inheriting the finished attempt's, which had made a live retry report as inactive, replayed the previous attempt's events plus an immediate end-of-stream to every client that connected, and let the previous attempt's cleanup timer discard the live attempt's buffer mid-run. Completing a stream twice also no longer strands the earlier buffer-cleanup timer.
