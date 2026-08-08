---
"prismalens": patch
---

Cancelling an investigation as it finishes no longer reruns it. The child disconnects its IPC channel the moment it has reported its result, while the runner deliberately withholds settlement until the child exits — so a cancel pressed in that window used to land on a closed channel, and the resulting error settled an investigation that had already succeeded as a retryable failure. A run that reported its verdict now keeps it.

Cancelling a run that nothing holds no longer leaves the job behind to run again. When the cancel request finds no receivers after every grace retry, the API writes the terminal record itself; it now cancels the orphaned job row in the same step, so the stale-claim sweeper cannot return a user-cancelled investigation to the queue and overwrite its terminal state.

The API container image now builds and ships `@prismalens/worker` and its workspace dependencies. The API forks that package as the per-run investigation child; it was absent from the image, so the child entrypoint could not be resolved and no investigation could start.
