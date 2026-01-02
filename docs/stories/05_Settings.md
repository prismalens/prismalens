Part 5: Global Settings
Story 5.1: Settings Overview
Screen: /settings User action: Clicks "Settings" in navbar

┌─────────────────────────────────────────────────────────────┐
│  Settings                                                    │
│  ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━  │
│                                                              │
│  ┌──────────────────┐                                       │
│  │  AI Provider     │  Configure your LLM provider          │
│  │  Integrations    │  Connect external tools               │
│  │  Webhooks        │  Incoming alert endpoints             │
│  │  Correlation     │  Alert grouping rules                 │
│  │  Team            │  User management (optional)           │
│  │  Danger Zone     │  Reset and delete data                │
│  └──────────────────┘                                       │
│                                                              │
│  ══════════════════════════════════════════════════════════ │
│  AI PROVIDER                                                │
│  ══════════════════════════════════════════════════════════ │
│                                                              │
│  PrismaLens uses AI to investigate incidents. Configure     │
│  your preferred LLM provider below.                         │
│                                                              │
│  Current Provider: Google Gemini  ● Connected               │
│                                                              │
│  Provider:  [Google Gemini ▼]                               │
│  API Key:   [••••••••••••••••••••]  [Show] [Update]         │
│  Model:     [gemini-2.0-flash ▼]                            │
│                                                              │
│  [ ] Save to .env file (persists across restarts)           │
│                                                              │
│                                          [Test Connection]  │
│                                                              │
│  ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━  │
│                                                              │
│  ══════════════════════════════════════════════════════════ │
│  GLOBAL INTEGRATIONS                           [+ Connect]  │
│  ══════════════════════════════════════════════════════════ │
│                                                              │
│  Global integrations are available to all services unless   │
│  overridden at the service level.                           │
│                                                              │
│  ┌────────────────────────────────────────────────────────┐ │
│  │  GitHub - Acme Organization                    ● On   │ │
│  │  oauth · Connected · Used by 5 services               │ │
│  │                                    [Test] [Configure] │ │
│  ├────────────────────────────────────────────────────────┤ │
│  │  Prometheus - Production                       ● On   │ │
│  │  api_key · Connected · Used by 3 services             │ │
│  │                                    [Test] [Configure] │ │
│  ├────────────────────────────────────────────────────────┤ │
│  │  Slack - Engineering Workspace                 ● On   │ │
│  │  oauth · Connected · Used by 2 services               │ │
│  │                                    [Test] [Configure] │ │
│  └────────────────────────────────────────────────────────┘ │
│                                                              │
└─────────────────────────────────────────────────────────────┘

### API Interactions
*   **List Global Connections**: `GET /api/integrations/connections?global=true`
*   **Get LLM Config**: `GET /api/settings/llm` (*Missing - Proposed*)

Story 5.2: Add Integration Modal
Screen: /settings → Click "+ Connect"

┌─────────────────────────────────────────────────────────────┐
│                                                              │
│  ┌───────────────────────────────────────────────────────┐  │
│  │                                                        │  │
│  │  Connect Integration                              [X] │  │
│  │  ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ │  │
│  │                                                        │  │
│  │  Choose an integration to connect:                    │  │
│  │                                                        │  │
│  │  ┌─────────────────┐ ┌─────────────────┐             │  │
│  │  │   [GitHub]      │ │  [Prometheus]   │             │  │
│  │  │   Code & Git    │ │    Metrics      │             │  │
│  │  │   OAuth/Token   │ │    API Key      │             │  │
│  │  └─────────────────┘ └─────────────────┘             │  │
│  │                                                        │  │
│  │  ┌─────────────────┐ ┌─────────────────┐             │  │
│  │  │   [Slack]       │ │  [More Soon]    │             │  │
│  │  │  Notifications  │ │   Datadog,      │             │  │
│  │  │   OAuth/Webhook │ │   PagerDuty...  │             │  │
│  │  └─────────────────┘ └─────────────────┘             │  │
│  │                                                        │  │
│  └───────────────────────────────────────────────────────┘  │
│                                                              │
└─────────────────────────────────────────────────────────────┘
After selecting GitHub:

┌─────────────────────────────────────────────────────────────┐
│  │  Connect GitHub                                   [X] │  │
│  │  ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ │  │
│  │                                                        │  │
│  │  Connection Name:                                     │  │
│  │  [Production GitHub                        ]          │  │
│  │                                                        │  │
│  │  Authentication Method:                               │  │
│  │  ┌─────────────────────────────────────────────────┐ │  │
│  │  │ (●) Personal Access Token (simpler)             │ │  │
│  │  │ ( ) OAuth App (recommended for teams)           │ │  │
│  │  └─────────────────────────────────────────────────┘ │  │
│  │                                                        │  │
│  │  Personal Access Token:                               │  │
│  │  [ghp_xxxxxxxxxxxxxxxxxxxxxxxxxxxx      ]             │  │
│  │  Needs scopes: repo, read:org, read:user              │  │
│  │  → Create token at github.com/settings/tokens         │  │
│  │                                                        │  │
│  │  Organization (optional):                             │  │
│  │  [acme-corp                               ]           │  │
│  │                                                        │  │
│  │  [✓] Make available to all services (global)         │  │
│  │                                                        │  │
│  │                      [Cancel]    [Test & Connect]     │  │
│  │                                                        │  │
└─────────────────────────────────────────────────────────────┘

