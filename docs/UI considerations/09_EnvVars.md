Part 9: Environment Variables Reference

# === REQUIRED ===
# At least one LLM provider key is needed

# LLM Provider (choose one)
GOOGLE_API_KEY=...           # Google Gemini (recommended)
OPENAI_API_KEY=...           # OpenAI GPT-4
ANTHROPIC_API_KEY=...        # Anthropic Claude

# === OPTIONAL ===

# Database (default: SQLite in ~/.prismalens/)
PRISMALENS_DB_TYPE=sqlite    # or postgresql
PRISMALENS_DB_URL=...        # PostgreSQL connection string

# Server
PORT=5367                    # API server port
HOST=0.0.0.0                 # Bind address

# Security
PRISMALENS_ENCRYPTION_KEY=...  # 64-char hex for credential encryption

# Enterprise Features
REDIS_URL=...                # Enable async job queue
