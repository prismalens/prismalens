# prismalens

PrismaLens is an AI-powered root-cause investigation tool for on-call engineers. It analyzes firing alerts against your repositories and telemetry, producing an ordered-evidence report that ranks hypotheses by observed evidence without synthetic confidence scores. The CLI runs standalone or boots the full local application.

## Install

Requires Node.js 24+.

```bash
npm install -g prismalens
```

## Quick start

Check the environment, then start the web interface:

```bash
prismalens doctor
pl up
```

## Commands

| Command | Description |
| --- | --- |
| `up` | Run PrismaLens as a single process serving the API and web dashboard. |
| `doctor` | Preflight-check the environment for a harness binary on PATH. |

## Documentation

Complete documentation, guides, and configuration references are available at https://docs.prismalens.io.

## License

Apache-2.0

