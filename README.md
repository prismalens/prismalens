# PrismaLens

Open-source AI-powered incident analysis and root cause detection.

> "The n8n for DevOps" - Transparent, local-first investigation engine that runs inside your infrastructure.

## Features

- **AI-Powered Root Cause Analysis** - Multi-agent system that investigates incidents autonomously
- **Investigation Canvas** - Visual DAG showing the agent's reasoning path
- **Institutional Memory** - Learns from past incidents using vector embeddings
- **Model Agnostic** - BYOK (Bring Your Own Key) via LiteLLM - works with OpenAI, Anthropic, Gemini, or local models
- **Self-Hostable** - Run entirely on your infrastructure with full data control

## Quick Start

### Docker (Recommended)

```bash
# Clone the repository
git clone https://github.com/prismalens/prismalens.git
cd prismalens

# Copy environment template
cp .env.example .env
# Edit .env with your API keys

# Start the stack
docker compose up
```

Access the UI at http://localhost:5367

### Development Setup

```bash
# Prerequisites: Node.js 20+, pnpm 9+, Python 3.13+, uv

# Install dependencies
pnpm install

# Start the frontend
pnpm dev:web

# Start the API (in another terminal)
pnpm dev:api
```

## Architecture

```
Alert → Alert Agent → Gatherer Agent → Analyzer Agent → Recommender Agent
       (validation)    (context)        (analysis)      (recommendations)
```

### Agents

1. **Alert Agent** - Validates and normalizes incoming alerts
2. **Gatherer Agent** - Collects context (logs, code, metrics)
3. **Analyzer Agent** - Performs root cause analysis
4. **Recommender Agent** - Generates actionable recommendations

## Configuration

See [.env.example](.env.example) for all configuration options.

### LLM Providers

PrismaLens supports multiple LLM providers via LiteLLM:

```bash
# Google Gemini (default)
LITELLM_PROVIDER=google
GOOGLE_API_KEY=your-key

# OpenAI
LITELLM_PROVIDER=openai
OPENAI_API_KEY=your-key

# Anthropic
LITELLM_PROVIDER=anthropic
ANTHROPIC_API_KEY=your-key
```

## Community vs Enterprise

| Feature | Community | Enterprise |
|---------|-----------|------------|
| Deployment | Docker Compose | Kubernetes |
| Database | PostgreSQL | PostgreSQL HA |
| Authentication | Basic Auth | SSO (SAML/OIDC) |
| Execution | Synchronous | Async Queue |
| Integrations | Read-only | Jira, PagerDuty, Slack |
| Support | GitHub Issues | SLA-backed |

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for guidelines.

## License

Elastic License v2 (ELv2) - See [LICENSE](LICENSE)