**Close this issue LAST - the milestone is not done while it is open.**

Patch release {{VERSION}}: the per-release checklist. The walk is scoped to what CI cannot prove; what a patch release does is in [RELEASING.md](https://github.com/prismalens/prismalens/blob/main/RELEASING.md).

- [ ] **`CI gate` green on the release PR's base SHA.** It already proves the install, a run from an alert in to an investigation out, the side checks on Linux, macOS and Windows, the upgrade chain from every published release, and the browser suite.
- [ ] **Manual walk of the steps CI cannot prove**, for the ones the release diff touched; each unchanged one carries forward with git-diff evidence that its files are untouched since the walk that last passed it:
  - one real, signed-in agent run per agent and per OS;
  - `pl doctor`, and a private-repo clone through the real credential helper;
  - the desktop window, tray and notification;
  - Ctrl+C in a real terminal on Windows and macOS;
  - `pl upgrade` through npm on Windows (the scripted check is N/A there, #921);
  - WSL2, Tailscale and the phone, when their files changed.
- [ ] **`cross-os-smoke` in registry mode** (`.github/workflows/cli-smoke-cross-os.yml`) on the released {{VERSION}} artifact, which proves the published package installs and runs on Linux, macOS and Windows. Link the green 3-OS run here.
- [ ] **The release run's `Install from the real …` jobs green** (Homebrew tap, Scoop bucket), and a real `irm | iex` install of {{VERSION}} on Windows.
- [ ] **Docs sweep** for every identifier this release renamed or retired (env vars, config keys, flags, model ids, package names).
- [ ] **Walk findings** recorded in this issue, or in one linked `{{VERSION}} walk findings` issue.

🤖 Generated with [Claude Code](https://claude.com/claude-code)

Posted by an agent under the operator's account.
