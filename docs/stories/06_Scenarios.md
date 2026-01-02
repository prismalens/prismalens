Part 6: Operational Scenarios
Story 6.1: Alert Arrives → Auto-Investigation
Scenario: Critical alert arrives for a Tier 1 service with auto-investigation enabled Timeline:
10:42:00 - Prometheus sends webhook
Event created (immutable)
Alert created/deduplicated
Correlated to existing or new incident
10:42:01 - Auto-investigation triggered
Incident status → "Investigating"
Investigation record created
Job queued to BullMQ
10:42:02 - Slack notification sent

🔴 New Critical Incident: INC-42
High CPU usage on api-gateway
AI investigation started automatically...
10:44:36 - Investigation completes
Root cause identified
3 recommendations generated
Incident status → "Identified"
10:44:37 - Slack notification sent

✅ Investigation Complete: INC-42
Root Cause: N+1 query in UserService (87% confidence)
3 recommendations generated
→ View details
User sees on Dashboard:
Incident card shows "Identified" status
Recommendation count badge
Click to view full analysis

### API Flow
1.  Webhook received: `POST /api/webhooks/prometheus`
2.  System correlates: (Internal logic)
3.  Auto-investigate: (Job Queue)
4.  User views: `GET /api/incidents/:id` -> `GET /api/investigations/incident/:id`

Story 6.2: Manual Investigation Flow
Scenario: User manually investigates a medium-severity incident
User on Dashboard - Sees incident INC-45 with status "Triggered"
Clicks "View" - Opens incident detail page
Reviews alerts - Sees 3 correlated alerts
Clicks "Investigate with AI" - Modal confirms action
Watches progress - Live progress bar and agent activity
Investigation completes - Reviews root cause and recommendations
Marks recommendation complete - Updates status
Resolves incident - Incident closed

### API Flow
1.  View Incident: `GET /api/incidents/:id`
2.  Start Investigation: `POST /api/incidents/:id/investigate`
3.  Poll Status: `GET /api/investigations/:id/status`
4.  Get Results: `GET /api/investigations/:id`
5.  Resolve: `POST /api/incidents/:id/resolve`

Story 6.3: Reconfiguring a Service
Scenario: User wants to change investigation settings for a service
Navigate: Dashboard → Services → api-gateway → Configure
Select tab: Investigation
Change setting: "Only for Critical severity"
Add context: "This service handles payment webhooks"
Save changes
System behavior:
Future Critical incidents auto-investigate
High/Medium/Low require manual trigger
AI uses custom context during analysis
Story 6.4: Adding a New Integration
Scenario: User connects Prometheus for the first time
Navigate: Settings → Integrations → + Connect
Select: Prometheus
Enter details:
Name: "Production Prometheus"
URL: http://prometheus:9090
Auth: None (or basic auth)
Click "Test & Connect"
System tests connection
Shows success/failure
Integration appears in global list
Assign to services (optional)
