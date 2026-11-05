# Judging a UI change

How a UI change is reviewed beyond `pnpm ui:check`. The checks catch what can be measured; this file covers what needs judgement, cheaply and the same way each time. `GUIDELINES.md` holds the rules; `CONTRIBUTING.md` (UI changes) says which review a PR needs.

## What a judge sees

- Native-resolution screenshots from `pnpm ui:shots` (the design matrix: every screen and state at 1280, 768 and 390 px, dark and light), never a downscaled contact sheet for small text. Crop to the region in question instead of shrinking the page.
- `measures.md` written from the same run (`matrix.json`): axe AA contrast, targets under 24 px, clipped text, sideways scroll, console errors. Judges use these numbers and never estimate contrast from pixels.
- Two reference apps, A and B: comparable agent desktop apps the maintainer keeps screenshots of outside the repo. They calibrate the scale; the app is never scored against an absent baseline.

## Rubric (score each 1 to 10, with evidence)

Evidence per score is the file and the element plus a heuristic number, or a named gap to app A or B. A score above an anchor needs a named screen and element. Mark anything you could not confirm.

1. **Hierarchy:** the one thing to do on each screen is obvious.
2. **Consistency:** radius, type, icons, labels and names match across screens (H4).
3. **Empty states:** calm, short, and say how to fill them (H8, H9, H10).
4. **Density and restraint:** nothing that does not earn its place (H8).
5. **Colour and contrast:** sparse, meaningful colour; measured contrast, not pixels (H1, H8).
6. **Navigation:** a stranger can tell where each thing lives; one place per thing; every nav item's purpose is clear without opening it (H2, H4, H6).
7. **First-use clarity:** a stranger can do the first tasks; every action acknowledges at once and the next step is obvious (H1, H6, H9).
8. **Operations fit** (written anchors, no reference app):
   - 9: on returning to Home, without interaction, I know what happened while away, what needs me and why, and who or what started each thread; an alert's report is two clicks away with no jargon.
   - 7: all of that is findable through visible labels, but at least one item needs another view.
   - 5: alerts link to their conversations, but nothing integrates what changed, what needs attention and why.
   - 3: events and chat live in separate places that do not refer to each other.

The bar for a release-shaping UI change is 8.5 in every category, merged across two judges (below).

## Heuristics (cite the number)

1 Visibility of system status. 2 Match the real world. 3 User control and freedom. 4 Consistency and standards. 5 Error prevention. 6 Recognition rather than recall. 7 Flexibility and efficiency. 8 Aesthetic and minimalist design. 9 Help users recover from errors. 10 Help and documentation.

## Calibration

Score the reference apps first, blind and independently, and keep the agreed anchors; re-run only when the reference shots change. The anchors in use:

| Category | App A | App B | What separates them |
| :- | :-: | :-: | :- |
| Hierarchy | 8.5 | 6.5 | One greeting directly over the composer, against a composer low on the page and a diff view that splits attention |
| Consistency | 8 | 8.5 | A persistent rail and one composer everywhere beat small wording drift |
| Empty states | 7 | 7 | A ready composer, but a prerequisite (environment, project) with no hint or create action beside it |
| Density | 8.5 | 5.5 | Folded long requests and history in its own panel, against twenty near-identical truncated titles and three panes at once |
| Colour | 7.5 | 6.5 | One small accent and semantic colour only, against red on dark red and tinted diff rows |
| Navigation | 7.5 | 5.25 | Labelled destinations, against an unlabelled icon rail |
| First-use | 7.5 | 6 | One question over one composer with an unclear order of prerequisites, against a prompt that names none |

## Judges and merging

Two judges, each a fresh delegate given only the files above and the prompt below, never the author's context:

- **The adversary seat** (a strong reviewer model at high effort, read-only) decides hierarchy, navigation and first-use, where its stricter reading has been the better predictor of what confuses a stranger.
- **The side lane** (a fast model) decides colour, where it reads measured contrast and semantic colour well.
- Every other category is the mean of the two.

A judge's 9 with weaker evidence than the other's 8 does not raise the merged score; disagreements that persist go to the maintainer.

## The scoring prompt

```text
Score app P across the whole UI. Read-only: change no files except the result file named at the end, if one is named.
Context: app P is a vendor-neutral harness over coding agents; a user chats with their agent, and alerts, webhooks and schedules also start threads the agent works on.
Read: JUDGE.md (rubric, heuristics, calibration), the matrix shots at native resolution, and measures.md (use its numbers; never estimate contrast from pixels).
1. First impression from Home, a populated Home and the board: what is this app, and would a stranger try it? Two sentences.
2. Score all eight categories against the anchors. A score above an anchor needs a named screen and element. For First-use, add one "feedback and next step" line.
3. List every flaw that keeps a category below 8.5, with file, element and heuristic number.
4. A ranked fix list, up to ten, each with the element and the concrete change.
5. For a thread page change, the acceptance test: with every panel closed, at 1280, 768 and 390, can an operator tell what is affected, whether the alert still fires, what the agent concluded and what to do next?
Since the last scoring, these changed: <list>. Mark anything you could not confirm, and say where you looked.
```

## Task walks

When navigation or a whole screen changes, add a stranger walk: a fresh delegate with no context gets five tasks (start a chat; find the thread an alert started; approve what is waiting; find where schedules live; tell whether a service is healthy) and reports its clicks, wrong turns, and **what looked odd, misled or confused it**, not only whether it finished.
