Part 8: Investigation Canvas (DAG Visualization)
Concept: Interactive Multi-Agent Workflow Graph
The Investigation Canvas provides a visual DAG (Directed Acyclic Graph) representation of the AI investigation process. Each node represents a distinct phase or decision point in the investigation.
Story 8.1: Node Types (Color-Coded)
Node Type	Color	Icon	Purpose
🔴 Alert Node	Red	AlertCircle	Initial trigger/validation
🟡 Gathering Node	Yellow/Amber	Search	Data collection in progress
🔵 Analysis Node	Blue	Brain	Reasoning/analysis step
🟢 Success Node	Green	CheckCircle	Root cause found
🟣 Approval Node	Purple	UserCheck	Human gate/decision point
⚫ Failed Node	Gray	XCircle	Dead end/blocked path
Story 8.2: Canvas During Investigation
Screen: /incidents/42 → Investigation tab (while in progress)

┌─────────────────────────────────────────────────────────────┐
│  Investigation Canvas                    [Fullscreen] [Export]│
│  ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ │
│                                                              │
│  ┌─────────────────────────────────────────────────────────┐│
│  │                                                          ││
│  │           ┌─────────────────────┐                       ││
│  │           │ 🔴 Alert Trigger    │                       ││
│  │           │ HighCPU - api-gw    │                       ││
│  │           │ 10:42:00 · ✓ Done   │                       ││
│  │           └─────────┬───────────┘                       ││
│  │                     │                                    ││
│  │                     ▼                                    ││
│  │           ┌─────────────────────┐                       ││
│  │           │ 🟡 Data Gathering   │                       ││
│  │           │ Collecting logs...  │                       ││
│  │           │ 10:42:15 · ⟳ 45%    │                       ││
│  │           └─────────┬───────────┘                       ││
│  │                     │                                    ││
│  │          ┌──────────┼──────────┐                        ││
│  │          ▼          ▼          ▼                        ││
│  │  ┌─────────────┐ ┌─────────────┐ ┌─────────────┐       ││
│  │  │ Log Fetch   │ │ Code Search │ │ Metrics     │       ││
│  │  │ ✓ 234 lines │ │ ✓ 3 files   │ │ ⟳ fetching  │       ││
│  │  └─────────────┘ └─────────────┘ └─────────────┘       ││
│  │                     │                                    ││
│  │                     ▼                                    ││
│  │           ┌─────────────────────┐                       ││
│  │           │ 🔵 Root Cause       │                       ││
│  │           │ Analyzing...        │                       ││
│  │           │ ○ Pending           │                       ││
│  │           └─────────────────────┘                       ││
│  │                                                          ││
│  │  ─────────────────────────────────────────────────────  ││
│  │  [MiniMap]  Zoom: [−] 100% [+]  |  Pan: Drag canvas    ││
│  │                                                          ││
│  └─────────────────────────────────────────────────────────┘│
│                                                              │
│  Click a node for details · Hover for confidence/timestamp  │
│                                                              │
└─────────────────────────────────────────────────────────────┘

### API Interactions
*   **Get Graph Data**: `GET /api/investigations/:id/graph` (*Derived from agents/tools*)
*   **Get Node Details**: `GET /api/investigations/:id/nodes/:nodeId` (*Proposed*)

Story 8.3: Canvas After Investigation Complete
Screen: /incidents/42 → Investigation tab (completed)

