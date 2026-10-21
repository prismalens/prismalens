**Close this issue LAST - the milestone is not done while it is open.**

Minor release {{VERSION}}: the per-release checklist. The walk is the full walk; the steps are in [the release walk](https://github.com/prismalens/prismalens/blob/main/RELEASING.md).

- [ ] **Full release walk**, every step of the walkthrough, including step 1 (install), the step 5 to 6 run and `pnpm gate:side-checks`.
- [ ] **`cross-os-smoke` in registry mode** (`.github/workflows/cross-os-smoke.yml`) on the released {{VERSION}} artifact, which proves the published package installs and runs on Linux, macOS and Windows. Link the green 3-OS run here.
- [ ] **Docs sweep** for every identifier this release renamed or retired (env vars, config keys, flags, model ids, package names).
- [ ] **Walk findings** recorded in this issue, or in one linked `{{VERSION}} walk findings` issue.

Site and docs checks (from #118 - Standing phase-exit issue, SDLC hygiene):

- [ ] docs.prismalens.io updated: every new command, flag and config key this release shipped is documented (reference completeness), with input/output symmetry (what each command produces, where artifacts land).
- [ ] **Adversarial docs-review workflow (REUSE variant)** run against the updated site: the 5-lens review plus red-team verify from the hub procedure `docs-review-reuse-template`. Findings triaged: quick wins applied, over-engineering rejected explicitly.
- [ ] prismalens.io site matches what this release ships: every product claim on `/` and `/about` checked against the packed artifact and docs.prismalens.io; no retired command or flag described; "not yet" / "in development" lines removed for anything that shipped.
- [ ] Site imagery re-captured from a run on the packed release if the incident or report page changed: `site/public/screenshots/` and the evidence in `site/src/components/Refraction.astro`.
- [ ] If the tagline or positioning changed: OG card and README banners re-rendered from `brand/sheet.html`, and the banners copied to `.github/assets/` in this repo.
- [ ] Links validated on the **built** docs and site, not dev mode (relative .md links 404 in prod; starlight-links-validator).
- [ ] CHANGELOG narrative paragraph and ROADMAP.md "Where we are" reconciled in the platform repo.

Live test (from #120 - Standing phase-exit issue, scripted live test):

- [ ] Run the scripted live test against the **packed tarball** (not the source tree) on an sreforge incident scenario relevant to this release (validated: latency-cache-stampede, db-pool-exhaustion-deploy). Alert fires, then the PrismaLens path under test behaves end to end. Link the result (report/score) here.
- Rule: a deterministic script, not an agent-driven run. Agents are for evals; gates must not flake.

Hub close-out:

- [ ] Update the pinned roadmap #881 - Roadmap and handoff and run `mage index`.

🤖 Generated with [Claude Code](https://claude.com/claude-code)

Posted by an agent under the operator's account.
