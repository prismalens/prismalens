Part 3: Incidents Management
Story 3.1: Incidents List
Screen: /incidents User action: Clicks "Incidents" in navbar

┌─────────────────────────────────────────────────────────────┐
│  Incidents                                                   │
│  ─────────────────────────────────────────────────────────  │
│                                                              │
│  [All] [Active] [Investigating] [Resolved]     🔍 Search... │
│                                                              │
│  Filters: [Severity ▼] [Service ▼] [Date Range ▼] [Clear]  │
│                                                              │
│  ┌───────────────────────────────────────────────────────┐  │
│  │ # │ Title              │ Severity │ Service    │Status│  │
│  ├───────────────────────────────────────────────────────┤  │
│  │42 │ High CPU usage...  │ Critical │ api-gateway│ 🔄  │  │
│  │41 │ DB connection...   │ High     │ user-svc   │ ⚪  │  │
│  │40 │ Memory leak...     │ Medium   │ bg-jobs    │ ✅  │  │
│  │39 │ Slow response...   │ Low      │ api-gw     │ ✅  │  │
│  │38 │ SSL cert expiring  │ Info     │ nginx      │ ✅  │  │
│  └───────────────────────────────────────────────────────┘  │
│                                                              │
│  Showing 1-10 of 42 incidents     [< Prev] [1] [2] [Next >] │
│                                                              │
└─────────────────────────────────────────────────────────────┘

### API Interactions
*   **List Incidents**: `GET /api/incidents`
    *   Params: `status`, `severity`, `priority`, `serviceId`, `limit`, `offset`


Legend:
⚪ = Triggered (new)
🔄 = Investigating (AI working)
🟡 = Identified (root cause found)
✅ = Resolved
Story 3.2: Incident Detail - Before Investigation
Screen: /incidents/42 When: User clicks on an incident that hasn't been investigated

┌─────────────────────────────────────────────────────────────┐
│  ← Back to Incidents                                        │
│                                                              │
│  INC-42: High CPU usage on api-gateway                      │
│  ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━  │
│                                                              │
│  Status: Triggered   Severity: Critical   Priority: P1      │
│  Service: api-gateway   Created: Dec 31, 2025 10:42 AM      │
│                                                              │
│  ┌─────────────────────────────────────────────────────────┐│
│  │  [🤖 Investigate with AI]     [Acknowledge] [Resolve]   ││
│  └─────────────────────────────────────────────────────────┘│
│                                                              │
│  ┌──────────────┬──────────────────────────────────────────┐│
│  │ Overview     │ Alerts (5)    │ Timeline    │ Settings   ││
│  ├──────────────┴──────────────────────────────────────────┤│
│  │                                                          ││
│  │  Description                                             ││
│  │  ─────────────────────────────────────────────────────  ││
│  │  CPU usage on api-gateway pods exceeded 90% threshold   ││
│  │  for more than 5 minutes. Multiple pods affected.       ││
│  │                                                          ││
│  │  Correlated Alerts                                       ││
│  │  ─────────────────────────────────────────────────────  ││
│  │  • HighCPUUsage - pod-1 - 95% CPU (5 min ago)           ││
│  │  • HighCPUUsage - pod-2 - 92% CPU (4 min ago)           ││
│  │  • HighMemory - pod-1 - 88% memory (3 min ago)          ││
│  │  • SlowResponse - /api/users - p99 > 2s (2 min ago)     ││
│  │  • ErrorRate - 5xx errors > 5% (1 min ago)              ││
│  │                                                          ││
│  │  Affected Service                                        ││
│  │  ─────────────────────────────────────────────────────  ││
│  │  api-gateway (Tier 1 - Critical)                        ││
│  │  Repository: org/api-gateway                            ││
│  │  Team: Platform Team                                    ││
│  │                                                          ││
│  └──────────────────────────────────────────────────────────┘│
└─────────────────────────────────────────────────────────────┘

### API Interactions
*   **Get Incident**: `GET /api/incidents/:id`
*   **Get Timeline**: `GET /api/timeline/incident/:id`
*   **Get Alerts**: `GET /api/alerts?incidentId=:id`
*   **Start Investigation**: `POST /api/incidents/:id/investigate`
*   **Resolve Incident**: `POST /api/incidents/:id/resolve`

Story 3.3: Incident Detail - Investigation In Progress
Screen: /incidents/42 (during AI investigation)

