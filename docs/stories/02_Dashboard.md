Part 2: Main Dashboard
Story 2.1: Empty State Dashboard
Screen: / (Dashboard) When: Fresh install, no alerts/incidents yet

┌─────────────────────────────────────────────────────────────┐
│  ┌─────┐                                                    │
│  │LOGO │  Dashboard   Incidents   Services   Settings      │
│  └─────┘                                           [?] [👤] │
├─────────────────────────────────────────────────────────────┤
│                                                              │
│  ┌─────────────────────────────────────────────────────────┐│
│  │  👋 Welcome to PrismaLens!                              ││
│  │                                                          ││
│  │  Get started by setting up your first webhook:          ││
│  │                                                          ││
│  │  1. Create a Service for your application               ││
│  │  2. Copy the webhook URL                                ││
│  │  3. Configure your monitoring tool to send alerts       ││
│  │                                                          ││
│  │  [Create First Service]    [View Documentation]         ││
│  └─────────────────────────────────────────────────────────┘│
│                                                              │
│  ┌─────────────────────────────────────────────────────────┐│
│  │  Webhook Endpoints                                       ││
│  │  ─────────────────────────────────────────────────────  ││
│  │  Generic:    POST http://localhost:5367/api/webhooks/   ││
│  │              generic                          [Copy]    ││
│  │  Prometheus: POST http://localhost:5367/api/webhooks/   ││
│  │              prometheus                       [Copy]    ││
│  │  GitHub:     POST http://localhost:5367/api/webhooks/   ││
│  │              github                           [Copy]    ││
│  └─────────────────────────────────────────────────────────┘│
│                                                              │
└─────────────────────────────────────────────────────────────┘

### API Interactions
*   **Check Incident Stats**: `GET /api/incidents/stats`
    *   Response: `{ active: 0, investigating: 0, resolved: 0 }`

Story 2.2: Active Dashboard
Screen: / (Dashboard) When: System has active incidents/alerts

┌─────────────────────────────────────────────────────────────┐
│  ┌─────┐                                                    │
│  │LOGO │  Dashboard   Incidents   Services   Settings      │
│  └─────┘                                           [?] [👤] │
├─────────────────────────────────────────────────────────────┤
│                                                              │
│  ┌────────────┐ ┌────────────┐ ┌────────────┐ ┌───────────┐│
│  │ Active     │ │ Investigating│ │ Resolved  │ │ Avg Time  ││
│  │ Incidents  │ │             │ │ Today     │ │ to Resolve││
│  │    12      │ │      3      │ │    8      │ │   23min   ││
│  │ ↑4 from    │ │             │ │           │ │ ↓12% from ││
│  │ yesterday  │ │             │ │           │ │ last week ││
│  └────────────┘ └────────────┘ └────────────┘ └───────────┘│
│                                                              │
│  ┌─────────────────────────────────────────────────────────┐│
│  │  Recent Incidents                      [View All →]     ││
│  │  ─────────────────────────────────────────────────────  ││
│  │                                                          ││
│  │  🔴 INC-42  High CPU usage on api-gateway               ││
│  │     Critical · api-gateway · 5 alerts · 12 min ago      ││
│  │     Status: Investigating    [View] [Investigate]       ││
│  │                                                          ││
│  │  🟡 INC-41  Database connection timeouts                ││
│  │     High · user-service · 3 alerts · 28 min ago         ││
│  │     Status: Triggered        [View] [Investigate]       ││
│  │                                                          ││
│  │  🟢 INC-40  Memory leak in worker process               ││
│  │     Medium · background-jobs · 2 alerts · 1 hour ago    ││
│  │     Status: Resolved         [View]                     ││
│  │                                                          ││
│  └─────────────────────────────────────────────────────────┘│
│                                                              │
│  ┌──────────────────────────┐ ┌────────────────────────────┐│
│  │  Pending Recommendations │ │  Service Health            ││
│  │  ───────────────────────  │ │  ─────────────────────────││
│  │  5 recommendations await  │ │  ● api-gateway    ▓▓▓░ 3  ││
│  │  your review             │ │  ● user-service   ▓▓░░ 2  ││
│  │                          │ │  ● payment-api    ░░░░ 0  ││
│  │  [Review All →]          │ │  ● background-jobs▓░░░ 1  ││
│  └──────────────────────────┘ └────────────────────────────┘│
│                                                              │
└─────────────────────────────────────────────────────────────┘

### API Interactions
*   **Load Active Incidents**: `GET /api/incidents/active`
*   **Load Incident Stats**: `GET /api/incidents/stats`
*   **List Service Health**: `GET /api/services`
*   **Get Recommendations**: `GET /api/recommendations/stats`

