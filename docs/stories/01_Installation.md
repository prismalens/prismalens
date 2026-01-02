Part 1: Installation & First Run
Story 1.1: Installing PrismaLens
Scenario: Developer discovers PrismaLens and wants to try it.

User runs: npx prismalens
   OR
User runs: npm install -g @prismalens/cli && prismalens start
System behavior:
CLI validates Node.js version (≥20.0.0)
Creates app data directory (~/.prismalens/)
Initializes SQLite database with migrations
Starts API server on port 5367
Opens browser to http://localhost:5367
CLI Output:

🔍 PrismaLens v1.0.0

✓ Database initialized at ~/.prismalens/prismalens.db
✓ API server running on http://localhost:5367
⚠ No LLM API key configured - AI features disabled

Open http://localhost:5367 to get started
Press Ctrl+C to stop
Story 1.2: First-Time Setup Wizard (Minimal)
Screen: /setup (redirected from / on first run) When: User opens PrismaLens for the first time (no LLM key configured) UI Flow:

┌─────────────────────────────────────────────────────────────┐
│  🔍 Welcome to PrismaLens                                   │
│                                                              │
│  AI-powered incident investigation for your applications    │
│                                                              │
│  ─────────────────────────────────────────────────────────  │
│                                                              │
│  Step 1 of 3: Create Owner Account                          │
│                                                              │
│  Create the administrator account for this instance.        │
│                                                              │
│  ┌─────────────────────────────────────────────────────┐   │
│  │ Email:     [admin@example.com                   ]    │   │
│  │ Password:  [•••••••••••••••••••••               ]    │   │
│  │ First Name:[John                                ]    │   │
│  │ Last Name: [Doe                                 ]    │   │
│  └─────────────────────────────────────────────────────┘   │
│                                                              │
│                        [Create Account]                      │
│                                                              │
│  ─────────────────────────────────────────────────────────  │
│  Already have an account? [Log In]                          │
└─────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────┐
│  Step 2 of 3: Configure AI Provider                         │
│                                                              │
│  PrismaLens uses LLMs to analyze incidents. Choose your     │
│  provider and enter your API key.                           │
│                                                              │
│  ┌─────────────────────────────────────────────────────┐   │
│  │ Provider:  [Google Gemini ▼]                         │   │
│  │            ○ Google Gemini (Recommended)             │   │
│  │            ○ OpenAI                                  │   │
│  │            ○ Anthropic                               │   │
│  │            ○ Azure OpenAI                            │   │
│  │            ○ Ollama (Local)                          │   │
│  └─────────────────────────────────────────────────────┘   │
│                                                              │
│  ┌─────────────────────────────────────────────────────┐   │
│  │ API Key:   [••••••••••••••••••••••]                  │   │
│  │            Get a key: https://aistudio.google.com    │   │
│  └─────────────────────────────────────────────────────┘   │
│                                                              │
│  [ ] Save key to .env file (for persistence)                │
│                                                              │
│                        [Continue →]                          │
│                                                              │
│  ─────────────────────────────────────────────────────────  │
│  Skip setup and configure later → (link)                    │
└─────────────────────────────────────────────────────────────┘

### API Interactions
*   **Create Owner**: `POST /api/users/setup` (Body: `{ email, password, firstName, lastName }`)
*   **Check Setup Status**: `GET /api/health` (Check if configured - *Proposed: GET /api/setup/status*)
*   **Save Configuration**: `POST /api/setup` (Save LLM key/initial config - *Missing*)

Step 3: Connect First Integration (Optional)

┌─────────────────────────────────────────────────────────────┐
│  Step 3 of 3: Connect Your First Tool (Optional)           │
│                                                              │
│  Connect a tool to give PrismaLens context for analysis.    │
│                                                              │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐      │
│  │   GitHub     │  │  Prometheus  │  │    Slack     │      │
│  │   [icon]     │  │    [icon]    │  │    [icon]    │      │
│  │  Code/Git    │  │   Metrics    │  │ Notifications│      │
│  │  [Connect]   │  │  [Connect]   │  │  [Connect]   │      │
│  └──────────────┘  └──────────────┘  └──────────────┘      │
│                                                              │
│  You can add more integrations later in Settings.           │
│                                                              │
│           [Skip for now]    [Go to Dashboard →]             │
└─────────────────────────────────────────────────────────────┘
After Setup:
Redirect to Dashboard (/)
Show "Getting Started" card with next steps
