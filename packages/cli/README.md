# prismalens

PrismaLens is an AI-powered root-cause investigation tool for on-call engineers. It analyzes firing alerts against your repositories and telemetry, producing an ordered-evidence report that ranks hypotheses by observed evidence without synthetic confidence scores. The CLI runs standalone or boots the full local application.

## Install

Requires Node.js 24+.

```bash
npm install -g prismalens
```

## Quick start

Check the environment, then start the web interface or run an investigation directly:

```bash
prismalens doctor
pl up
pl investigate --repo . --query "checkout latency spike after 14:00 UTC"
```

## Commands

| Command | Description |
| --- | --- |
| `up` | Run PrismaLens as a single process serving the API and web dashboard. |
| `investigate` | Run a root-cause investigation on a firing alert or query. |
| `listen` | Start a local HTTP webhook receiver for incoming Alertmanager alerts. |
| `serve` | Run the JSON-RPC server over stdio for desktop and API integrations. |
| `doctor` | Preflight-check the environment for harness binaries and credentials. |
| `init` | Scaffold a default configuration file in the current directory. |
| `status` | List recent investigation runs and their execution states. |
| `report` | Display the stored investigation report for a specific run ID. |
| `auth` | Manage stored credentials for model providers. |

## Documentation

Complete documentation, guides, and configuration references are available at https://docs.prismalens.io.

## License

Apache-2.0

