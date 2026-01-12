# PrismaLens Overview

## Product Vision

PrismaLens is an **AI-first, open-source incident management and root cause analysis (RCA) platform**. It automates the investigation of production incidents using LLM-powered agents that gather context, analyze patterns, and generate actionable recommendations.

### Key Differentiators

| Feature | PrismaLens | Traditional Tools |
|---------|------------|-------------------|
| **AI-First** | LangGraph agents investigate automatically | Manual runbooks |
| **Open Source** | Self-host, full control, no vendor lock-in | SaaS-only or limited OSS |
| **Topology-Aware** | Understands service dependencies | Flat alert lists |
| **Investigation Canvas** | Visual DAG of AI reasoning | Text-based logs |

## High-Level User Flow

```mermaid
flowchart LR
    subgraph Onboarding
        A[Install] --> B[Setup]
        B --> C[Login]
    end

    subgraph Daily Operations
        C --> D[Dashboard]
        D --> E[Incidents]
        D --> F[Services]
        D --> G[Settings]
    end

    subgraph Incident Response
        E --> H[Triage]
        H --> I[Investigate]
        I --> J[Resolve]
        J --> K[Postmortem]
    end
```

## Core Data Model

```mermaid
flowchart TD
    subgraph Data Flow
        EV[Events] -->|raw data| AL[Alerts]
        AL -->|correlation rules| IN[Incidents]
        IN -->|triggers| IV[Investigations]
        IV -->|produces| RC[Root Cause Analysis]
        RC -->|generates| REC[Recommendations]
    end

    subgraph Entities
        SVC[Services]
        INT[Integrations]
    end

    AL -.->|mapped to| SVC
    IV -.->|uses| INT
    SVC -.->|has| INT
```

### Entity Definitions

| Entity | Description |
|--------|-------------|
| **Event** | Raw data point from monitoring systems |
| **Alert** | Actionable notification derived from events |
| **Incident** | Grouped alerts requiring investigation |
| **Investigation** | AI-driven RCA process using LangGraph |
| **Recommendation** | Suggested action from AI analysis |
| **Postmortem** | Summary attached to resolved incidents |
| **Service** | Application component being monitored |
| **Integration** | Connected external tool (GitHub, Prometheus, Slack) |

## User Personas

PrismaLens serves three primary personas, each with distinct workflows:

### On-Call Engineer

**Goal**: Quickly acknowledge, understand, and resolve production incidents.

```mermaid
flowchart LR
    OC1[Receive Alert] --> OC2[Acknowledge]
    OC2 --> OC3[View Investigation Canvas]
    OC3 --> OC4[Review Root Cause]
    OC4 --> OC5[Apply Recommendation]
    OC5 --> OC6[Resolve Incident]
```

**Primary Screens**:
- Dashboard (active incidents)
- Incident Detail (investigation canvas)
- Recommendations panel

**Key Actions**:
- Acknowledge incident
- View AI investigation progress
- Apply or dismiss recommendations
- Resolve and add notes

---

### SRE / Platform Engineer

**Goal**: Configure services, set investigation policies, and improve system reliability.

```mermaid
flowchart LR
    SRE1[Configure Services] --> SRE2[Set Tier Policies]
    SRE2 --> SRE3[Connect Integrations]
    SRE3 --> SRE4[Review RCA Quality]
    SRE4 --> SRE5[Tune Correlation Rules]
```

**Primary Screens**:
- Services catalog
- Service detail (integrations, policies)
- Settings (AI provider, correlation rules)

**Key Actions**:
- Add/edit services with tier classification
- Configure auto-investigation policies
- Set up integrations (GitHub, Prometheus)
- Define correlation rules for alert grouping

---

### Engineering Manager

**Goal**: Monitor team performance, review trends, and ensure postmortems are completed.

```mermaid
flowchart LR
    EM1[View Dashboard] --> EM2[Review Metrics]
    EM2 --> EM3[Read Postmortems]
    EM3 --> EM4[Track Trends]
    EM4 --> EM5[Identify Improvements]
```

**Primary Screens**:
- Dashboard (metrics widgets)
- Incidents list (historical)
- Postmortem reports

**Key Actions**:
- Monitor MTTR/MTTA metrics
- Review completed investigations
- Read and approve postmortems
- Identify recurring issues

---

## Application Routes

| Route | Purpose | Primary Persona |
|-------|---------|-----------------|
| `/` | Dashboard with widgets | All |
| `/setup` | First-time setup wizard | Owner |
| `/login` | Authentication | All |
| `/incidents` | Incidents list | On-call, Manager |
| `/incidents/:id` | Incident detail + canvas | On-call |
| `/services` | Services catalog | SRE |
| `/services/:id` | Service configuration | SRE |
| `/settings` | Global settings | SRE, Owner |
| `/settings/integrations` | Integration management | SRE |
| `/settings/team` | Team management | Owner, Manager |

## Community vs Cloud Edition

| Feature | Community Edition | Cloud Edition |
|---------|-------------------|---------------|
| Self-hosted | Yes | Managed |
| Organizations | Single (implicit) | Multi-org |
| Team members | Unlimited (local) | Unlimited + SSO |
| AI providers | Bring your own key | Included |
| Support | Community | Priority |

The Community Edition provides full functionality for self-hosted deployments with a single implicit organization. Users seeking multi-org support, SSO, and managed infrastructure can upgrade to the Cloud Edition.

## Technology Stack

| Layer | Technology |
|-------|------------|
| Frontend | TanStack Start (SSR), React, shadcn/ui |
| Backend | NestJS, oRPC |
| Database | PostgreSQL (prod), SQLite (dev) |
| AI Agents | LangChain, LangGraph |
| Auth | better-auth |
| Queue | BullMQ (optional) |

## Next Steps

- [Installation](./01_Installation.md) - Deploy PrismaLens
- [Onboarding](./02_Onboarding.md) - First-time setup
- [Glossary](./13_Glossary.md) - Terminology reference