┌─────────────────────────────────────────────────────────────┐
│  Investigation Canvas                  [Fullscreen] [Export ▼]│
│                                         PNG · SVG · JSON     │
│  ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ │
│                                                              │
│  ┌─────────────────────────────────────────────────────────┐│
│  │                                                          ││
│  │           ┌─────────────────────┐                       ││
│  │           │ 🔴 Alert Trigger    │                       ││
│  │           │ HighCPU - api-gw    │                       ││
│  │           │ 5 alerts correlated │                       ││
│  │           │ ✓ Validated         │                       ││
│  │           └─────────┬───────────┘                       ││
│  │                     │                                    ││
│  │                     ▼                                    ││
│  │           ┌─────────────────────┐                       ││
│  │           │ 🟡 Gatherer Agent   │                       ││
│  │           │ Context collected   │                       ││
│  │           │ ✓ 2m 15s            │                       ││
│  │           └─────────┬───────────┘                       ││
│  │          ┌──────────┼──────────┐                        ││
│  │          ▼          ▼          ▼                        ││
│  │  ┌─────────────┐ ┌─────────────┐ ┌─────────────┐       ││
│  │  │ Logs        │ │ Code        │ │ Git History │       ││
│  │  │ ✓ 412 lines │ │ ✓ 5 files   │ │ ✓ 3 commits │       ││
│  │  └─────────────┘ └─────────────┘ └─────────────┘       ││
│  │                     │                                    ││
│  │                     ▼                                    ││
│  │           ┌─────────────────────┐                       ││
│  │           │ 🔵 Analyzer Agent   │                       ││
│  │           │ N+1 Query Pattern   │                       ││
│  │           │ Confidence: 87%     │                       ││
│  │           │ ✓ 1m 45s            │                       ││
│  │           └─────────┬───────────┘                       ││
│  │                     │                                    ││
│  │                     ▼                                    ││
│  │           ┌─────────────────────┐                       ││
│  │           │ 🟢 Root Cause Found │                       ││
│  │           │ Inefficient DB query│                       ││
│  │           │ in UserService.ts   │                       ││
│  │           │ ✓ High confidence   │                       ││
│  │           └─────────┬───────────┘                       ││
│  │                     │                                    ││
│  │                     ▼                                    ││
│  │           ┌─────────────────────┐                       ││
│  │           │ 🟢 Recommender      │                       ││
│  │           │ 3 recommendations   │                       ││
│  │           │ ✓ 30s               │                       ││
│  │           └─────────────────────┘                       ││
│  │                                                          ││
│  └─────────────────────────────────────────────────────────┘│
│                                                              │
└─────────────────────────────────────────────────────────────┘

### API Interactions
*   **Export Graph**: Client-side generation from graph data or `GET /api/investigations/:id/export?format=json`

Story 8.4: Node Click → Expanded Details Panel
User action: Clicks on "Gatherer Agent" node

┌─────────────────────────────────────────────────────────────┐
│  Investigation Canvas                                        │
│  ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ │
│                                                              │
│  ┌────────────────────────┐ ┌──────────────────────────────┐│
│  │                        │ │  Node Details            [X] ││
│  │   [Canvas with         │ │  ────────────────────────────││
│  │    selected node       │ │                              ││
│  │    highlighted]        │ │  🟡 Gatherer Agent           ││
│  │                        │ │  Status: ✓ Completed         ││
│  │         ┌──────────┐   │ │  Duration: 2m 15s            ││
│  │         │ Selected │   │ │  Started: 10:42:15           ││
│  │         │  ═══════ │   │ │  Finished: 10:44:30          ││
│  │         └──────────┘   │ │                              ││
│  │                        │ │  Data Collected:             ││
│  │                        │ │  ───────────────────────────-││
│  │                        │ │  • Logs: 412 lines           ││
│  │                        │ │  • Files read: 5             ││
│  │                        │ │  • Commits analyzed: 3       ││
│  │                        │ │  • Metrics fetched: 12       ││
│  │                        │ │                              ││
│  │                        │ │  Key Files:                  ││
│  │                        │ │  • src/routes/users.ts       ││
│  │                        │ │  • src/services/UserSvc.ts   ││
│  │                        │ │                              ││
│  │                        │ │  Log Snippet:                ││
│  │                        │ │  ┌────────────────────────┐ ││
│  │                        │ │  │ [ERR] Query timeout    │ ││
│  │                        │ │  │ SELECT * FROM users... │ ││
│  │                        │ │  │ Duration: 15234ms      │ ││
│  │                        │ │  └────────────────────────┘ ││
│  │                        │ │                              ││
│  │                        │ │  [View Full Logs] [Re-run]   ││
│  │                        │ │                              ││
│  └────────────────────────┘ └──────────────────────────────┘│
│                                                              │
└─────────────────────────────────────────────────────────────┘
Story 8.5: Node Hover → Tooltip
User action: Hovers over any node

