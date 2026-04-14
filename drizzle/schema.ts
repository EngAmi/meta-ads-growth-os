import {
  int,
  tinyint,
  mysqlEnum,
  mysqlTable,
  text,
  timestamp,
  varchar,
  decimal,
  json,
  bigint,
  boolean,
  date,
  index,
  uniqueIndex,
} from "drizzle-orm/mysql-core";

// ─── Users ────────────────────────────────────────────────────────────────────
export const users = mysqlTable("users", {
  id: int("id").autoincrement().primaryKey(),
  openId: varchar("openId", { length: 64 }).notNull().unique(),
  name: text("name"),
  email: varchar("email", { length: 320 }),
  loginMethod: varchar("loginMethod", { length: 64 }),
  role: mysqlEnum("role", ["user", "admin"]).default("user").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  lastSignedIn: timestamp("lastSignedIn").defaultNow().notNull(),
});

export type User = typeof users.$inferSelect;
export type InsertUser = typeof users.$inferInsert;

// ─── Ads Accounts ─────────────────────────────────────────────────────────────
export const adsAccounts = mysqlTable("ads_accounts", {
  id: int("id").autoincrement().primaryKey(),
  accountId: varchar("accountId", { length: 64 }).notNull().unique(),
  name: varchar("name", { length: 255 }).notNull(),
  currency: varchar("currency", { length: 10 }).default("USD").notNull(),
  timezone: varchar("timezone", { length: 64 }).default("UTC").notNull(),
  status: mysqlEnum("status", ["active", "inactive"]).default("active").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

// ─── Campaigns (legacy) ───────────────────────────────────────────────────────
export const campaigns = mysqlTable("campaigns", {
  id: int("id").autoincrement().primaryKey(),
  campaignId: varchar("campaignId", { length: 64 }).notNull().unique(),
  accountId: int("accountId").notNull(),
  name: varchar("name", { length: 255 }).notNull(),
  objective: varchar("objective", { length: 64 }),
  status: mysqlEnum("status", ["active", "paused", "completed", "archived"]).default("active").notNull(),
  dailyBudget: decimal("dailyBudget", { precision: 12, scale: 2 }),
  totalSpend: decimal("totalSpend", { precision: 12, scale: 2 }).default("0"),
  startDate: timestamp("startDate"),
  endDate: timestamp("endDate"),
  country: varchar("country", { length: 64 }),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

// ─── Ad Sets (legacy) ─────────────────────────────────────────────────────────
export const adSets = mysqlTable("ad_sets", {
  id: int("id").autoincrement().primaryKey(),
  adSetId: varchar("adSetId", { length: 64 }).notNull().unique(),
  campaignId: int("campaignId").notNull(),
  name: varchar("name", { length: 255 }).notNull(),
  status: mysqlEnum("status", ["active", "paused", "completed"]).default("active").notNull(),
  targeting: json("targeting"),
  bidStrategy: varchar("bidStrategy", { length: 64 }),
  dailyBudget: decimal("dailyBudget", { precision: 12, scale: 2 }),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

// ─── Ads ──────────────────────────────────────────────────────────────────────
export const ads = mysqlTable("ads", {
  id: int("id").autoincrement().primaryKey(),
  adId: varchar("adId", { length: 64 }).notNull().unique(),
  adSetId: int("adSetId").notNull(),
  name: varchar("name", { length: 255 }).notNull(),
  status: mysqlEnum("status", ["active", "paused", "completed"]).default("active").notNull(),
  creativeType: varchar("creativeType", { length: 64 }),
  previewUrl: text("previewUrl"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

// ─── Ad Insights (daily metrics, legacy) ──────────────────────────────────────
export const adInsights = mysqlTable("ad_insights", {
  id: int("id").autoincrement().primaryKey(),
  campaignId: int("campaignId").notNull(),
  adSetId: int("adSetId"),
  adId: int("adId"),
  date: timestamp("date").notNull(),
  spend: decimal("spend", { precision: 12, scale: 2 }).default("0"),
  impressions: bigint("impressions", { mode: "number" }).default(0),
  clicks: bigint("clicks", { mode: "number" }).default(0),
  ctr: decimal("ctr", { precision: 8, scale: 4 }).default("0"),
  cpc: decimal("cpc", { precision: 8, scale: 2 }).default("0"),
  cpm: decimal("cpm", { precision: 8, scale: 2 }).default("0"),
  leads: int("leads").default(0),
  costPerLead: decimal("costPerLead", { precision: 8, scale: 2 }).default("0"),
  reach: bigint("reach", { mode: "number" }).default(0),
  frequency: decimal("frequency", { precision: 6, scale: 2 }).default("0"),
  conversions: int("conversions").default(0),
  revenue: decimal("revenue", { precision: 12, scale: 2 }).default("0"),
  country: varchar("country", { length: 64 }),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

// ─── Leads ────────────────────────────────────────────────────────────────────
export const leads = mysqlTable("leads", {
  id: int("id").autoincrement().primaryKey(),
  campaignId: int("campaignId"),
  adSetId: int("adSetId"),
  adId: int("adId"),
  source: varchar("source", { length: 64 }).default("meta_ads"),
  country: varchar("country", { length: 64 }),
  phone: varchar("phone", { length: 32 }),
  email: varchar("email", { length: 320 }),
  name: varchar("name", { length: 255 }),
  status: mysqlEnum("status", ["new", "contacted", "qualified", "unqualified", "converted", "lost"]).default("new").notNull(),
  intentLevel: mysqlEnum("intentLevel", ["high", "medium", "low"]).default("medium"),
  leadScore: int("leadScore").default(50),
  isFake: boolean("isFake").default(false),
  assignedAgentId: int("assignedAgentId"),
  firstContactAt: timestamp("firstContactAt"),
  responseTimeSeconds: int("responseTimeSeconds"),
  contactInfo: json("contactInfo"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

// ─── Sales Agents ─────────────────────────────────────────────────────────────
export const salesAgents = mysqlTable("sales_agents", {
  id: int("id").autoincrement().primaryKey(),
  name: varchar("name", { length: 255 }).notNull(),
  email: varchar("email", { length: 320 }),
  phone: varchar("phone", { length: 32 }),
  team: varchar("team", { length: 64 }),
  status: mysqlEnum("status", ["active", "inactive"]).default("active").notNull(),
  avgResponseTime: int("avgResponseTime"),
  totalLeads: int("totalLeads").default(0),
  totalConversions: int("totalConversions").default(0),
  conversionRate: decimal("conversionRate", { precision: 6, scale: 2 }).default("0"),
  totalRevenue: decimal("totalRevenue", { precision: 14, scale: 2 }).default("0"),
  followUpRate: decimal("followUpRate", { precision: 6, scale: 2 }).default("0"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

// ─── Sales Activities ─────────────────────────────────────────────────────────
export const salesActivities = mysqlTable("sales_activities", {
  id: int("id").autoincrement().primaryKey(),
  agentId: int("agentId").notNull(),
  leadId: int("leadId").notNull(),
  type: mysqlEnum("type", ["call", "message", "email", "follow_up", "meeting", "close"]).notNull(),
  outcome: varchar("outcome", { length: 64 }),
  notes: text("notes"),
  duration: int("duration"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

// ─── Funnel Bottlenecks ──────────────────────────────────────────────────────
export const funnelBottlenecks = mysqlTable("funnel_bottlenecks", {
  id: int("id").autoincrement().primaryKey(),
  stage: mysqlEnum("stage", ["ads", "leads", "sales", "revenue", "funnel"]).notNull(),
  severity: mysqlEnum("severity", ["critical", "warning", "info"]).default("info").notNull(),
  title: varchar("title", { length: 255 }).notNull(),
  description: text("description"),
  metric: varchar("metric", { length: 64 }),
  currentValue: decimal("currentValue", { precision: 12, scale: 2 }),
  benchmarkValue: decimal("benchmarkValue", { precision: 12, scale: 2 }),
  revenueImpact: decimal("revenueImpact", { precision: 14, scale: 2 }),
  country: varchar("country", { length: 64 }),
  isResolved: boolean("isResolved").default(false),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

// ─── Recommendations (legacy) ─────────────────────────────────────────────────
export const recommendations = mysqlTable("recommendations", {
  id: int("id").autoincrement().primaryKey(),
  category: mysqlEnum("category", ["ads", "leads", "sales", "funnel"]).notNull(),
  priority: mysqlEnum("priority", ["critical", "high", "medium", "low"]).default("medium").notNull(),
  title: varchar("title", { length: 255 }).notNull(),
  problem: text("problem"),
  reason: text("reason"),
  action: text("action"),
  estimatedImpact: decimal("estimatedImpact", { precision: 14, scale: 2 }),
  status: mysqlEnum("recStatus", ["pending", "in_progress", "completed", "dismissed"]).default("pending").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

// ─── Daily Summaries (legacy) ─────────────────────────────────────────────────
export const dailySummaries = mysqlTable("daily_summaries", {
  id: int("id").autoincrement().primaryKey(),
  date: timestamp("date").notNull(),
  totalSpend: decimal("totalSpend", { precision: 12, scale: 2 }).default("0"),
  totalRevenue: decimal("totalRevenue", { precision: 14, scale: 2 }).default("0"),
  totalLeads: int("totalLeads").default(0),
  totalConversions: int("totalConversions").default(0),
  avgCostPerLead: decimal("avgCostPerLead", { precision: 8, scale: 2 }).default("0"),
  avgConversionRate: decimal("avgConversionRate", { precision: 6, scale: 2 }).default("0"),
  revenueLost: decimal("revenueLost", { precision: 14, scale: 2 }).default("0"),
  keyAlerts: json("keyAlerts"),
  aiSummary: text("aiSummary"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

// ─── Data Connections (Meta API) ─────────────────────────────────────────────
export const dataConnections = mysqlTable("data_connections", {
  id: int("id").autoincrement().primaryKey(),
  platform: mysqlEnum("platform", ["meta_ads"]).default("meta_ads").notNull(),
  name: varchar("name", { length: 255 }).notNull(),
  accessToken: text("accessToken"),
  adAccountId: varchar("adAccountId", { length: 64 }),
  status: mysqlEnum("connStatus", ["connected", "disconnected", "error", "syncing"]).default("disconnected").notNull(),
  lastSyncAt: timestamp("lastSyncAt"),
  lastSyncRows: int("lastSyncRows").default(0),
  lastError: text("lastError"),
  syncDays: int("syncDays").default(30),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type DataConnection = typeof dataConnections.$inferSelect;
export type InsertDataConnection = typeof dataConnections.$inferInsert;

// ─── Import Jobs (CSV/Excel uploads) ─────────────────────────────────────────
export const importJobs = mysqlTable("import_jobs", {
  id: int("id").autoincrement().primaryKey(),
  fileName: varchar("fileName", { length: 255 }).notNull(),
  fileSize: int("fileSize"),
  source: mysqlEnum("importSource", ["meta_csv", "meta_excel", "manual"]).default("meta_csv").notNull(),
  status: mysqlEnum("importStatus", ["pending", "processing", "completed", "failed"]).default("pending").notNull(),
  totalRows: int("totalRows").default(0),
  importedRows: int("importedRows").default(0),
  skippedRows: int("skippedRows").default(0),
  errorMessage: text("errorMessage"),
  columnMapping: json("columnMapping"),
  previewData: json("previewData"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type ImportJob = typeof importJobs.$inferSelect;
export type InsertImportJob = typeof importJobs.$inferInsert;

// ─── Weekly Reports ───────────────────────────────────────────────────────────
export const weeklyReports = mysqlTable("weekly_reports", {
  id: int("id").autoincrement().primaryKey(),
  weekStart: timestamp("weekStart").notNull(),
  weekEnd: timestamp("weekEnd").notNull(),
  totalSpend: decimal("totalSpend", { precision: 12, scale: 2 }).default("0"),
  totalRevenue: decimal("totalRevenue", { precision: 14, scale: 2 }).default("0"),
  totalLeads: int("totalLeads").default(0),
  totalConversions: int("totalConversions").default(0),
  revenueGrowth: decimal("revenueGrowth", { precision: 8, scale: 2 }).default("0"),
  leadGrowth: decimal("leadGrowth", { precision: 8, scale: 2 }).default("0"),
  topRecommendations: json("topRecommendations"),
  summary: text("summary"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

// =============================================================================
// BUILD SLICE v1.1 — ENGINE TABLES
// =============================================================================

// ─── Workspaces ───────────────────────────────────────────────────────────────
export const workspaces = mysqlTable(
  "workspaces",
  {
    id: int("id").autoincrement().primaryKey(),
    name: varchar("name", { length: 255 }).notNull(),
    ownerId: int("ownerId").notNull(),
    timezone: varchar("timezone", { length: 64 }).notNull().default("UTC"),
    currency: varchar("currency", { length: 3 }).notNull().default("USD"),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
  },
  (t) => [index("idx_ws_owner").on(t.ownerId)],
);

export type Workspace = typeof workspaces.$inferSelect;
export type InsertWorkspace = typeof workspaces.$inferInsert;

// ─── Integrations ─────────────────────────────────────────────────────────────
export const integrations = mysqlTable(
  "integrations",
  {
    id: int("id").autoincrement().primaryKey(),
    workspaceId: int("workspaceId").notNull(),
    provider: varchar("provider", { length: 32 }).notNull().default("meta_ads"),
    accessToken: text("accessToken").notNull(),
    metaAccountId: varchar("metaAccountId", { length: 64 }).notNull(),
    accountName: varchar("accountName", { length: 255 }),
    status: mysqlEnum("integrationStatus", ["active", "expired", "error"])
      .notNull()
      .default("active"),
    tokenExpiresAt: timestamp("tokenExpiresAt"),
    lastSyncAt: timestamp("lastSyncAt"),
    lastSyncRows: int("lastSyncRows").notNull().default(0),
    lastSyncError: text("lastSyncError"),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  },
  (t) => [
    uniqueIndex("idx_integration_ws_provider_account").on(t.workspaceId, t.provider, t.metaAccountId),
    index("idx_integration_ws").on(t.workspaceId),
  ],
);

export type Integration = typeof integrations.$inferSelect;
export type InsertIntegration = typeof integrations.$inferInsert;

// ─── Engine Campaigns ─────────────────────────────────────────────────────────
export const engineCampaigns = mysqlTable(
  "engine_campaigns",
  {
    id: int("id").autoincrement().primaryKey(),
    workspaceId: int("workspaceId").notNull(),
    integrationId: int("integrationId").notNull(),
    metaCampaignId: varchar("metaCampaignId", { length: 64 }).notNull(),
    name: varchar("name", { length: 255 }).notNull(),
    objective: varchar("objective", { length: 64 }),
    status: mysqlEnum("engineCampaignStatus", ["ACTIVE", "PAUSED", "DELETED", "ARCHIVED"])
      .notNull()
      .default("ACTIVE"),
    dailyBudget: decimal("dailyBudget", { precision: 12, scale: 4 }),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  },
  (t) => [
    uniqueIndex("idx_ec_meta_id").on(t.metaCampaignId),
    index("idx_ec_ws_status").on(t.workspaceId, t.status),
  ],
);

export type EngineCampaign = typeof engineCampaigns.$inferSelect;
export type InsertEngineCampaign = typeof engineCampaigns.$inferInsert;

// ─── Engine Ad Sets ───────────────────────────────────────────────────────────
export const engineAdSets = mysqlTable(
  "engine_ad_sets",
  {
    id: int("id").autoincrement().primaryKey(),
    workspaceId: int("workspaceId").notNull(),
    campaignId: int("campaignId").notNull(),
    metaAdSetId: varchar("metaAdSetId", { length: 64 }).notNull(),
    name: varchar("name", { length: 255 }).notNull(),
    status: mysqlEnum("engineAdSetStatus", ["ACTIVE", "PAUSED", "DELETED", "ARCHIVED"])
      .notNull()
      .default("ACTIVE"),
    dailyBudget: decimal("dailyBudget", { precision: 12, scale: 4 }),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
  },
  (t) => [
    uniqueIndex("idx_eas_meta_id").on(t.metaAdSetId),
    index("idx_eas_campaign").on(t.campaignId),
    index("idx_eas_ws_status").on(t.workspaceId, t.status),
  ],
);

export type EngineAdSet = typeof engineAdSets.$inferSelect;
export type InsertEngineAdSet = typeof engineAdSets.$inferInsert;

// ─── Daily Metrics ────────────────────────────────────────────────────────────
export const dailyMetrics = mysqlTable(
  "daily_metrics",
  {
    id: int("id").autoincrement().primaryKey(),
    workspaceId: int("workspaceId").notNull(),
    entityType: mysqlEnum("entityType", ["campaign", "ad_set"]).notNull(),
    entityId: int("entityId").notNull(),
    date: date("date").notNull(),
    impressions: int("impressions").notNull().default(0),
    clicks: int("clicks").notNull().default(0),
    spend: decimal("spend", { precision: 12, scale: 4 }).notNull().default("0"),
    reach: int("reach").notNull().default(0),
    frequency: decimal("frequency", { precision: 6, scale: 4 }).notNull().default("0"),
    leads: int("leads").notNull().default(0),
    ctr: decimal("ctr", { precision: 8, scale: 6 }).notNull().default("0"),
    // cpc, cpm, cpl are NULL when denominator is zero; metricsComputation.ts sets them
    cpc: decimal("cpc", { precision: 10, scale: 4 }),
    cpm: decimal("cpm", { precision: 10, scale: 4 }),
    cpl: decimal("cpl", { precision: 10, scale: 4 }),
  },
  (t) => [
    uniqueIndex("idx_dm_entity_date").on(t.entityType, t.entityId, t.date),
    index("idx_dm_ws_date").on(t.workspaceId, t.date),
  ],
);

export type DailyMetric = typeof dailyMetrics.$inferSelect;
export type InsertDailyMetric = typeof dailyMetrics.$inferInsert;

// ─── Baselines ────────────────────────────────────────────────────────────────
export const baselines = mysqlTable(
  "baselines",
  {
    id: int("id").autoincrement().primaryKey(),
    workspaceId: int("workspaceId").notNull(),
    entityType: mysqlEnum("baselineEntityType", ["campaign", "ad_set"]).notNull(),
    entityId: int("entityId").notNull(),
    // metric values: 'ctr' | 'cpl' | 'cpc' | 'cpm' | 'frequency'
    metric: varchar("metric", { length: 32 }).notNull(),
    meanValue: decimal("meanValue", { precision: 12, scale: 6 }).notNull(),
    stdDev: decimal("stdDev", { precision: 12, scale: 6 }).notNull().default("0"),
    sampleDays: int("sampleDays").notNull().default(0),
    computedAt: date("computedAt").notNull(),
  },
  (t) => [
    uniqueIndex("idx_bl_entity_metric_date").on(
      t.entityType,
      t.entityId,
      t.metric,
      t.computedAt,
    ),
    index("idx_bl_ws_date").on(t.workspaceId, t.computedAt),
  ],
);

export type Baseline = typeof baselines.$inferSelect;
export type InsertBaseline = typeof baselines.$inferInsert;

// ─── Pipeline Runs ────────────────────────────────────────────────────────────
export const pipelineRuns = mysqlTable(
  "pipeline_runs",
  {
    id: int("id").autoincrement().primaryKey(),
    workspaceId: int("workspaceId").notNull(),
    runId: varchar("runId", { length: 36 }).notNull(),
    status: mysqlEnum("pipelineStatus", ["running", "completed", "failed", "partial"])
      .notNull()
      .default("running"),
    trigger: mysqlEnum("pipelineTrigger", ["cron", "manual"]).notNull(),
    startedAt: timestamp("startedAt").defaultNow().notNull(),
    endedAt: timestamp("endedAt"),
    durationMs: int("durationMs"),
    stepsCompleted: tinyint("stepsCompleted").notNull().default(0),
    // stepResults shape: { dataIngestion: {...}, metricsComputation: {...}, ... }
    // Initialise to {} in application code before insert (TiDB does not support JSON expression defaults)
    stepResults: json("stepResults").notNull(),
    // stepErrors shape: { moduleName: "error message" }
    stepErrors: json("stepErrors").notNull(),
  },
  (t) => [
    uniqueIndex("idx_pr_run_id").on(t.runId),
    index("idx_pr_ws_started").on(t.workspaceId, t.startedAt),
  ],
);

export type PipelineRun = typeof pipelineRuns.$inferSelect;
export type InsertPipelineRun = typeof pipelineRuns.$inferInsert;

// ─── Engine Diagnostics ───────────────────────────────────────────────────────
export const engineDiagnostics = mysqlTable(
  "engine_diagnostics",
  {
    id: int("id").autoincrement().primaryKey(),
    workspaceId: int("workspaceId").notNull(),
    runId: varchar("runId", { length: 36 }).notNull(),
    // ruleId values: 'C1' | 'C2' | 'F1' | 'F2' | 'A1' | 'S1'
    ruleId: varchar("ruleId", { length: 8 }).notNull(),
    category: mysqlEnum("diagCategory", ["creative", "audience", "funnel", "tracking"])
      .notNull(),
    entityType: mysqlEnum("diagEntityType", ["campaign", "ad_set"]).notNull(),
    entityId: int("entityId").notNull(),
    // severity: 1–100
    severity: tinyint("severity").notNull(),
    // evidence shape: { metric, value, baseline, delta, threshold, period, baselineSource, ... }
    evidence: json("evidence").notNull(),
    status: mysqlEnum("diagStatus", ["active", "acknowledged"]).notNull().default("active"),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
  },
  (t) => [
    index("idx_ed_ws_active_sev").on(t.workspaceId, t.status, t.severity),
    index("idx_ed_run").on(t.runId),
  ],
);

export type EngineDiagnostic = typeof engineDiagnostics.$inferSelect;
export type InsertEngineDiagnostic = typeof engineDiagnostics.$inferInsert;

// ─── Engine Recommendations ───────────────────────────────────────────────────
export const engineRecommendations = mysqlTable(
  "engine_recommendations",
  {
    id: int("id").autoincrement().primaryKey(),
    workspaceId: int("workspaceId").notNull(),
    runId: varchar("runId", { length: 36 }).notNull(),
    diagnosticId: int("diagnosticId").notNull(),
    action: mysqlEnum("recAction", ["PAUSE", "SCALE", "TEST", "MONITOR", "FIX_FUNNEL", "FIX_SALES"])
      .notNull(),
    entityType: mysqlEnum("recEntityType", ["campaign", "ad_set"]).notNull(),
    entityId: int("entityId").notNull(),
    // ruleId mirrors the diagnostic ruleId for deduplication queries
    ruleId: varchar("ruleId", { length: 8 }).notNull(),
    reason: varchar("reason", { length: 512 }).notNull(),
    evidence: json("evidence").notNull(),
    confidenceScore: decimal("confidenceScore", { precision: 4, scale: 3 }).notNull(),
    priorityScore: decimal("priorityScore", { precision: 10, scale: 2 }).notNull(),
    expectedImpact: decimal("expectedImpact", { precision: 12, scale: 4 }),
    status: mysqlEnum("recStatus2", ["pending", "accepted", "dismissed", "expired"])
      .notNull()
      .default("pending"),
    expiresAt: timestamp("expiresAt").notNull(),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  },
  (t) => [
    index("idx_er_ws_status_priority").on(t.workspaceId, t.status, t.priorityScore),
    index("idx_er_diagnostic").on(t.diagnosticId),
    index("idx_er_run").on(t.runId),
  ],
);

export type EngineRecommendation = typeof engineRecommendations.$inferSelect;
export type InsertEngineRecommendation = typeof engineRecommendations.$inferInsert;

// ─── Daily Briefs ─────────────────────────────────────────────────────────────
export const dailyBriefs = mysqlTable(
  "daily_briefs",
  {
    id: int("id").autoincrement().primaryKey(),
    workspaceId: int("workspaceId").notNull(),
    runId: varchar("runId", { length: 36 }).notNull(),
    briefDate: date("briefDate").notNull(),
    // { action: string, entityName: string, reason: string, expectedImpact: number|null, currency: string }
    actionOfTheDay: json("actionOfTheDay").notNull(),
    // { ads: 'green'|'yellow'|'red', leads: 'green'|'yellow'|'red', sales: 'green'|'yellow'|'red' }
    funnelHealth: json("funnelHealth").notNull(),
    // array of up to 3: { ruleId, category, entityName, severity, headline }
    topIssues: json("topIssues").notNull(),
    // { totalSpend, totalLeads, avgCPL, activeCampaigns }
    kpis: json("kpis").notNull(),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
  },
  (t) => [
    uniqueIndex("idx_db_ws_date").on(t.workspaceId, t.briefDate),
    index("idx_db_run").on(t.runId),
  ],
);

export type DailyBrief = typeof dailyBriefs.$inferSelect;
export type InsertDailyBrief = typeof dailyBriefs.$inferInsert;

// ─── Meta OAuth pending sessions ─────────────────────────────────────────────
// Stores the long-lived token + ad accounts list temporarily after the OAuth
// callback so the user can pick which account to connect.
// Rows are deleted after the user confirms or after TTL (10 minutes).
export const metaOAuthSessions = mysqlTable(
  "meta_oauth_sessions",
  {
    id: varchar("id", { length: 64 }).primaryKey(),            // random hex token
    userId: int("userId").notNull(),
    workspaceId: int("workspaceId").notNull(),
    longLivedToken: text("longLivedToken").notNull(),
    adAccountsJson: text("adAccountsJson").notNull(),          // JSON array
    expiresAt: timestamp("expiresAt").notNull(),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
  },
  (t) => [
    index("idx_meta_session_user").on(t.userId),
  ],
);

export type MetaOAuthSession = typeof metaOAuthSessions.$inferSelect;
