# Installation

Deploy PrismaLens using Docker Compose (recommended for production) or the CLI (quick start).

## User Flow

```mermaid
flowchart TD
    A[Choose Method] --> B{Method}
    B -->|Quick Start| C[npx prismalens]
    B -->|Production| D[Docker Compose]

    C --> E[SQLite + Local Server]
    E --> F[http://localhost:5367]

    D --> G[Configure .env]
    G --> H[docker compose up]
    H --> I[PostgreSQL + Caddy]
    I --> J[https://your-domain.com]

    F --> K[Setup Wizard]
    J --> K
```

## Quick Start (CLI)

For trying out PrismaLens locally with minimal setup.

### Prerequisites
- Node.js >= 20.0.0

### Installation

```bash
npx prismalens
```

Or install globally:

```bash
npm install -g @prismalens/cli
prismalens start
```

### CLI Output

```
PrismaLens v1.0.0

  Database initialized at ~/.prismalens/prismalens.db
  API server running on http://localhost:5367
  No LLM API key configured - AI features disabled

Open http://localhost:5367 to get started
Press Ctrl+C to stop
```

### What Happens

1. CLI validates Node.js version
2. Creates app data directory (`~/.prismalens/`)
3. Initializes SQLite database with migrations
4. Starts API server on port 5367
5. Opens browser to setup wizard

---

## Docker Compose (Production)

For production deployments with PostgreSQL, SSL, and reverse proxy.

### Prerequisites
- Docker and Docker Compose
- Domain name (for SSL)

### Architecture

```mermaid
flowchart LR
    subgraph Docker
        CADDY[Caddy :5367]
        API[API :3001]
        FRONTEND[Frontend :3000]
        DB[(PostgreSQL)]
    end

    USER[User] --> CADDY
    CADDY -->|/api/*| API
    CADDY -->|/*| FRONTEND
    API --> DB
```

### Setup

1. **Clone the repository**

```bash
git clone https://github.com/prismalens-org/prismalens.git
cd prismalens
```

2. **Copy environment template**

```bash
cp .env.example .env
```

3. **Configure environment variables**

Edit `.env` with your settings:

```bash
# Required
DATABASE_URL=postgresql://prismalens:password@db:5432/prismalens
PRISMALENS_PUBLIC_URL=https://your-domain.com

# SSL (choose one)
DOMAIN=your-domain.com          # Let's Encrypt auto-SSL
# or
CADDY_TLS=internal              # Self-signed for local

# AI Provider (configure in UI or here)
GOOGLE_API_KEY=your-gemini-key  # Optional, can set in UI
```

4. **Start services**

```bash
docker compose up -d
```

5. **Access PrismaLens**

- With domain: `https://your-domain.com`
- Local: `https://localhost:5367`

### Docker Compose File

```yaml
# docker-compose.yml (simplified)
services:
  caddy:
    image: caddy:2-alpine
    ports:
      - "5367:5367"
      - "443:443"
    volumes:
      - ./docker/caddy/Caddyfile:/etc/caddy/Caddyfile

  api:
    image: ghcr.io/prismalens-org/prismalens-api:latest
    environment:
      - DATABASE_URL=${DATABASE_URL}
      - PRISMALENS_PUBLIC_URL=${PRISMALENS_PUBLIC_URL}
    depends_on:
      - db

  frontend:
    image: ghcr.io/prismalens-org/prismalens-frontend:latest
    environment:
      - VITE_API_URL=http://api:3001

  db:
    image: postgres:16-alpine
    volumes:
      - postgres_data:/var/lib/postgresql/data
    environment:
      - POSTGRES_USER=prismalens
      - POSTGRES_PASSWORD=password
      - POSTGRES_DB=prismalens

volumes:
  postgres_data:
```

---

## Environment Variables

Core configuration variables from `@prismalens/config`:

| Variable | Default | Description |
|----------|---------|-------------|
| `DATABASE_URL` | `file:./prismalens.db` | Database connection string |
| `PRISMALENS_PORT` | `3001` | API server port |
| `PRISMALENS_HOST` | `0.0.0.0` | API bind address |
| `PRISMALENS_PUBLIC_URL` | - | Public URL for OAuth callbacks |
| `PRISMALENS_WEBHOOK_URL` | - | External webhook callback URL |
| `DOMAIN` | - | Domain for Let's Encrypt SSL |

### AI Provider Variables

| Variable | Provider |
|----------|----------|
| `GOOGLE_API_KEY` | Google Gemini |
| `OPENAI_API_KEY` | OpenAI |
| `ANTHROPIC_API_KEY` | Anthropic Claude |
| `AZURE_OPENAI_API_KEY` | Azure OpenAI |
| `OLLAMA_BASE_URL` | Ollama (local) |

> Note: AI provider can be configured via environment variables or through the Settings UI after setup.

---

## Database Options

| Database | Use Case | Connection String |
|----------|----------|-------------------|
| SQLite | Development, CLI | `file:./prismalens.db` |
| PostgreSQL | Production | `postgresql://user:pass@host:5432/db` |

### Migrations

Migrations run automatically on startup. To run manually:

```bash
# Docker
docker compose exec api pnpm db:migrate

# CLI
prismalens db:migrate
```

---

## Caddy Configuration

PrismaLens uses Caddy as a reverse proxy with automatic HTTPS.

### SSL Options

**Let's Encrypt (production)**
```
# docker/caddy/Caddyfile
{$DOMAIN}:5367 {
    reverse_proxy /api/* api:3001
    reverse_proxy /* frontend:3000
}
```

**Self-signed (local)**
```
localhost:5367 {
    tls internal
    reverse_proxy /api/* api:3001
    reverse_proxy /* frontend:3000
}
```

---

## Health Check

Verify installation:

```bash
curl http://localhost:5367/health
```

Response:
```json
{
  "status": "ok",
  "version": "1.0.0",
  "database": "connected"
}
```

---

## API Interactions

| Endpoint | Method | Purpose | Status |
|----------|--------|---------|--------|
| `/health` | GET | Health check | Implemented |
| `/api/setup/status` | GET | Check if setup complete | Needs Implementation |

---

## Next Steps

After installation, proceed to:
- [Onboarding](./02_Onboarding.md) - Complete first-time setup
- [Dashboard](./03_Dashboard.md) - Start using PrismaLens

---

## Troubleshooting

### Port already in use

```bash
# Change port in .env
PRISMALENS_PORT=5368

# Or find and kill process
lsof -i :5367
```

### Database connection failed

```bash
# Check PostgreSQL is running
docker compose ps db

# Check connection string
docker compose exec api env | grep DATABASE_URL
```

### SSL certificate issues

```bash
# For local development, use self-signed
CADDY_TLS=internal docker compose up -d

# Check Caddy logs
docker compose logs caddy
```
