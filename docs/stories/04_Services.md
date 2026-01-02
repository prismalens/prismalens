Part 4: Services Configuration
Story 4.1: Services List
Screen: /services User action: Clicks "Services" in navbar

┌─────────────────────────────────────────────────────────────┐
│  Services                                      [+ Add Service]│
│  ─────────────────────────────────────────────────────────  │
│                                                              │
│  Your service catalog. Connect integrations for richer      │
│  AI-powered investigations.                                 │
│                                                              │
│  ┌───────────────────────────────────────────────────────┐  │
│  │                                                        │  │
│  │  🌐 api-gateway                               Tier 1  │  │
│  │  ───────────────────────────────────────────────────  │  │
│  │  Type: Gateway   Team: Platform                       │  │
│  │  Integrations: GitHub ✓  Prometheus ✓  Slack ✓       │  │
│  │  Active Incidents: 1   Auto-investigate: On           │  │
│  │                                            [Configure]│  │
│  │                                                        │  │
│  ├───────────────────────────────────────────────────────┤  │
│  │                                                        │  │
│  │  👥 user-service                              Tier 2  │  │
│  │  ───────────────────────────────────────────────────  │  │
│  │  Type: Service   Team: Backend                        │  │
│  │  Integrations: GitHub ✓  Prometheus ✓                │  │
│  │  Active Incidents: 1   Auto-investigate: High only    │  │
│  │                                            [Configure]│  │
│  │                                                        │  │
│  ├───────────────────────────────────────────────────────┤  │
│  │                                                        │  │
│  │  📦 background-jobs                           Tier 3  │  │
│  │  ───────────────────────────────────────────────────  │  │
│  │  Type: Service   Team: Backend                        │  │
│  │  Integrations: GitHub ✓                              │  │
│  │  Active Incidents: 0   Auto-investigate: Off          │  │
│  │                                            [Configure]│  │
│  │                                                        │  │
│  └───────────────────────────────────────────────────────┘  │
│                                                              │
└─────────────────────────────────────────────────────────────┘

### API Interactions
*   **List Services**: `GET /api/services`
    *   Params: `type`, `tier`, `team`, `limit`, `offset`

Story 4.2: Service Configuration
Screen: /services/api-gateway User action: Clicks "Configure" on a service

