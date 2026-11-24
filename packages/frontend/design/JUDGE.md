# Judging a UI change

How a UI change is reviewed beyond `pnpm --filter @prismalens/frontend ui:check`. The checks catch what can be measured; this file covers what needs judgement, cheaply and the same way each time. `GUIDELINES.md` holds the rules; `CONTRIBUTING.md` (UI changes) says which review a PR needs. The bar's category list and the judging kit come from the bar issue (#1101): `pnpm registry render bar` prints the categories and `pnpm registry judge-pack` assembles a kit.

## What a judge sees

- Native-resolution screenshots from `pnpm --filter @prismalens/frontend ui:shots` (every screen and state at 1280, 768 and 390 px, dark and light). Crop to the region in question; never shrink the page into a contact sheet.
- `measures.md`, written from the same run: axe AA contrast, targets under 24 px, clipped text, sideways scroll, console errors. Judges use these numbers and never estimate contrast from pixels.
- Reference screenshots and calibration anchors supplied with the kit. A judge scores the references first, blind; the app is never scored against an absent baseline.

## Rubric

Score each category 1 to 10. Evidence per score is the file and element plus a heuristic number, or a named gap to a reference. A score above an anchor needs a named screen and element. Mark anything you could not confirm, and say where you looked.

1. **Hierarchy:** the one thing to do on each screen is obvious.
2. **Consistency:** radius, type, icons, labels and names match across screens (H4).
3. **Empty states:** calm, short, and say how to fill them (H8, H9, H10).
4. **Density and restraint:** nothing that does not earn its place (H8).
5. **Colour and contrast:** sparse, meaningful colour; measured contrast (H1, H8).
6. **Navigation:** a stranger can tell where each thing lives; one place per thing (H2, H4, H6).
7. **First-use clarity:** a stranger can do the first tasks; every action acknowledges at once and the next step is obvious (H1, H6, H9).
8. **Operations fit:**
   - 9: on returning to Home, without interaction, I know what happened while away, what needs me and why, and who or what started each thread; an alert's report is two clicks away with no jargon.
   - 7: all of that is findable through visible labels, but at least one item needs another view.
   - 5: alerts link to their conversations, but nothing integrates what changed, what needs attention and why.
   - 3: events and chat live in separate places that do not refer to each other.

Heuristics (cite the number): 1 Visibility of system status. 2 Match the real world. 3 User control and freedom. 4 Consistency and standards. 5 Error prevention. 6 Recognition rather than recall. 7 Flexibility and efficiency. 8 Aesthetic and minimalist design. 9 Help users recover from errors. 10 Help and documentation.

## Acceptance test for a thread page

With every panel closed, at 1280, 768 and 390 px, can an operator tell what is affected, whether the alert still fires, what the agent concluded and what to do next?

## Judges and merging

Two judges, each a fresh delegate given only the files above, never the author's context:

- A strong reviewer model at high effort, read-only, decides hierarchy, navigation and first-use.
- A fast model decides colour.
- Every other category is the mean of the two.

A judge's 9 with weaker evidence than the other's 8 does not raise the merged score. Disagreements that persist go to the maintainer. A release-shaping UI change needs 8.5 in every category after the merge.

## Task walks

When navigation or a whole screen changes, add a stranger walk: a fresh delegate with no context gets five tasks (start a chat; find the thread an alert started; approve what is waiting; find where schedules live; tell whether a service is healthy) and reports its clicks, wrong turns and **what looked odd, misled or confused it**, not only whether it finished.
