# Meta Ads Growth OS

> A full-stack Growth Operating System for Meta Ads teams — built on React 19, tRPC 11, Drizzle ORM, and Express 4.

[![License: MIT](https://img.shields.io/badge/License-MIT-violet.svg)](https://opensource.org/licenses/MIT)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.x-blue.svg)](https://www.typescriptlang.org/)
[![React](https://img.shields.io/badge/React-19-61DAFB.svg)](https://react.dev/)
[![tRPC](https://img.shields.io/badge/tRPC-11-398CCB.svg)](https://trpc.io/)
[![Tests](https://img.shields.io/badge/tests-139%20passing-brightgreen.svg)](#running-tests)

---

## Overview

**Meta Ads Growth OS** is an open-source operational intelligence platform designed for performance marketing teams running Meta (Facebook) ad campaigns. It connects directly to the Meta Graph API via OAuth, ingests campaign data nightly through an automated pipeline, runs a rule-based diagnostic engine, and surfaces actionable insights through a real-time executive dashboard.

The system is built around a single principle: **no more manual exports**. Connect once, and the nightly scheduler handles everything — data ingestion, KPI computation, anomaly detection, and daily briefing generation.

---

## Screenshots

### Executive Dashboard
![Executive Dashboard — KPI cards, funnel flow, revenue vs. spend chart, and country breakdown](docs/images/dashboard.png)

### Data Sources — Meta Ads API Connection
![Data Sources — Facebook OAuth, manual token form, engine integrations, and saved connections](docs/images/datasources.png)

---

## Key Features

| Feature | Description |
|---|---|
| **Facebook OAuth** | One-click connection via Meta Graph API with long-lived token exchange and multi-account picker |
| **Nightly Pipeline** | Automated cron job ingests campaigns, ad sets, and daily metrics every night |
| **Diagnostic Engine** | Rule-based engine detects CPL spikes, CTR drops, budget exhaustion, and ROAS anomalies |
| **Executive Dashboard** | Real-time KPI cards, funnel flow, revenue vs. spend charts, and country breakdown |
| **Scheduled Runs Tab** | Full history of pipeline runs with status filtering, step-by-step progress, and manual Run Now trigger |
| **CSV Import** | Upload Meta Ads Manager exports (CSV/Excel) with auto column mapping |
| **Daily Briefings** | LLM-generated daily summaries with top insights and recommended actions |
| **Recommendations Engine** | Prioritised action items ranked by estimated impact |
| **Funnel Diagnosis** | Bottleneck detection across Ads → Leads → Qualified → Revenue stages |
| **Weekly Reports** | Auto-generated weekly performance summaries |

---

## Tech Stack

| Layer | Technology |
|---|---|
| **Frontend** | React 19, Tailwind CSS 4, shadcn/ui, Wouter, Recharts |
| **API Layer** | tRPC 11 (end-to-end type safety, no REST boilerplate) |
| **Backend** | Express 4, Node.js 22, tsx |
| **Database** | MySQL / TiDB via Drizzle ORM (schema-first, type-safe queries) |
| **Auth** | Manus OAuth + cookie-based sessions |
| **Scheduler** | Node-cron (nightly pipeline at midnight) |
| **LLM** | Built-in Manus Forge API (daily briefings, structured JSON output) |
| **File Storage** | S3-compatible object storage |
| **Testing** | Vitest (139 tests across 5 suites) |

---

## Architecture

```
client/                  ← React 19 SPA
  src/pages/             ← Dashboard, DataSources, AdsPerformance, ...
  src/components/        ← DashboardLayout, AIChatBox, shadcn/ui
server/
  _core/                 ← Express bootstrap, tRPC context, OAuth, LLM helpers
  routers/               ← tRPC procedures (dataSources, dashboard, ads, leads, ...)
  engines/
    pipeline.ts          ← Orchestrates the full nightly data pipeline
    diagnosticEngine.ts  ← Rule-based KPI anomaly detection (C1, C2, F1, F2, A1, S1)
    dailyBriefEngine.ts  ← LLM-powered daily summary generation
  nightlyScheduler.ts    ← Cron job registration with duplicate-run guard
  metaOAuth.ts           ← Facebook OAuth start + callback routes
drizzle/
  schema.ts              ← All database tables and types
```

---

## Diagnostic Rules

The engine evaluates six rule categories per campaign and ad set window (last 7 days):

| Rule | Signal | Condition |
|---|---|---|
| **C1** | CPL Spike | CPL > baseline × 1.3 |
| **C2** | CPL Improvement | CPL < baseline × 0.85 |
| **F1** | CTR Drop | CTR < baseline × 0.75 |
| **F2** | CTR Improvement | CTR > baseline × 1.25 |
| **A1** | Budget Exhaustion | Spend ≥ 95% of daily budget |
| **S1** | ROAS Anomaly | ROAS deviation > 2 standard deviations |

All rules require a minimum impression threshold (default: 1,000) to avoid noise from low-traffic entities.

---

## Getting Started

### Prerequisites

- Node.js 22+
- pnpm 9+
- MySQL 8 or TiDB (connection string in `DATABASE_URL`)
- Meta Developer App with `ads_read`, `ads_management`, `business_management`, `read_insights` permissions

### Installation

```bash
# Clone the repository
git clone https://github.com/EngAmi/meta-ads-growth-os.git
cd meta-ads-growth-os

# Install dependencies
pnpm install

# Push database schema
pnpm db:push

# Start development server
pnpm dev
```

### Environment Variables

Create a `.env` file at the project root (never commit this file):

```env
DATABASE_URL=mysql://user:password@host:3306/dbname
JWT_SECRET=your-secret-key

# Meta / Facebook OAuth
META_APP_ID=your-meta-app-id
META_APP_SECRET=your-meta-app-secret

# Manus platform (if self-hosting outside Manus)
VITE_APP_ID=your-oauth-app-id
OAUTH_SERVER_URL=https://api.manus.im
VITE_OAUTH_PORTAL_URL=https://manus.im
OWNER_OPEN_ID=your-user-id
OWNER_NAME=Your Name

# Optional: override default cron schedule (default: midnight daily)
CRON_SCHEDULE=0 0 * * *
```

### Facebook App Setup

1. Create a Meta Developer App at [developers.facebook.com](https://developers.facebook.com)
2. Add **Facebook Login** product and enable **Web** platform
3. Add your domain to **Valid OAuth Redirect URIs**: `https://your-domain.com/api/meta/oauth/callback`
4. Request permissions: `ads_read`, `ads_management`, `business_management`, `read_insights`
5. Set `META_APP_ID` and `META_APP_SECRET` in your environment

---

## Running Tests

```bash
pnpm test
```

The test suite covers 139 tests across 5 suites: auth, diagnostic engine (97 unit tests), nightly scheduler, data pipeline, and tRPC procedures.

---

## Project Structure — Key Files

```
server/engines/diagnosticEngine.ts   ← Pure functions, fully unit-tested
server/engines/pipeline.ts           ← Step orchestration with stepResults tracking
server/nightlyScheduler.ts           ← Cron with duplicate-run guard (20-hour window)
server/metaOAuth.ts                  ← OAuth start/callback with multi-account picker
drizzle/schema.ts                    ← Single source of truth for all DB types
client/src/pages/DataSources.tsx     ← OAuth flow, account picker, CSV upload
client/src/pages/Dashboard.tsx       ← Executive KPI dashboard
```

---

## Roadmap

- [ ] Multi-workspace support (agency mode)
- [ ] Slack / WhatsApp notifications for anomaly alerts
- [ ] Google Ads connector
- [ ] TikTok Ads connector
- [ ] Automated A/B test analysis
- [ ] Budget pacing alerts
- [ ] Custom rule builder UI

---

## Contributing

Contributions are welcome! Please read [CONTRIBUTING.md](CONTRIBUTING.md) for guidelines on how to add new diagnostic rules, procedures, or UI features.

---

## License

MIT License — see [LICENSE](LICENSE) for details.

---

## Author

Built by **[@EngAmi](https://github.com/EngAmi)** — Performance marketing engineer focused on Meta Ads automation and growth intelligence systems.
