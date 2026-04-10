# Growth OS - Project TODO

- [x] Database schema (ads accounts, campaigns, ad sets, ads, insights, leads, agents, activities, bottlenecks, recommendations)
- [x] Seed demo data script
- [x] Backend tRPC routers for all modules
- [x] Dark theme with elegant design system
- [x] Dashboard layout with sidebar navigation
- [x] Executive Dashboard (top 5 actions, funnel health, revenue snapshots)
- [x] Meta Ads Performance page (campaign/ad set/ad tables, metrics, charts)
- [x] Lead Quality Engine page (scoring, intent classification, fake detection, response time)
- [x] Sales Performance page (agent metrics, conversion rate, response time, follow-ups, revenue)
- [x] Funnel Diagnosis Engine page (Ads → Leads → Sales → Revenue, bottlenecks, country analysis)
- [x] AI Recommendation Engine page (actionable insights, prioritization)
- [x] Daily AI Summary page (revenue impact, key alerts)
- [x] Weekly Performance Reports page (growth trends, top recommendations)
- [x] Revenue Forecasting page (projected metrics, confidence intervals)
- [x] Agent & Campaign Leaderboards page (sortable rankings)
- [x] Color-coded status indicators (green/yellow/red)
- [x] Unit tests (24 tests passing)

## Data Sources Feature
- [x] DB schema: dataConnections table (Meta API token, account ID, status, last sync)
- [x] DB schema: importJobs table (file name, status, rows imported, errors)
- [x] Backend: saveConnection, testConnection, syncFromMeta procedures
- [x] Backend: file upload endpoint + CSV/Excel parser for Meta report format
- [x] Backend: map Meta report columns → adInsights table rows
- [x] Frontend: Data Sources page with three tabs (API Connect / File Upload / WhatsApp)
- [x] Frontend: Meta API connection form (token, account ID, test + save + sync)
- [x] Frontend: File upload zone (CSV/Excel drag-and-drop, column preview, import)
- [x] Frontend: Import history table (file name, date, rows, status)
- [x] Navigation: Data Sources link in sidebar under Settings
- [x] Tests: data source router tests

## Next Steps Features
- [x] Fix TypeScript errors in routers.ts (adInsights insert type cast)
- [x] Finish Data Sources page (Meta API connect + CSV/Excel upload + import history)
- [x] Global date range context (DateRangeProvider) shared across all pages
- [x] Date range picker component in DashboardLayout header (desktop + mobile)
- [x] WhatsApp webhook endpoint (/api/webhook/whatsapp) with signature verification
- [x] Auto lead scoring logic on incoming WhatsApp messages (Arabic + English)
- [x] Fake lead detection patterns
- [x] WhatsApp lead pushed to leads table with intentLevel and leadScore
- [x] WhatsApp configuration tab with setup instructions, webhook URL, verify token
- [x] Recent WhatsApp leads list with intent badges
- [x] Tests: 24 tests passing, TypeScript clean

## Navigation Improvements
- [x] Add "Return Home" and "Go to Dashboard" buttons to the 404 Not Found page
- [x] Add "Return Home" and "Go to Dashboard" buttons to the login screen
- [x] Add Home shortcut in sidebar header logo area (clickable logo)