┌──────────────────────────────────────────────┐
│  🔵 Analyzer Agent                           │
│  ────────────────────────────────────────── │
│  Status: Completed                           │
│  Confidence: 87%                             │
│  Started: 10:44:30                           │
│  Duration: 1m 45s                            │
│                                              │
│  Click to expand · Right-click for options   │
└──────────────────────────────────────────────┘
Story 8.6: Right-Click Context Menu
User action: Right-clicks on a completed node

┌──────────────────────────┐
│  🔄 Rerun from this step │
│  ─────────────────────── │
│  📋 Copy output          │
│  📥 Export node data     │
│  ─────────────────────── │
│  ℹ️ View full details     │
└──────────────────────────┘
Story 8.7: Investigation with Human Approval Gate
Scenario: Service configured to require human approval before recommendations

┌─────────────────────────────────────────────────────────────┐
│  Investigation Canvas                                        │
│                                                              │
│  ┌─────────────────────────────────────────────────────────┐│
│  │                                                          ││
│  │           ┌─────────────────────┐                       ││
│  │           │ 🔴 Alert Trigger    │                       ││
│  │           │ ✓ Validated         │                       ││
│  │           └─────────┬───────────┘                       ││
│  │                     ▼                                    ││
│  │           ┌─────────────────────┐                       ││
│  │           │ 🟡 Gatherer Agent   │                       ││
│  │           │ ✓ Complete          │                       ││
│  │           └─────────┬───────────┘                       ││
│  │                     ▼                                    ││
│  │           ┌─────────────────────┐                       ││
│  │           │ 🔵 Analyzer Agent   │                       ││
│  │           │ ✓ Root cause found  │                       ││
│  │           └─────────┬───────────┘                       ││
│  │                     ▼                                    ││
│  │  ┏━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┓  ││
│  │  ┃ 🟣 APPROVAL REQUIRED                             ┃  ││
│  │  ┃ ──────────────────────────────────────────────── ┃  ││
│  │  ┃ Review analysis before generating recommendations┃  ││
│  │  ┃                                                   ┃  ││
│  │  ┃ Root Cause: N+1 query in UserService             ┃  ││
│  │  ┃ Confidence: 87%                                   ┃  ││
│  │  ┃                                                   ┃  ││
│  │  ┃         [Approve & Continue]  [Reject]           ┃  ││
│  │  ┗━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┛  ││
│  │                     │                                    ││
│  │                     ▼ (pending approval)                 ││
│  │           ┌─────────────────────┐                       ││
│  │           │ ○ Recommender       │                       ││
│  │           │   (waiting)         │                       ││
│  │           └─────────────────────┘                       ││
│  │                                                          ││
│  └─────────────────────────────────────────────────────────┘│
│                                                              │
└─────────────────────────────────────────────────────────────┘
Story 8.8: Failed Investigation Path
Scenario: Investigation hits a dead end

┌─────────────────────────────────────────────────────────────┐
│  Investigation Canvas                                        │
│                                                              │
│  ┌─────────────────────────────────────────────────────────┐│
│  │                                                          ││
│  │           ┌─────────────────────┐                       ││
│  │           │ 🔴 Alert Trigger    │                       ││
│  │           │ ✓ Validated         │                       ││
│  │           └─────────┬───────────┘                       ││
│  │                     ▼                                    ││
│  │           ┌─────────────────────┐                       ││
│  │           │ 🟡 Gatherer Agent   │                       ││
│  │           │ ✓ Complete          │                       ││
│  │           └─────────┬───────────┘                       ││
│  │          ┌──────────┼──────────┐                        ││
│  │          ▼          ▼          ▼                        ││
│  │  ┌─────────────┐ ┌─────────────┐ ┌─────────────┐       ││
│  │  │ Logs        │ │ ⚫ Code     │ │ Git History │       ││
│  │  │ ✓ 412 lines │ │ ✗ No access │ │ ✓ 3 commits │       ││
│  │  └─────────────┘ └─────────────┘ └─────────────┘       ││
│  │                     │                                    ││
│  │                     ▼                                    ││
│  │           ┌─────────────────────┐                       ││
│  │           │ 🔵 Analyzer Agent   │                       ││
│  │           │ Partial analysis    │                       ││
│  │           │ Confidence: 45%     │                       ││
│  │           └─────────┬───────────┘                       ││
│  │                     │                                    ││
│  │                     ▼                                    ││
│  │           ┌─────────────────────┐                       ││
│  │           │ ⚫ Low Confidence   │                       ││
│  │           │ ──────────────────  │                       ││
│  │           │ Cannot determine    │                       ││
│  │           │ root cause with     │                       ││
│  │           │ available data      │                       ││
│  │           │                     │                       ││
│  │           │ [Retry with more    │                       ││
│  │           │  permissions]       │                       ││
│  │           └─────────────────────┘                       ││
│  │                                                          ││
│  └─────────────────────────────────────────────────────────┘│
│                                                              │
│  ⚠️ Investigation incomplete. Connect GitHub integration    │
│     to enable code analysis.                                │
│                                                              │
└─────────────────────────────────────────────────────────────┘
Story 8.9: Interactive Features Summary
Feature	Action	Result
Click node	Left-click	Expand details panel
Hover node	Mouse over	Show tooltip with confidence/timestamp
Right-click node	Right-click	Context menu (rerun, copy, export)
Export	Click Export	Download PNG/SVG/JSON of graph
Zoom	Scroll or buttons	Zoom in/out on canvas
Pan	Drag canvas	Move view around
MiniMap	Click area	Navigate to that section
Fullscreen	Click button	Expand to full window
Story 8.10: Export Formats
Export Menu:

