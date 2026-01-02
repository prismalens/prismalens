Part 0: Navigation Structure

┌─────────────────────────────────────────────────────────────┐
│                                                              │
│  NAVBAR (always visible)                                    │
│  ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━  │
│                                                              │
│  [Logo]  Dashboard | Incidents | Services | Settings   [👤] │
│                                                              │
├─────────────────────────────────────────────────────────────┤
│                                                              │
│  ROUTES                                                     │
│                                                              │
│  /                    → Dashboard (stats, recent incidents) │
│  /setup               → First-run wizard (if no LLM key)   │
│  /incidents           → Incidents list with filters        │
│  /incidents/:id       → Incident detail + investigation    │
│  /services            → Services catalog                   │
│  /services/:id        → Service configuration              │
│  /settings            → Global settings (LLM, integrations)│
│  /settings/team       → Team management (optional)         │
│                                                              │
└─────────────────────────────────────────────────────────────┘
