Part 7: Global Webhooks (Community Edition)

### Concept: Single Webhook Endpoint
In the Community Edition, PrismaLens supports **Global Webhooks**. This means there is a single set of endpoints for the entire instance. Alerts sent to these endpoints are routed to the appropriate service based on labels or tags within the alert payload.

### Story 7.1: Global Webhook Endpoints
- **Constraint**: One URL structure for the entire instance.
- **Service Mapping**: Auto-detected from alert labels (e.g., `service`, `app`, `job`) or tags.

**Endpoints:**
*   **Generic**: `POST /api/webhooks/generic`
*   **Prometheus**: `POST /api/webhooks/prometheus`
*   **GitHub**: `POST /api/webhooks/github`

### Story 7.2: Webhook Configuration Screen
- **Screen**: `/settings` (Webhooks tab) - *Moved from Service Settings*
- **UI**: Shows the global webhook URLs to copy.

┌─────────────────────────────────────────────────────────────┐
│  Settings > Webhooks                                        │
│  ─────────────────────────────────────────────────────────  │
│                                                             │
│  Configure your monitoring tools to send alerts to these    │
│  endpoints. PrismaLens will automatically map them to       │
│  services based on the `service` label.                     │
│                                                             │
│  Generic Webhook                                            │
│  ┌─────────────────────────────────────────────────────┐    │
│  │ POST http://localhost:5367/api/webhooks/generic     │    │
│  │                                              [Copy] │    │
│  └─────────────────────────────────────────────────────┘    │
│                                                             │
│  Prometheus AlertManager                                    │
│  ┌─────────────────────────────────────────────────────┐    │
│  │ POST http://localhost:5367/api/webhooks/prometheus  │    │
│  │                                              [Copy] │    │
│  └─────────────────────────────────────────────────────┘    │
│                                                             │
│  GitHub Webhooks                                            │
│  ┌─────────────────────────────────────────────────────┐    │
│  │ POST http://localhost:5367/api/webhooks/github      │    │
│  │                                              [Copy] │    │
│  └─────────────────────────────────────────────────────┘    │
│                                                             │
└─────────────────────────────────────────────────────────────┘

### Story 7.3: Service Mapping Logic
- **Incoming Alert**:
    - `labels: { service: "api-gateway", severity: "critical" }`
- **Logic**:
    1.  Look up Service by name "api-gateway".
    2.  If found, associate alert with that Service.
    3.  If not found, alert is "Unmapped" (creates a global incident or prompts user to map).

### API Interactions
*   **Generic Webhook**: `POST /api/webhooks/generic` (Implemented)
*   **GitHub Webhook**: `POST /api/webhooks/github` (Implemented)
*   **Prometheus Webhook**: `POST /api/webhooks/prometheus` (Missing in Controller - *Needs Implementation*)