┌─────────────────────────────────────────────────────────────┐
│  INC-42: High CPU usage on api-gateway                      │
│  ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━  │
│                                                              │
│  Status: 🔄 Investigating   Severity: Critical              │
│                                                              │
│  ┌─────────────────────────────────────────────────────────┐│
│  │  🤖 AI Investigation in Progress                        ││
│  │  ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ ││
│  │                                                          ││
│  │  [=============================>          ] 72%         ││
│  │                                                          ││
│  │  Current: Analyzing root cause...                       ││
│  │                                                          ││
│  │  ✓ Alert validation completed                           ││
│  │  ✓ Context gathered (logs, code, metrics)               ││
│  │  ◉ Analyzing root cause...                              ││
│  │  ○ Generating recommendations                           ││
│  │                                                          ││
│  │  Started: 2 min ago                     [Cancel]        ││
│  └─────────────────────────────────────────────────────────┘│
│                                                              │
│  ┌──────────────────────────────────────────────────────────┐│
│  │  Live Agent Activity                                     ││
│  │  ─────────────────────────────────────────────────────  ││
│  │  10:44:32  Gatherer: Reading file src/routes/users.ts   ││
│  │  10:44:31  Gatherer: Searching for "memory leak"        ││
│  │  10:44:28  Gatherer: Fetching recent commits            ││
│  │  10:44:25  Alert Agent: Normalized 5 alerts             ││
│  │  10:44:22  Investigation started                        ││
│  └──────────────────────────────────────────────────────────┘│
└─────────────────────────────────────────────────────────────┘

### API Interactions
*   **Get Investigation Status**: `GET /api/investigations/incident/:incidentId`
*   **Get Agent Activity**: `GET /api/investigations/:id/agents`
*   **Get Tool Executions**: `GET /api/investigations/:id/tools`
*   **Get Recommendations**: `GET /api/recommendations?investigationId=:id`

Story 3.4: Incident Detail - Investigation Complete
Screen: /incidents/42 (after AI investigation)

┌─────────────────────────────────────────────────────────────┐
│  INC-42: High CPU usage on api-gateway                      │
│  ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━  │
│                                                              │
│  Status: Identified   Severity: Critical   Confidence: 87%  │
│                                                              │
│  ┌────────────────────────────────────────────────────────┐ │
│  │ Overview │ Investigation │ Recommendations │ Timeline  │ │
│  ├────────────────────────────────────────────────────────┤ │
│  │                                                         │ │
│  │  🎯 Root Cause Analysis                                │ │
│  │  ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ │ │
│  │                                                         │ │
│  │  Category: Code                                        │ │
│  │  Confidence: 87%                                       │ │
│  │                                                         │ │
│  │  The CPU spike is caused by an inefficient database    │ │
│  │  query in the /api/users endpoint. A recent commit     │ │
│  │  (abc123) introduced a N+1 query pattern that loads   │ │
│  │  all user preferences for each user in the list.      │ │
│  │                                                         │ │
│  │  📁 Related Files:                                     │ │
│  │  • src/routes/users.ts:142                            │ │
│  │  • src/services/UserService.ts:89                     │ │
│  │                                                         │ │
│  │  📝 Related Commit:                                    │ │
│  │  abc1234 - "Add user preferences to list" (2 days ago)│ │
│  │                                                         │ │
│  │  ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ │ │
│  │                                                         │ │
│  │  📊 Investigation Flow                                 │ │
│  │  ┌─────────────────────────────────────────────────┐  │ │
│  │  │  [Alert] → [Gatherer] → [Analyzer] → [Recommender]│ │ │
│  │  │    ✓         ✓           ✓            ✓        │  │ │
│  │  └─────────────────────────────────────────────────┘  │ │
│  │                                                         │ │
│  │  Data Sources Used: logs, code, git_history, metrics  │ │
│  │  Analysis Time: 2m 34s                                │ │
│  │                                                         │ │
│  └─────────────────────────────────────────────────────────┘│
│                                                              │
│  ┌─────────────────────────────────────────────────────────┐│
│  │  💡 Recommendations (3)                                 ││
│  │  ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ ││
│  │                                                          ││
│  │  1. [Critical] Fix N+1 Query in UserService             ││
│  │     Add eager loading for user preferences              ││
│  │     Effort: Hours   Status: [ ] Pending                 ││
│  │     [Mark Complete] [Dismiss]                           ││
│  │                                                          ││
│  │  2. [High] Add Database Query Monitoring                ││
│  │     Implement query performance logging                 ││
│  │     Effort: Hours   Status: [ ] Pending                 ││
│  │     [Mark Complete] [Dismiss]                           ││
│  │                                                          ││
│  │  3. [Medium] Consider Pagination                        ││
│  │     Limit users returned per request                    ││
│  │     Effort: Days    Status: [ ] Pending                 ││
│  │     [Mark Complete] [Dismiss]                           ││
│  │                                                          ││
│  └─────────────────────────────────────────────────────────┘│
│                                                              │
│  [Re-investigate] [Mark as Resolved] [Create Postmortem]    │
│                                                              │
└─────────────────────────────────────────────────────────────┘

### API Interactions
*   **Get Investigation Results**: `GET /api/investigations/:id`
*   **List Recommendations**: `GET /api/recommendations?investigationId=:id`
*   **Update Recommendation**: `PATCH /api/recommendations/:id` (Mark as Complete/Dismiss)