┌────────────────────────┐
│  Export Investigation  │
│  ──────────────────── │
│  📷 PNG - Image        │
│  🎨 SVG - Vector       │
│  📄 JSON - Data        │
│  📋 Markdown - Report  │
└────────────────────────┘
JSON Export Structure:

{
  "investigationId": "inv_abc123",
  "incidentId": "inc_42",
  "nodes": [
    {
      "id": "alert",
      "type": "alert",
      "status": "completed",
      "timestamp": "2025-12-31T10:42:00Z",
      "data": { ... }
    },
    ...
  ],
  "edges": [...],
  "summary": {
    "rootCause": "N+1 query in UserService",
    "confidence": 0.87,
    "duration": "4m 30s"
  }
}
Summary
This document covers the complete user journey:
Installation → npx prismalens
First Run → Minimal wizard (LLM key + optional integration)
Dashboard → Stats overview, recent incidents
Incidents → List, detail, investigation flow
Services → Catalog with per-service settings
Settings → LLM, integrations, webhooks, correlation rules
Operations → Auto/manual investigation, recommendations
Dynamic Webhooks → Per-service unique webhook URLs (n8n-style)
Investigation Canvas → Interactive DAG visualization with node types
The UI should be clean, minimal, and focused on:
Getting to value quickly (minimal setup)
Clear incident status and progression
Transparent AI investigation process (via canvas)
Actionable recommendations with tracking
Dynamic webhook URLs per service (n8n pattern)
User approved the plan
The comprehensive user stories document is now complete and approved. Here's a summary of what's covered:
PrismaLens UI/UX Design Document
The document at temporal-finding-twilight.md now contains 8 parts:
Parts 1-9 (Original)
Installation & First Run
Main Dashboard (empty + active states)
Incidents Management (list, detail, investigation flow)
Services Configuration
Global Settings
Operational Scenarios
Navigation Structure
Key UI Patterns from Competitors
Environment Variables Reference
Part 10: Dynamic Service Webhooks (NEW)
n8n-style per-service unique webhook URLs
URL format: /api/webhooks/service/{serviceId}/{format}
Service webhook configuration screen with copy buttons
Webhook secret support
Comparison table: global vs service webhooks
Part 8: Investigation Canvas DAG Visualization (NEW)
6 Node Types with color coding:
🔴 Alert Node (Red) - Initial trigger
🟡 Gathering Node (Yellow) - Data collection
🔵 Analysis Node (Blue) - Reasoning step
🟢 Success Node (Green) - Root cause found
🟣 Approval Node (Purple) - Human gate
⚫ Failed Node (Gray) - Dead end
Interactive Features:
Click → Expand details panel
Hover → Tooltip with confidence/timestamp
Right-click → Context menu (rerun, copy, export)
Export formats: PNG, SVG, JSON, Markdown
Scenarios: live investigation, completed, human approval gate, failed path
Would you like me to start implementing any specific part of this design, or would you prefer to review the document first?