### API Interactions
*   **List Definitions**: `GET /api/integrations/definitions`
*   **Create Connection**: `POST /api/integrations/connections`
*   **Test Connection**: `POST /api/integrations/connections/:id/test`
*   **OAuth Authorize**: `GET /api/integrations/oauth/:provider/authorize`

Story 5.3: Webhook Configuration
Screen: /settings → Webhooks section

┌─────────────────────────────────────────────────────────────┐
│  ══════════════════════════════════════════════════════════ │
│  WEBHOOK ENDPOINTS                                          │
│  ══════════════════════════════════════════════════════════ │
│                                                              │
│  Send alerts to these endpoints from your monitoring tools. │
│                                                              │
│  Generic Webhook (any JSON format)                          │
│  ┌─────────────────────────────────────────────────────┐   │
│  │ POST http://localhost:5367/api/webhooks/generic     │   │
│  │                                              [Copy] │   │
│  └─────────────────────────────────────────────────────┘   │
│                                                              │
│  Prometheus AlertManager                                    │
│  ┌─────────────────────────────────────────────────────┐   │
│  │ POST http://localhost:5367/api/webhooks/prometheus  │   │
│  │                                              [Copy] │   │
│  └─────────────────────────────────────────────────────┘   │
│  Configure in alertmanager.yml:                            │
│  ```yaml                                                   │
│  receivers:                                                │
│    - name: prismalens                                      │
│      webhook_configs:                                      │
│        - url: 'http://localhost:5367/api/webhooks/prometheus'│
│  ```                                                       │
│                                                              │
│  GitHub Webhooks                                            │
│  ┌─────────────────────────────────────────────────────┐   │
│  │ POST http://localhost:5367/api/webhooks/github      │   │
│  │                                              [Copy] │   │
│  └─────────────────────────────────────────────────────┘   │
│  Events: workflow_run, deployment_status, security_alert   │
│                                                              │
│  ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━  │
│                                                              │
│  Recent Webhook Activity                                    │
│  ─────────────────────────────────────────────────────────  │
│  • 10:42 AM - prometheus - HighCPU alert received          │
│  • 10:38 AM - github - deployment_status (success)         │
│  • 10:15 AM - prometheus - MemoryWarning alert received    │
│                                                              │
└─────────────────────────────────────────────────────────────┘

### API Interactions
*   **Generic Webhook**: `POST /api/webhooks/generic`
*   **GitHub Webhook**: `POST /api/webhooks/github`
*   **Prometheus Webhook**: `POST /api/webhooks/prometheus` (*Missing in Controller*)

Story 5.4: Correlation Rules
Screen: /settings → Correlation section

┌─────────────────────────────────────────────────────────────┐
│  ══════════════════════════════════════════════════════════ │
│  CORRELATION RULES                             [+ Add Rule] │
│  ══════════════════════════════════════════════════════════ │
│                                                              │
│  Correlation rules determine how alerts are grouped into    │
│  incidents. Rules are evaluated in priority order.          │
│                                                              │
│  ┌───────────────────────────────────────────────────────┐  │
│  │  #1  Same Service, Same Hour                   [On]  │  │
│  │  ─────────────────────────────────────────────────────│  │
│  │  Match: Same service within 60 minute window          │  │
│  │  Action: Correlate to existing incident               │  │
│  │  Matched: 142 times                   [Edit] [Delete] │  │
│  ├───────────────────────────────────────────────────────┤  │
│  │  #2  Database Alerts                           [On]  │  │
│  │  ─────────────────────────────────────────────────────│  │
│  │  Match: Tags contain "database"                       │  │
│  │  Action: Group all matching alerts together           │  │
│  │  Matched: 28 times                    [Edit] [Delete] │  │
│  ├───────────────────────────────────────────────────────┤  │
│  │  #3  Suppress Flapping Alerts                  [On]  │  │
│  │  ─────────────────────────────────────────────────────│  │
│  │  Match: More than 5 occurrences in 5 minutes          │  │
│  │  Action: Suppress (don't create incident)             │  │
│  │  Matched: 15 times                    [Edit] [Delete] │  │
│  └───────────────────────────────────────────────────────┘  │
│                                                              │
│  Default Behavior (when no rules match):                    │
│  Create new incident for each unique alert                 │
│                                                              │
└─────────────────────────────────────────────────────────────┘

### API Interactions
*   **List Rules**: `GET /api/correlation/rules`
*   **Create Rule**: `POST /api/correlation/rules`
*   **Update Rule**: `PATCH /api/correlation/rules/:id`
*   **Delete Rule**: `DELETE /api/correlation/rules/:id`

