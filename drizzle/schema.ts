import { int, mysqlEnum, mysqlTable, text, timestamp, varchar, decimal, json, bigint, boolean } from "drizzle-orm/mysql-core";

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

// ─── Campaigns ────────────────────────────────────────────────────────────────
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

// ─── Ad Sets ──────────────────────────────────────────────────────────────────
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

// ─── Ad Insights (daily metrics) ──────────────────────────────────────────────
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

// ─── Recommendations ─────────────────────────────────────────────────────────
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

// ─── Daily Summaries ──────────────────────────────────────────────────────────
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
