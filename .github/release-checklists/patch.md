**Close this issue LAST - the milestone is not done while it is open.**

Patch release {{VERSION}}: the per-release checklist. The walk is scoped to the release; what a patch release does is in [RELEASING.md](https://github.com/prismalens/prismalens/blob/main/RELEASING.md).

- [ ] **Scoped release walk.** Walk the steps the release diff changed, plus the fixed core: step 1 (install), a minimal step 5 to 6 run (an alert in, an investigation out), and `pnpm gate:side-checks`. Each unchanged step carries forward with git-diff evidence that its files are untouched since the walk that last passed it.
- [ ] **`cross-os-smoke` in registry mode** (`.github/workflows/cross-os-smoke.yml`) on the released {{VERSION}} artifact, which proves the published package installs and runs on Linux, macOS and Windows. Link the green 3-OS run here.
- [ ] **Docs sweep** for every identifier this release renamed or retired (env vars, config keys, flags, model ids, package names).
- [ ] **Walk findings** recorded in this issue, or in one linked `{{VERSION}} walk findings` issue.

🤖 Generated with [Claude Code](https://claude.com/claude-code)

Posted by an agent under the operator's account.
