# prismalens

PrismaLens is a self-hosted incident investigator. When an alert arrives, the
coding agent you already use reads a snapshot of the service's code, under a
permission level you pick, and writes an ordered-evidence report: hypotheses
ranked by the evidence behind them, with no numeric confidence scores. The run,
the evidence and the cause stay on the incident. The agent runs as your user;
PrismaLens adds no sandbox. This package is the `pl` command: it starts the
app, checks a machine, pairs devices and manages a background service.

## Install

PrismaLens is alpha: any 0.x release may break, so read the
[release notes](https://github.com/prismalens/prismalens/releases) before upgrading.

### npm

Needs Node.js 24+.

```bash
npm install -g prismalens
```

To try it once without installing, run `npx prismalens@latest up`.

### macOS and Linux, without Node

```bash
curl -fsSL https://prismalens.io/install.sh | sh
```

### Windows, without Node (preview)

```powershell
irm https://prismalens.io/install.ps1 | iex
```

Both installers bring their own Node, check the download against the
release's `SHA256SUMS`, and put `pl` on your PATH.

### Homebrew, and Scoop (preview)

```bash
brew install prismalens/tap/prismalens
```

```powershell
scoop bucket add prismalens https://github.com/prismalens/scoop-bucket
scoop install prismalens
```

## Quick start

Check the machine, then start the app:

```bash
pl doctor
pl up
```

`pl up` serves the dashboard on http://localhost:6473 and opens your browser
on a one-time link that pairs it; there is no account. Investigations need a
coding agent: Settings → Agent in the app lists the ones that can run, and
Add agent sets one up. `pl doctor` checks PrismaLens's own setup, not agents.

## Commands

| Command | Description |
| --- | --- |
| `up` | Run PrismaLens as a single process serving the API and web dashboard (default port 6473); `--tailscale-serve` also publishes it on your tailnet over HTTPS. |
| `doctor` | Preflight-check PrismaLens's own setup: Node, the workspace, Git, the webhook URL and port; coding agents are set up in Settings → Agent. |
| `pair` | Print a one-time link that pairs another device with this instance, with `--tailscale` on its tailnet HTTPS address, or with `--operator` this machine's own browser. |
| `reset` | Delete the workspace — database, secrets and logs — after naming the path and asking. |
| `upgrade` | Upgrade the way PrismaLens was installed: npm, the installer, Homebrew or Scoop. A background service tries the new version first and goes back to the old one and its database if it fails. |
| `service` | Run PrismaLens in the background for this user (`install`, `status`, `restart`, `uninstall`); Linux and macOS. `install --tailscale-serve` publishes it on your tailnet over HTTPS on every start. |

## Documentation

Complete documentation, guides, and configuration references are available at https://docs.prismalens.io.

## License

Apache-2.0. The package also bundles the agent adapters, including the Claude
Agent SDK under Anthropic's own terms; `NOTICE` lists them and their licences.
