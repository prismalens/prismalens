---
"prismalens": patch
---

The live investigation stream panel groups branches only when a run really fanned out, and stops fighting the reader's scroll (#280).

- Branch chrome — the count badge and the collapsible per-branch sections — now keys off the number of distinct branches, not off the branch id being something other than `"root"`. A run with one branch named anything else was rendered as a fan-out: the badge read `1 branches` and the single branch was buried in a collapsible section instead of the flat list. Two ordinary paths hit that: a real fan-out emits `b0` before `b1` arrives, and a cancelled run's terminal event is stamped `supervisor`.
- Auto-scroll follows new events only while the reader is at the tail. It previously forced the viewport to the bottom on every event, so scrolling up to re-read an earlier step during a live investigation was undone by the next event to arrive. Scrolling back to the bottom resumes following.
- Opening a different investigation no longer inherits the previous one's stream. Changing the `$id` param re-renders the detail route in place rather than remounting it, so the panel carried its tail-follow state across — a reader who had scrolled up in one investigation found the next one silently not following its own tail — and the stream hook carried the previous run's events, rendering them under the new investigation until it produced its own. The panel is now keyed to the investigation, and the hook clears its state when it re-subscribes.