┌─────────────────────────────────────────────────────────────┐
│  ← Back to Services                                         │
│                                                              │
│  Configure: api-gateway                                     │
│  ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━  │
│                                                              │
│  ┌────────────────────────────────────────────────────────┐ │
│  │ General │ Integrations │ Investigation │ Dependencies │ │
│  └────────────────────────────────────────────────────────┘ │
│                                                              │
│  ══════════════════════════════════════════════════════════ │
│  GENERAL SETTINGS                                           │
│  ══════════════════════════════════════════════════════════ │
│                                                              │
│  Name:         [api-gateway                    ]            │
│  Display Name: [API Gateway                    ]            │
│  Description:  [Main API gateway for all public]            │
│                [endpoints                      ]            │
│                                                              │
│  Type:         [Gateway ▼]                                  │
│                ○ Service  ○ Database  ○ Queue               │
│                ○ Gateway  ○ Cache     ○ External            │
│                                                              │
│  Tier:         [Tier 1 - Critical ▼]                        │
│                Impact: Immediate response required          │
│                                                              │
│  Team:         [Platform Team                  ]            │
│  Slack:        [#platform-alerts               ]            │
│  Repository:   [org/api-gateway                ]            │
│                                                              │
│                               [Cancel]  [Save Changes]      │
│                                                              │
└─────────────────────────────────────────────────────────────┘

### API Interactions
*   **Get Service**: `GET /api/services/:id`
*   **Update Service**: `PATCH /api/services/:id`

Story 4.3: Service Integration Configuration
Screen: /services/api-gateway → Integrations tab

┌─────────────────────────────────────────────────────────────┐
│  Configure: api-gateway                                     │
│  ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━  │
│                                                              │
│  ┌────────────────────────────────────────────────────────┐ │
│  │ General │ Integrations │ Investigation │ Dependencies │ │
│  └────────────────────────────────────────────────────────┘ │
│                                                              │
│  ══════════════════════════════════════════════════════════ │
│  SERVICE INTEGRATIONS                          [+ Connect]  │
│  ══════════════════════════════════════════════════════════ │
│                                                              │
│  These integrations are used when investigating incidents   │
│  for this service. They override global integrations.       │
│                                                              │
│  ┌───────────────────────────────────────────────────────┐  │
│  │  [GitHub Logo]  GitHub - Production                   │  │
│  │  ─────────────────────────────────────────────────────│  │
│  │  Status: ● Connected    Auth: OAuth                   │  │
│  │  Repository Override: org/api-gateway (not org-wide)  │  │
│  │  Last used: 10 minutes ago                            │  │
│  │                                [Test] [Edit] [Remove] │  │
│  └───────────────────────────────────────────────────────┘  │
│                                                              │
│  ┌───────────────────────────────────────────────────────┐  │
│  │  [Prometheus Logo]  Prometheus - Production Cluster   │  │
│  │  ─────────────────────────────────────────────────────│  │
│  │  Status: ● Connected    Auth: API Key                 │  │
│  │  Default Query: container="api-gateway"               │  │
│  │  Last used: 3 minutes ago                             │  │
│  │                                [Test] [Edit] [Remove] │  │
│  └───────────────────────────────────────────────────────┘  │
│                                                              │
│  ┌───────────────────────────────────────────────────────┐  │
│  │  [Slack Logo]  Slack - Platform Alerts Channel        │  │
│  │  ─────────────────────────────────────────────────────│  │
│  │  Status: ● Connected    Auth: Webhook                 │  │
│  │  Channel: #platform-alerts                            │  │
│  │  Last used: 1 hour ago                                │  │
│  │                                [Test] [Edit] [Remove] │  │
│  └───────────────────────────────────────────────────────┘  │
│                                                              │
└─────────────────────────────────────────────────────────────┘

### API Interactions
*   **List Integrations**: `GET /api/integrations/services/:serviceId/integrations`
*   **Add Integration**: `POST /api/integrations/services/:serviceId/integrations`
*   **Remove Integration**: `DELETE /api/integrations/services/:serviceId/integrations/:connectionId`

Story 4.4: Service Investigation Settings
Screen: /services/api-gateway → Investigation tab

┌─────────────────────────────────────────────────────────────┐
│  Configure: api-gateway                                     │
│                                                              │
│  ┌────────────────────────────────────────────────────────┐ │
│  │ General │ Integrations │ Investigation │ Dependencies │ │
│  └────────────────────────────────────────────────────────┘ │
│                                                              │
│  ══════════════════════════════════════════════════════════ │
│  INVESTIGATION SETTINGS                                     │
│  ══════════════════════════════════════════════════════════ │
│                                                              │
│  Auto-Investigation                                         │
│  ─────────────────────────────────────────────────────────  │
│  Automatically start AI investigation when incidents are    │
│  created for this service.                                  │
│                                                              │
│  ┌─────────────────────────────────────────────────────┐   │
│  │  (●) Always auto-investigate                         │   │
│  │  ( ) Only for Critical and High severity             │   │
│  │  ( ) Only for Critical severity                      │   │
│  │  ( ) Never (manual trigger only)                     │   │
│  └─────────────────────────────────────────────────────┘   │
│                                                              │
│  Notification Settings                                      │
│  ─────────────────────────────────────────────────────────  │
│  [✓] Send Slack notification when investigation completes  │
│  [✓] Include root cause summary in notification            │
│  [✓] Mention users for Critical recommendations            │
│                                                              │
│  Analysis Context                                           │
│  ─────────────────────────────────────────────────────────  │
│  Additional context to provide to AI during investigation:  │
│  ┌─────────────────────────────────────────────────────┐   │
│  │ This is the main API gateway. It handles all public │   │
│  │ traffic and routes to internal microservices.       │   │
│  │ Common issues include rate limiting, upstream       │   │
│  │ service failures, and SSL certificate problems.     │   │
│  └─────────────────────────────────────────────────────┘   │
│                                                              │
│                               [Cancel]  [Save Changes]      │
│                                                              │
└─────────────────────────────────────────────────────────────┘

### API Interactions
*   **Update Investigation Settings**: `PATCH /api/services/:id` (Assuming part of Service entity)

