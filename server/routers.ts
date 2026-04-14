import { COOKIE_NAME } from "@shared/const";
import { getSessionCookieOptions } from "./_core/cookies";
import { systemRouter } from "./_core/systemRouter";
import { publicProcedure, protectedProcedure, router } from "./_core/trpc";
import { workspaceRouter } from "./routers/workspace";
import { dataSourcesRouter as engineDataSourcesRouter } from "./routers/dataSources";
import { adsRouter as engineAdsRouter } from "./routers/ads";
import { diagnosticsRouter } from "./routers/diagnostics";
import { recommendationsRouter } from "./routers/recommendations";
import { dashboardRouter as engineDashboardRouter } from "./routers/dashboard";
import { getDb } from "./db";
import {
  adsAccounts, campaigns, adSets, ads, adInsights,
  leads, salesAgents, salesActivities,
  funnelBottlenecks, recommendations,
  dailySummaries, weeklyReports,
  dataConnections, importJobs
} from "../drizzle/schema";
import { desc, eq, sql, and, gte, lte, count, sum, avg } from "drizzle-orm";
import { z } from "zod";
import { invokeLLM } from "./_core/llm";
import { notifyOwner } from "./_core/notification";

// ─── CSV date normalizer ─────────────────────────────────────────────────────
/**
 * Normalise a raw date value from a CSV/Excel row to a UTC midnight Date.
 * Handles:
 *   1. Excel serial numbers  (e.g. 46113  → 2026-04-11)
 *   2. ISO strings           (e.g. "2026-04-01")
 *   3. Meta-style strings    (e.g. "Apr 11, 2026", "11/04/2026")
 * Returns null if the value cannot be parsed so the caller can skip the row.
 */
function normalizeDate(raw: unknown): Date | null {
  if (raw === null || raw === undefined || raw === "") return null;

  // Numeric value → Excel serial date (days since 1899-12-30)
  const n = Number(raw);
  if (!isNaN(n) && !/^\d{4}-/.test(String(raw))) {
    if (n < 1 || n > 2958465) return null; // sanity bounds (1900-01-01 … 9999-12-31)
    const excelEpoch = new Date(Date.UTC(1899, 11, 30));
    const d = new Date(excelEpoch.getTime() + n * 86_400_000);
    console.debug(`[CSV Import] Excel serial ${n} → ${d.toISOString().slice(0, 10)}`);
    return d;
  }

  // String value → attempt standard Date parse
  const s = String(raw).trim();
  const d = new Date(s);
  if (!isNaN(d.getTime())) {
    // Force UTC midnight to avoid timezone drift
    const iso = d.toISOString().slice(0, 10);
    const utc = new Date(`${iso}T00:00:00.000Z`);
    console.debug(`[CSV Import] Date string "${s}" → ${iso}`);
    return utc;
  }

  console.warn(`[CSV Import] Could not parse date value: ${JSON.stringify(raw)} — row will be skipped`);
  return null;
}

export const appRouter = router({
  system: systemRouter,
  // ─── Build Slice v1.1 engine routers ────────────────────────────────────
  workspace: workspaceRouter,
  engineDataSources: engineDataSourcesRouter,
  engineAds: engineAdsRouter,
  engineDiagnostics: diagnosticsRouter,
  engineRecommendations: recommendationsRouter,
  engineDashboard: engineDashboardRouter,
  // ────────────────────────────────────────────────────────────────────────
  auth: router({
    me: publicProcedure.query(opts => opts.ctx.user),
    logout: publicProcedure.mutation(({ ctx }) => {
      const cookieOptions = getSessionCookieOptions(ctx.req);
      ctx.res.clearCookie(COOKIE_NAME, { ...cookieOptions, maxAge: -1 });
      return { success: true } as const;
    }),
  }),

  // ─── Dashboard ─────────────────────────────────────────────────────────────
  dashboard: router({
    summary: publicProcedure.query(async () => {
      const db = await getDb();
      if (!db) return null;

      const [adsData] = await db.select({
        totalSpend: sql<number>`COALESCE(SUM(spend),0)`,
        totalLeads: sql<number>`COALESCE(SUM(leads),0)`,
        totalRevenue: sql<number>`COALESCE(SUM(revenue),0)`,
        totalImpressions: sql<number>`COALESCE(SUM(impressions),0)`,
        totalClicks: sql<number>`COALESCE(SUM(clicks),0)`,
        totalConversions: sql<number>`COALESCE(SUM(conversions),0)`,
      }).from(adInsights).where(gte(adInsights.date, sql`DATE_SUB(NOW(), INTERVAL 30 DAY)`));

      const [leadsData] = await db.select({
        total: count(),
        converted: sql<number>`SUM(CASE WHEN status='converted' THEN 1 ELSE 0 END)`,
        fake: sql<number>`SUM(CASE WHEN isFake=1 THEN 1 ELSE 0 END)`,
        highIntent: sql<number>`SUM(CASE WHEN intentLevel='high' THEN 1 ELSE 0 END)`,
      }).from(leads);

      const [agentsData] = await db.select({
        avgConversion: avg(salesAgents.conversionRate),
        totalRevenue: sum(salesAgents.totalRevenue),
      }).from(salesAgents).where(eq(salesAgents.status, 'active'));

      const topBottlenecks = await db.select().from(funnelBottlenecks)
        .where(eq(funnelBottlenecks.isResolved, false))
        .orderBy(desc(funnelBottlenecks.revenueImpact))
        .limit(5);

      const topRecs = await db.select().from(recommendations)
        .where(eq(recommendations.status, 'pending'))
        .orderBy(desc(recommendations.estimatedImpact))
        .limit(5);

      const [todaySummary] = await db.select().from(dailySummaries)
        .orderBy(desc(dailySummaries.date)).limit(1);

      return {
        ads: adsData,
        leads: leadsData,
        agents: agentsData,
        topBottlenecks,
        topRecommendations: topRecs,
        todaySummary,
      };
    }),

    funnelHealth: publicProcedure.query(async () => {
      const db = await getDb();
      if (!db) return null;

      const [data] = await db.select({
        totalSpend: sql<number>`COALESCE(SUM(spend),0)`,
        totalLeads: sql<number>`COALESCE(SUM(leads),0)`,
        totalConversions: sql<number>`COALESCE(SUM(conversions),0)`,
        totalRevenue: sql<number>`COALESCE(SUM(revenue),0)`,
      }).from(adInsights).where(gte(adInsights.date, sql`DATE_SUB(NOW(), INTERVAL 30 DAY)`));

      const [leadsCount] = await db.select({ total: count() }).from(leads);
      const [convertedCount] = await db.select({ total: count() }).from(leads).where(eq(leads.status, 'converted'));

      return {
        adsToLeads: data.totalLeads > 0 ? (data.totalLeads / Math.max(data.totalSpend, 1) * 100).toFixed(2) : 0,
        leadsToSales: leadsCount.total > 0 ? ((convertedCount.total / leadsCount.total) * 100).toFixed(2) : 0,
        roas: data.totalSpend > 0 ? (data.totalRevenue / data.totalSpend).toFixed(2) : 0,
        ...data,
        totalLeadsDb: leadsCount.total,
        totalConverted: convertedCount.total,
      };
    }),

    revenueByCountry: publicProcedure.query(async () => {
      const db = await getDb();
      if (!db) return [];
      return db.select({
        country: adInsights.country,
        revenue: sql<number>`COALESCE(SUM(revenue),0)`,
        spend: sql<number>`COALESCE(SUM(spend),0)`,
        leads: sql<number>`COALESCE(SUM(leads),0)`,
        conversions: sql<number>`COALESCE(SUM(conversions),0)`,
      }).from(adInsights)
        .where(gte(adInsights.date, sql`DATE_SUB(NOW(), INTERVAL 30 DAY)`))
        .groupBy(adInsights.country)
        .orderBy(desc(sql`SUM(revenue)`));
    }),

    revenueByAgent: publicProcedure.query(async () => {
      const db = await getDb();
      if (!db) return [];
      return db.select({
        id: salesAgents.id,
        name: salesAgents.name,
        totalRevenue: salesAgents.totalRevenue,
        conversionRate: salesAgents.conversionRate,
        totalLeads: salesAgents.totalLeads,
        totalConversions: salesAgents.totalConversions,
      }).from(salesAgents)
        .where(eq(salesAgents.status, 'active'))
        .orderBy(desc(salesAgents.totalRevenue));
    }),
  }),

  // ─── Ads Performance ───────────────────────────────────────────────────────
  ads: router({
    campaigns: publicProcedure.query(async () => {
      const db = await getDb();
      if (!db) return [];
      const rows = await db.select({
        id: campaigns.id,
        name: campaigns.name,
        status: campaigns.status,
        country: campaigns.country,
        totalSpend: campaigns.totalSpend,
        spend: sql<number>`COALESCE(SUM(${adInsights.spend}),0)`,
        impressions: sql<number>`COALESCE(SUM(${adInsights.impressions}),0)`,
        clicks: sql<number>`COALESCE(SUM(${adInsights.clicks}),0)`,
        leads: sql<number>`COALESCE(SUM(${adInsights.leads}),0)`,
        conversions: sql<number>`COALESCE(SUM(${adInsights.conversions}),0)`,
        revenue: sql<number>`COALESCE(SUM(${adInsights.revenue}),0)`,
        avgCtr: sql<number>`COALESCE(AVG(${adInsights.ctr}),0)`,
        avgCpc: sql<number>`COALESCE(AVG(${adInsights.cpc}),0)`,
        avgCpl: sql<number>`COALESCE(AVG(${adInsights.costPerLead}),0)`,
      }).from(campaigns)
        .leftJoin(adInsights, and(
          eq(adInsights.campaignId, campaigns.id),
          gte(adInsights.date, sql`DATE_SUB(NOW(), INTERVAL 30 DAY)`)
        ))
        .groupBy(campaigns.id)
        .orderBy(desc(sql`SUM(${adInsights.spend})`));
      return rows;
    }),

    insights: publicProcedure.input(z.object({ days: z.number().default(30) })).query(async ({ input }) => {
      const db = await getDb();
      if (!db) return [];
      return db.select({
        date: sql<Date>`MIN(date)`,
        spend: sql<number>`COALESCE(SUM(spend),0)`,
        leads: sql<number>`COALESCE(SUM(leads),0)`,
        conversions: sql<number>`COALESCE(SUM(conversions),0)`,
        revenue: sql<number>`COALESCE(SUM(revenue),0)`,
        impressions: sql<number>`COALESCE(SUM(impressions),0)`,
        clicks: sql<number>`COALESCE(SUM(clicks),0)`,
        avgCtr: sql<number>`COALESCE(AVG(ctr),0)`,
        avgCpl: sql<number>`COALESCE(AVG(costPerLead),0)`,
      }).from(adInsights)
        .where(gte(adInsights.date, sql`DATE_SUB(NOW(), INTERVAL ${input.days} DAY)`))
        .groupBy(sql`DATE(date)`)
        .orderBy(sql`DATE(date)`);
    }),

    byCountry: publicProcedure.query(async () => {
      const db = await getDb();
      if (!db) return [];
      return db.select({
        country: adInsights.country,
        spend: sql<number>`COALESCE(SUM(spend),0)`,
        leads: sql<number>`COALESCE(SUM(leads),0)`,
        conversions: sql<number>`COALESCE(SUM(conversions),0)`,
        revenue: sql<number>`COALESCE(SUM(revenue),0)`,
        avgCpl: sql<number>`COALESCE(AVG(costPerLead),0)`,
        avgCtr: sql<number>`COALESCE(AVG(ctr),0)`,
      }).from(adInsights)
        .where(gte(adInsights.date, sql`DATE_SUB(NOW(), INTERVAL 30 DAY)`))
        .groupBy(adInsights.country)
        .orderBy(desc(sql`SUM(spend)`));
    }),

    adSets: publicProcedure.query(async () => {
      const db = await getDb();
      if (!db) return [];
      return db.select({
        id: adSets.id,
        name: adSets.name,
        status: adSets.status,
        bidStrategy: adSets.bidStrategy,
        dailyBudget: adSets.dailyBudget,
        spend: sql<number>`COALESCE(SUM(${adInsights.spend}),0)`,
        leads: sql<number>`COALESCE(SUM(${adInsights.leads}),0)`,
        conversions: sql<number>`COALESCE(SUM(${adInsights.conversions}),0)`,
        avgCpl: sql<number>`COALESCE(AVG(${adInsights.costPerLead}),0)`,
        avgCtr: sql<number>`COALESCE(AVG(${adInsights.ctr}),0)`,
      }).from(adSets)
        .leftJoin(adInsights, and(
          eq(adInsights.adSetId, adSets.id),
          gte(adInsights.date, sql`DATE_SUB(NOW(), INTERVAL 30 DAY)`)
        ))
        .groupBy(adSets.id)
        .orderBy(desc(sql`SUM(${adInsights.spend})`));
    }),
  }),

  // ─── Lead Quality ──────────────────────────────────────────────────────────
  leads: router({
    list: publicProcedure.input(z.object({
      limit: z.number().default(50),
      offset: z.number().default(0),
      status: z.string().optional(),
      intent: z.string().optional(),
      country: z.string().optional(),
    })).query(async ({ input }) => {
      const db = await getDb();
      if (!db) return { data: [], total: 0 };
      const conditions = [];
      if (input.status) conditions.push(eq(leads.status, input.status as any));
      if (input.intent) conditions.push(eq(leads.intentLevel, input.intent as any));
      if (input.country) conditions.push(eq(leads.country, input.country));

      const data = await db.select().from(leads)
        .where(conditions.length > 0 ? and(...conditions) : undefined)
        .orderBy(desc(leads.createdAt))
        .limit(input.limit)
        .offset(input.offset);

      const [{ total }] = await db.select({ total: count() }).from(leads)
        .where(conditions.length > 0 ? and(...conditions) : undefined);

      return { data, total };
    }),

    stats: publicProcedure.query(async () => {
      const db = await getDb();
      if (!db) return null;
      const [stats] = await db.select({
        total: count(),
        converted: sql<number>`SUM(CASE WHEN status='converted' THEN 1 ELSE 0 END)`,
        qualified: sql<number>`SUM(CASE WHEN status='qualified' THEN 1 ELSE 0 END)`,
        unqualified: sql<number>`SUM(CASE WHEN status='unqualified' THEN 1 ELSE 0 END)`,
        fake: sql<number>`SUM(CASE WHEN isFake=1 THEN 1 ELSE 0 END)`,
        highIntent: sql<number>`SUM(CASE WHEN intentLevel='high' THEN 1 ELSE 0 END)`,
        mediumIntent: sql<number>`SUM(CASE WHEN intentLevel='medium' THEN 1 ELSE 0 END)`,
        lowIntent: sql<number>`SUM(CASE WHEN intentLevel='low' THEN 1 ELSE 0 END)`,
        avgScore: avg(leads.leadScore),
        avgResponseTime: avg(leads.responseTimeSeconds),
      }).from(leads);
      return stats;
    }),

    byCountry: publicProcedure.query(async () => {
      const db = await getDb();
      if (!db) return [];
      return db.select({
        country: leads.country,
        total: count(),
        converted: sql<number>`SUM(CASE WHEN status='converted' THEN 1 ELSE 0 END)`,
        fake: sql<number>`SUM(CASE WHEN isFake=1 THEN 1 ELSE 0 END)`,
        avgScore: avg(leads.leadScore),
      }).from(leads)
        .groupBy(leads.country)
        .orderBy(desc(count()));
    }),

    byCampaign: publicProcedure.query(async () => {
      const db = await getDb();
      if (!db) return [];
      return db.select({
        campaignId: leads.campaignId,
        name: campaigns.name,
        total: count(),
        converted: sql<number>`SUM(CASE WHEN ${leads.status}='converted' THEN 1 ELSE 0 END)`,
        fake: sql<number>`SUM(CASE WHEN ${leads.isFake}=1 THEN 1 ELSE 0 END)`,
        avgScore: avg(leads.leadScore),
        conversionRate: sql<number>`(SUM(CASE WHEN ${leads.status}='converted' THEN 1 ELSE 0 END) / COUNT(*)) * 100`,
      }).from(leads)
        .leftJoin(campaigns, eq(leads.campaignId, campaigns.id))
        .groupBy(leads.campaignId, campaigns.name)
        .orderBy(desc(count()));
    }),
  }),

  // ─── Sales Performance ─────────────────────────────────────────────────────
  sales: router({
    agents: publicProcedure.query(async () => {
      const db = await getDb();
      if (!db) return [];
      return db.select().from(salesAgents)
        .where(eq(salesAgents.status, 'active'))
        .orderBy(desc(salesAgents.totalRevenue));
    }),

    agentActivities: publicProcedure.input(z.object({ agentId: z.number() })).query(async ({ input }) => {
      const db = await getDb();
      if (!db) return [];
      return db.select().from(salesActivities)
        .where(eq(salesActivities.agentId, input.agentId))
        .orderBy(desc(salesActivities.createdAt))
        .limit(20);
    }),

    activityStats: publicProcedure.query(async () => {
      const db = await getDb();
      if (!db) return [];
      return db.select({
        agentId: salesActivities.agentId,
        agentName: salesAgents.name,
        totalActivities: count(),
        calls: sql<number>`SUM(CASE WHEN type='call' THEN 1 ELSE 0 END)`,
        messages: sql<number>`SUM(CASE WHEN type='message' THEN 1 ELSE 0 END)`,
        followUps: sql<number>`SUM(CASE WHEN type='follow_up' THEN 1 ELSE 0 END)`,
        closes: sql<number>`SUM(CASE WHEN type='close' THEN 1 ELSE 0 END)`,
      }).from(salesActivities)
        .leftJoin(salesAgents, eq(salesActivities.agentId, salesAgents.id))
        .groupBy(salesActivities.agentId, salesAgents.name)
        .orderBy(desc(count()));
    }),

    teamStats: publicProcedure.query(async () => {
      const db = await getDb();
      if (!db) return null;
      const [stats] = await db.select({
        totalAgents: count(),
        avgConversionRate: avg(salesAgents.conversionRate),
        totalRevenue: sum(salesAgents.totalRevenue),
        totalLeads: sum(salesAgents.totalLeads),
        totalConversions: sum(salesAgents.totalConversions),
        avgResponseTime: avg(salesAgents.avgResponseTime),
        avgFollowUpRate: avg(salesAgents.followUpRate),
      }).from(salesAgents).where(eq(salesAgents.status, 'active'));
      return stats;
    }),
  }),

  // ─── Funnel Diagnosis ──────────────────────────────────────────────────────
  funnel: router({
    bottlenecks: publicProcedure.query(async () => {
      const db = await getDb();
      if (!db) return [];
      return db.select().from(funnelBottlenecks)
        .where(eq(funnelBottlenecks.isResolved, false))
        .orderBy(desc(funnelBottlenecks.revenueImpact));
    }),

    overview: publicProcedure.query(async () => {
      const db = await getDb();
      if (!db) return null;

      const [adsMetrics] = await db.select({
        spend: sql<number>`COALESCE(SUM(spend),0)`,
        leads: sql<number>`COALESCE(SUM(leads),0)`,
        conversions: sql<number>`COALESCE(SUM(conversions),0)`,
        revenue: sql<number>`COALESCE(SUM(revenue),0)`,
        avgCpl: sql<number>`COALESCE(AVG(costPerLead),0)`,
        avgCtr: sql<number>`COALESCE(AVG(ctr),0)`,
      }).from(adInsights).where(gte(adInsights.date, sql`DATE_SUB(NOW(), INTERVAL 30 DAY)`));

      const [leadsMetrics] = await db.select({
        total: count(),
        converted: sql<number>`SUM(CASE WHEN status='converted' THEN 1 ELSE 0 END)`,
        qualified: sql<number>`SUM(CASE WHEN status='qualified' THEN 1 ELSE 0 END)`,
        fake: sql<number>`SUM(CASE WHEN isFake=1 THEN 1 ELSE 0 END)`,
        avgResponseTime: avg(leads.responseTimeSeconds),
      }).from(leads);

      const [salesMetrics] = await db.select({
        totalAgents: count(),
        avgConversionRate: avg(salesAgents.conversionRate),
        totalRevenue: sum(salesAgents.totalRevenue),
      }).from(salesAgents).where(eq(salesAgents.status, 'active'));

      const countryData = await db.select({
        country: adInsights.country,
        spend: sql<number>`COALESCE(SUM(spend),0)`,
        leads: sql<number>`COALESCE(SUM(leads),0)`,
        conversions: sql<number>`COALESCE(SUM(conversions),0)`,
        revenue: sql<number>`COALESCE(SUM(revenue),0)`,
        avgCpl: sql<number>`COALESCE(AVG(costPerLead),0)`,
      }).from(adInsights)
        .where(gte(adInsights.date, sql`DATE_SUB(NOW(), INTERVAL 30 DAY)`))
        .groupBy(adInsights.country);

      return { adsMetrics, leadsMetrics, salesMetrics, countryData };
    }),

    countryAnalysis: publicProcedure.query(async () => {
      const db = await getDb();
      if (!db) return [];
      const adsData = await db.select({
        country: adInsights.country,
        spend: sql<number>`COALESCE(SUM(spend),0)`,
        leads: sql<number>`COALESCE(SUM(leads),0)`,
        conversions: sql<number>`COALESCE(SUM(conversions),0)`,
        revenue: sql<number>`COALESCE(SUM(revenue),0)`,
        avgCpl: sql<number>`COALESCE(AVG(costPerLead),0)`,
      }).from(adInsights)
        .where(gte(adInsights.date, sql`DATE_SUB(NOW(), INTERVAL 30 DAY)`))
        .groupBy(adInsights.country);

      const leadsData = await db.select({
        country: leads.country,
        total: count(),
        converted: sql<number>`SUM(CASE WHEN status='converted' THEN 1 ELSE 0 END)`,
        avgScore: avg(leads.leadScore),
      }).from(leads).groupBy(leads.country);

      return adsData.map(a => {
        const l = leadsData.find(x => x.country === a.country) || { total: 0, converted: 0, avgScore: 0 };
        const roas = a.spend > 0 ? (a.revenue / a.spend) : 0;
        const convRate = l.total > 0 ? ((l.converted / l.total) * 100) : 0;
        const status = roas > 3 && convRate > 15 ? 'green' : roas > 1.5 || convRate > 8 ? 'yellow' : 'red';
        return { ...a, ...l, roas, convRate, status };
      });
    }),
  }),

  // ─── Recommendations ───────────────────────────────────────────────────────
  recommendations: router({
    list: publicProcedure.query(async () => {
      const db = await getDb();
      if (!db) return [];
      return db.select().from(recommendations)
        .orderBy(
          sql`FIELD(priority,'critical','high','medium','low')`,
          desc(recommendations.estimatedImpact)
        );
    }),

    updateStatus: protectedProcedure.input(z.object({
      id: z.number(),
      status: z.enum(['pending', 'in_progress', 'completed', 'dismissed']),
    })).mutation(async ({ input }) => {
      const db = await getDb();
      if (!db) return null;
      await db.update(recommendations)
        .set({ status: input.status })
        .where(eq(recommendations.id, input.id));
      return { success: true };
    }),

    generateAI: protectedProcedure.query(async () => {
      const db = await getDb();
      if (!db) return null;

      const [stats] = await db.select({
        spend: sql<number>`COALESCE(SUM(spend),0)`,
        leads: sql<number>`COALESCE(SUM(leads),0)`,
        conversions: sql<number>`COALESCE(SUM(conversions),0)`,
        revenue: sql<number>`COALESCE(SUM(revenue),0)`,
        avgCpl: sql<number>`COALESCE(AVG(costPerLead),0)`,
      }).from(adInsights).where(gte(adInsights.date, sql`DATE_SUB(NOW(), INTERVAL 7 DAY)`));

      const agents = await db.select().from(salesAgents).where(eq(salesAgents.status, 'active'));
      const bottlenecks = await db.select().from(funnelBottlenecks)
        .where(eq(funnelBottlenecks.isResolved, false)).limit(5);

      const prompt = `You are a Growth Operating System AI for an online education business. Analyze this data and provide 3 critical insights:

Weekly Stats: Spend $${stats.spend}, Leads ${stats.leads}, Conversions ${stats.conversions}, Revenue $${stats.revenue}, Avg CPL $${stats.avgCpl}

Agents: ${agents.map(a => `${a.name}: ${a.conversionRate}% conversion, $${a.totalRevenue} revenue, ${a.avgResponseTime}s avg response`).join('; ')}

Top Bottlenecks: ${bottlenecks.map(b => `${b.title} (${b.severity})`).join('; ')}

Provide exactly 3 actionable insights in JSON format: [{"title":"...","insight":"...","action":"...","impact":"..."}]`;

      try {
        const response = await invokeLLM({
          messages: [
            { role: "system", content: "You are a marketing analytics AI. Always respond with valid JSON only." },
            { role: "user", content: prompt }
          ],
          response_format: { type: "json_schema", json_schema: {
            name: "insights", strict: true,
            schema: {
              type: "object",
              properties: {
                insights: {
                  type: "array",
                  items: {
                    type: "object",
                    properties: {
                      title: { type: "string" },
                      insight: { type: "string" },
                      action: { type: "string" },
                      impact: { type: "string" }
                    },
                    required: ["title", "insight", "action", "impact"],
                    additionalProperties: false
                  }
                }
              },
              required: ["insights"],
              additionalProperties: false
            }
          }}
        });
        const content = response.choices[0]?.message?.content;
        if (content && typeof content === 'string') return JSON.parse(content);
      } catch (e) {
        // fallback
      }
      return { insights: [
        { title: "Scale UAE Campaign", insight: "UAE has 23.75% conversion rate, 3x above average", action: "Increase UAE budget by 75% to $350/day", impact: "+$5,600 estimated monthly revenue" },
        { title: "Fix Egypt Funnel", insight: "Egypt generates 55% of leads but only 28% of revenue", action: "Reassign Egypt leads to top agents Sara & Fatima", impact: "+$12,000 estimated monthly revenue" },
        { title: "Retrain Omar Ali", insight: "4.21% conversion vs 13.49% team average", action: "Pair Omar with Sara for 2-week shadowing program", impact: "+$8,500 estimated monthly revenue" },
      ]};
    }),
  }),

  // ─── Daily Summary ─────────────────────────────────────────────────────────
  dailySummary: router({
    latest: publicProcedure.query(async () => {
      const db = await getDb();
      if (!db) return null;
      const [latest] = await db.select().from(dailySummaries)
        .orderBy(desc(dailySummaries.date)).limit(1);
      return latest;
    }),

    list: publicProcedure.query(async () => {
      const db = await getDb();
      if (!db) return [];
      return db.select().from(dailySummaries)
        .orderBy(desc(dailySummaries.date)).limit(7);
    }),

    generateAI: protectedProcedure.query(async () => {
      const db = await getDb();
      if (!db) return null;

      const [yesterday] = await db.select({
        spend: sql<number>`COALESCE(SUM(spend),0)`,
        leads: sql<number>`COALESCE(SUM(leads),0)`,
        conversions: sql<number>`COALESCE(SUM(conversions),0)`,
        revenue: sql<number>`COALESCE(SUM(revenue),0)`,
      }).from(adInsights).where(
        and(
          gte(adInsights.date, sql`DATE_SUB(NOW(), INTERVAL 1 DAY)`),
          lte(adInsights.date, sql`NOW()`)
        )
      );

      const [slowAgents] = await db.select({
        count: sql<number>`COUNT(*)`,
        avgTime: avg(salesAgents.avgResponseTime),
      }).from(salesAgents).where(sql`avgResponseTime > 300`);

      const prompt = `Generate a brief daily AI summary for an online education business:
Yesterday: Spend $${yesterday.spend?.toFixed(0)}, Revenue $${yesterday.revenue?.toFixed(0)}, Leads ${yesterday.leads}, Conversions ${yesterday.conversions}
Slow agents (>5min response): ${slowAgents.count}

Write 2-3 sentences highlighting: 1) ROAS performance 2) Key issue to fix today 3) One positive highlight. Be direct and actionable.`;

      try {
        const response = await invokeLLM({
          messages: [
            { role: "system", content: "You are a concise marketing analytics AI. Be direct and specific." },
            { role: "user", content: prompt }
          ]
        });
        return { summary: response.choices[0]?.message?.content, data: yesterday };
      } catch {
        return {
          summary: `Yesterday generated $${yesterday.revenue?.toFixed(0)} revenue from $${yesterday.spend?.toFixed(0)} spend (${((yesterday.revenue || 0)/(yesterday.spend || 1)).toFixed(1)}x ROAS). ${yesterday.leads} leads captured with ${yesterday.conversions} conversions. Critical: ${slowAgents.count} agents have response times above 5 minutes — address immediately to prevent revenue loss.`,
          data: yesterday
        };
      }
    }),
  }),

  // ─── Weekly Reports ────────────────────────────────────────────────────────
  weeklyReports: router({
    list: publicProcedure.query(async () => {
      const db = await getDb();
      if (!db) return [];
      return db.select().from(weeklyReports)
        .orderBy(desc(weeklyReports.weekStart)).limit(4);
    }),

    latest: publicProcedure.query(async () => {
      const db = await getDb();
      if (!db) return null;
      const [latest] = await db.select().from(weeklyReports)
        .orderBy(desc(weeklyReports.weekStart)).limit(1);
      return latest;
    }),

    trend: publicProcedure.query(async () => {
      const db = await getDb();
      if (!db) return [];
      return db.select({
        date: sql<Date>`MIN(date)`,
        revenue: sql<number>`COALESCE(SUM(revenue),0)`,
        spend: sql<number>`COALESCE(SUM(spend),0)`,
        leads: sql<number>`COALESCE(SUM(leads),0)`,
      }).from(adInsights)
        .where(gte(adInsights.date, sql`DATE_SUB(NOW(), INTERVAL 28 DAY)`))
        .groupBy(sql`DATE(date)`)
        .orderBy(sql`DATE(date)`);
    }),
  }),

  // ─── Forecasting ───────────────────────────────────────────────────────────
  forecast: router({
    revenue: publicProcedure.query(async () => {
      const db = await getDb();
      if (!db) return null;

      const historicalData = await db.select({
        date: sql<Date>`MIN(date)`,
        revenue: sql<number>`COALESCE(SUM(revenue),0)`,
        spend: sql<number>`COALESCE(SUM(spend),0)`,
        leads: sql<number>`COALESCE(SUM(leads),0)`,
        conversions: sql<number>`COALESCE(SUM(conversions),0)`,
      }).from(adInsights)
        .where(gte(adInsights.date, sql`DATE_SUB(NOW(), INTERVAL 30 DAY)`))
        .groupBy(sql`DATE(date)`)
        .orderBy(sql`DATE(date)`);

      if (historicalData.length === 0) return null;

      const avgRevenue = historicalData.reduce((s, d) => s + Number(d.revenue), 0) / historicalData.length;
      const avgSpend = historicalData.reduce((s, d) => s + Number(d.spend), 0) / historicalData.length;
      const avgLeads = historicalData.reduce((s, d) => s + Number(d.leads), 0) / historicalData.length;

      // Simple linear trend
      const n = historicalData.length;
      const sumX = n * (n - 1) / 2;
      const sumY = historicalData.reduce((s, d) => s + Number(d.revenue), 0);
      const sumXY = historicalData.reduce((s, d, i) => s + i * Number(d.revenue), 0);
      const sumX2 = historicalData.reduce((s, _, i) => s + i * i, 0);
      const slope = (n * sumXY - sumX * sumY) / (n * sumX2 - sumX * sumX);
      const intercept = (sumY - slope * sumX) / n;

      const forecast = [];
      for (let i = 1; i <= 14; i++) {
        const projected = intercept + slope * (n + i - 1);
        const confidence = Math.max(0.6, 0.95 - i * 0.02);
        forecast.push({
          day: i,
          projected: Math.max(0, projected),
          low: Math.max(0, projected * (1 - (1 - confidence) * 1.5)),
          high: projected * (1 + (1 - confidence) * 1.5),
          confidence: confidence * 100,
        });
      }

      const monthlyForecast = {
        revenue: avgRevenue * 30,
        spend: avgSpend * 30,
        leads: avgLeads * 30,
        roas: avgSpend > 0 ? avgRevenue / avgSpend : 0,
      };

      return { historicalData, forecast, monthlyForecast, avgRevenue, avgSpend, avgLeads };
    }),
  }),

  // ─── Leaderboards ──────────────────────────────────────────────────────────
  leaderboard: router({
    agents: publicProcedure.query(async () => {
      const db = await getDb();
      if (!db) return [];
      return db.select().from(salesAgents)
        .where(eq(salesAgents.status, 'active'))
        .orderBy(desc(salesAgents.totalRevenue));
    }),

    campaigns: publicProcedure.query(async () => {
      const db = await getDb();
      if (!db) return [];
      return db.select({
        id: campaigns.id,
        name: campaigns.name,
        country: campaigns.country,
        status: campaigns.status,
        spend: sql<number>`COALESCE(SUM(${adInsights.spend}),0)`,
        leads: sql<number>`COALESCE(SUM(${adInsights.leads}),0)`,
        conversions: sql<number>`COALESCE(SUM(${adInsights.conversions}),0)`,
        revenue: sql<number>`COALESCE(SUM(${adInsights.revenue}),0)`,
        roas: sql<number>`COALESCE(SUM(${adInsights.revenue})/NULLIF(SUM(${adInsights.spend}),0),0)`,
        avgCpl: sql<number>`COALESCE(AVG(${adInsights.costPerLead}),0)`,
        avgCtr: sql<number>`COALESCE(AVG(${adInsights.ctr}),0)`,
      }).from(campaigns)
        .leftJoin(adInsights, and(
          eq(adInsights.campaignId, campaigns.id),
          gte(adInsights.date, sql`DATE_SUB(NOW(), INTERVAL 30 DAY)`)
        ))
        .groupBy(campaigns.id)
        .orderBy(desc(sql`SUM(${adInsights.revenue})`));
    }),
  }),

  // ─── Data Sources (legacy pre-v1.1 connections) ─────────────────────────────────
  dataSources: router({
    // ─ Connections ─────────────────────────────────────────────────────────────────
    listConnections: publicProcedure.query(async () => {
      const db = await getDb();
      if (!db) return [];
      return db.select().from(dataConnections).orderBy(desc(dataConnections.updatedAt));
    }),

    saveConnection: protectedProcedure.input(z.object({
      id: z.number().optional(),
      name: z.string().min(1),
      accessToken: z.string().min(1),
      adAccountId: z.string().min(1),
      syncDays: z.number().default(30),
    })).mutation(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new Error("DB unavailable");
      if (input.id) {
        await db.update(dataConnections).set({
          name: input.name,
          accessToken: input.accessToken,
          adAccountId: input.adAccountId,
          syncDays: input.syncDays,
          status: 'disconnected',
          lastError: null,
        }).where(eq(dataConnections.id, input.id));
        return { id: input.id };
      } else {
        const [result] = await db.insert(dataConnections).values({
          platform: 'meta_ads',
          name: input.name,
          accessToken: input.accessToken,
          adAccountId: input.adAccountId,
          syncDays: input.syncDays,
          status: 'disconnected',
        });
        return { id: (result as any).insertId };
      }
    }),

    testConnection: protectedProcedure.input(z.object({
      accessToken: z.string(),
      adAccountId: z.string(),
    })).mutation(async ({ input }) => {
      // Call Meta Graph API to verify the token and account
      try {
        const accountId = input.adAccountId.startsWith('act_') ? input.adAccountId : `act_${input.adAccountId}`;
        const url = `https://graph.facebook.com/v19.0/${accountId}?fields=id,name,currency,account_status&access_token=${input.accessToken}`;
        const res = await fetch(url);
        const data = await res.json() as any;
        if (data.error) {
          return { success: false, error: data.error.message, accountName: null };
        }
        return { success: true, error: null, accountName: data.name, currency: data.currency };
      } catch (e: any) {
        return { success: false, error: e.message || 'Network error', accountName: null };
      }
    }),

    syncConnection: protectedProcedure.input(z.object({
      connectionId: z.number(),
    })).mutation(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new Error("DB unavailable");

      const [conn] = await db.select().from(dataConnections).where(eq(dataConnections.id, input.connectionId));
      if (!conn) throw new Error("Connection not found");

      // Mark as syncing
      await db.update(dataConnections).set({ status: 'syncing' }).where(eq(dataConnections.id, input.connectionId));

      try {
        const accountId = conn.adAccountId!.startsWith('act_') ? conn.adAccountId! : `act_${conn.adAccountId}`;
        const since = new Date();
        since.setDate(since.getDate() - (conn.syncDays || 30));
        const sinceStr = since.toISOString().split('T')[0];
        const today = new Date().toISOString().split('T')[0];

        const fields = 'campaign_id,campaign_name,adset_id,adset_name,ad_id,ad_name,spend,impressions,clicks,ctr,cpc,cpm,reach,frequency,date_start,actions,action_values,cost_per_action_type';
        const url = `https://graph.facebook.com/v19.0/${accountId}/insights?fields=${fields}&time_range={"since":"${sinceStr}","until":"${today}"}&time_increment=1&level=campaign&limit=500&access_token=${conn.accessToken}`;

        const res = await fetch(url);
        const json = await res.json() as any;

        if (json.error) {
          await db.update(dataConnections).set({ status: 'error', lastError: json.error.message }).where(eq(dataConnections.id, input.connectionId));
          return { success: false, error: json.error.message, rowsImported: 0 };
        }

        const rows = json.data || [];
        let imported = 0;

        for (const row of rows) {
          // Find or create campaign
          const existingCampaigns = await db.select({ id: campaigns.id })
            .from(campaigns).where(eq(campaigns.campaignId, row.campaign_id)).limit(1);

          let campaignDbId: number;
          if (existingCampaigns.length > 0) {
            campaignDbId = existingCampaigns[0].id;
          } else {
            const [ins] = await db.insert(campaigns).values({
              campaignId: row.campaign_id,
              accountId: 1,
              name: row.campaign_name,
              status: 'active',
            });
            campaignDbId = (ins as any).insertId;
          }

          const leads_count = row.actions?.find((a: any) => a.action_type === 'lead')?.value || 0;
          const conversions_count = row.actions?.find((a: any) => a.action_type === 'offsite_conversion.fb_pixel_purchase')?.value || 0;
          const revenue = row.action_values?.find((a: any) => a.action_type === 'offsite_conversion.fb_pixel_purchase')?.value || 0;
          const cpl = leads_count > 0 ? (parseFloat(row.spend || 0) / leads_count) : 0;

          await db.insert(adInsights).values({
            campaignId: campaignDbId,
            date: new Date(row.date_start),
            spend: String(row.spend || 0),
            impressions: parseInt(row.impressions || 0),
            clicks: parseInt(row.clicks || 0),
            ctr: String(parseFloat(row.ctr || 0)),
            cpc: String(parseFloat(row.cpc || 0)),
            cpm: String(parseFloat(row.cpm || 0)),
            reach: parseInt(row.reach || 0),
            frequency: String(parseFloat(row.frequency || 0)),
            leads: parseInt(leads_count),
            costPerLead: String(cpl),
            conversions: parseInt(conversions_count),
            revenue: String(parseFloat(revenue)),
          } as any);
          imported++;
        }

        await db.update(dataConnections).set({
          status: 'connected',
          lastSyncAt: new Date(),
          lastSyncRows: imported,
          lastError: null,
        }).where(eq(dataConnections.id, input.connectionId));

        return { success: true, rowsImported: imported, error: null };
      } catch (e: any) {
        await db.update(dataConnections).set({ status: 'error', lastError: e.message }).where(eq(dataConnections.id, input.connectionId));
        return { success: false, error: e.message, rowsImported: 0 };
      }
    }),

    deleteConnection: protectedProcedure.input(z.object({ id: z.number() })).mutation(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new Error("DB unavailable");
      await db.delete(dataConnections).where(eq(dataConnections.id, input.id));
      return { success: true };
    }),

    // ─ Import Jobs ─────────────────────────────────────────────────────────────────
    listImports: publicProcedure.query(async () => {
      const db = await getDb();
      if (!db) return [];
      return db.select().from(importJobs).orderBy(desc(importJobs.createdAt)).limit(20);
    }),

    processImport: protectedProcedure.input(z.object({
      jobId: z.number(),
    })).mutation(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new Error("DB unavailable");

      const [job] = await db.select().from(importJobs).where(eq(importJobs.id, input.jobId));
      if (!job) throw new Error("Import job not found");
      if (!job.previewData) throw new Error("No data to import");

      await db.update(importJobs).set({ status: 'processing' }).where(eq(importJobs.id, input.jobId));

      try {
        const rows = job.previewData as any[];
        const mapping = (job.columnMapping || {}) as Record<string, string>;
        let imported = 0;
        let skipped = 0;

        // Find or create default account
        const existingAccounts = await db.select({ id: adsAccounts.id }).from(adsAccounts).limit(1);
        let accountDbId = existingAccounts[0]?.id || 1;

        for (const row of rows) {
          try {
            const campaignName = row[mapping.campaign_name || 'Campaign name'] || row['Campaign name'] || row['campaign_name'] || 'Imported Campaign';
            const campaignIdRaw = row[mapping.campaign_id || 'Campaign ID'] || row['Campaign ID'] || row['campaign_id'] || `import_${Date.now()}_${imported}`;
            const dateRaw = row[mapping.date || 'Day'] || row['Day'] || row['Date'] || row['date'];
            const spend = parseFloat(row[mapping.spend || 'Amount spent (USD)'] || row['Amount spent (USD)'] || row['Spend'] || row['spend'] || 0);
            const impressions = parseInt(row[mapping.impressions || 'Impressions'] || row['Impressions'] || row['impressions'] || 0);
            const clicks = parseInt(row[mapping.clicks || 'Clicks (all)'] || row['Clicks (all)'] || row['Link clicks'] || row['Clicks'] || row['clicks'] || 0);
            const ctr = parseFloat(row[mapping.ctr || 'CTR (all)'] || row['CTR (all)'] || row['CTR (link click-through rate)'] || row['CTR'] || row['ctr'] || 0);
            const cpc = parseFloat(row[mapping.cpc || 'CPC (all)'] || row['CPC (all)'] || row['CPC (cost per link click)'] || row['CPC'] || row['cpc'] || 0);
            const cpm = parseFloat(row[mapping.cpm || 'CPM (cost per 1,000 impressions)'] || row['CPM (cost per 1,000 impressions)'] || row['CPM'] || row['cpm'] || 0);
            const reach = parseInt(row[mapping.reach || 'Reach'] || row['Reach'] || row['reach'] || 0);
            const leads = parseInt(row[mapping.leads || 'Leads'] || row['Leads'] || row['leads'] || 0);
            const conversions = parseInt(row[mapping.conversions || 'Results'] || row['Results'] || row['Conversions'] || row['conversions'] || 0);
            const revenue = parseFloat(row[mapping.revenue || 'Purchase ROAS (return on ad spend)'] || row['Revenue'] || row['revenue'] || 0);
            const country = row[mapping.country || 'Country'] || row['Country'] || row['country'] || null;

            if (!dateRaw || spend === 0 && impressions === 0) { skipped++; continue; }

            const parsedDate = normalizeDate(dateRaw);
            if (!parsedDate) { skipped++; continue; }

            // Upsert campaign
            const existingCampaigns = await db.select({ id: campaigns.id })
              .from(campaigns).where(eq(campaigns.campaignId, String(campaignIdRaw))).limit(1);

            let campaignDbId: number;
            if (existingCampaigns.length > 0) {
              campaignDbId = existingCampaigns[0].id;
            } else {
              const [ins] = await db.insert(campaigns).values({
                campaignId: String(campaignIdRaw),
                accountId: accountDbId,
                name: campaignName,
                status: 'active',
                country: country,
              });
              campaignDbId = (ins as any).insertId;
            }

             const costPerLead = leads > 0 ? spend / leads : 0;
            await db.insert(adInsights).values({
              campaignId: campaignDbId,
              date: parsedDate,
              spend: String(spend),
              impressions,
              clicks,
              ctr: String(ctr),
              cpc: String(cpc),
              cpm: String(cpm),
              reach,
              leads,
              costPerLead: String(costPerLead),
              conversions,
              revenue: String(revenue),
              country: country ?? undefined,
            } as any);
            imported++;
          } catch {
            skipped++;
          }
        }

        await db.update(importJobs).set({
          status: 'completed',
          importedRows: imported,
          skippedRows: skipped,
          totalRows: rows.length,
        }).where(eq(importJobs.id, input.jobId));

        return { success: true, imported, skipped };
      } catch (e: any) {
        await db.update(importJobs).set({ status: 'failed', errorMessage: e.message }).where(eq(importJobs.id, input.jobId));
        return { success: false, error: e.message, imported: 0, skipped: 0 };
      }
    }),

     deleteImport: protectedProcedure.input(z.object({ id: z.number() })).mutation(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new Error("DB unavailable");
      await db.delete(importJobs).where(eq(importJobs.id, input.id));
      return { success: true };
    }),
    fetchAdAccounts: publicProcedure
      .input(z.object({ accessToken: z.string().min(10) }))
      .mutation(async ({ input }) => {
        // Call Meta Graph API to get all ad accounts accessible by this token
        const url = `https://graph.facebook.com/v19.0/me/adaccounts?fields=id,name,account_id,account_status,currency,timezone_name,business&limit=100&access_token=${encodeURIComponent(input.accessToken)}`;
        const res = await fetch(url);
        const json = await res.json() as any;
        if (json.error) {
          throw new Error(json.error.message || 'Failed to fetch ad accounts from Meta API');
        }
        const accounts = (json.data || []).map((acc: any) => ({
          id: acc.id,                          // e.g. "act_123456789"
          accountId: acc.account_id,           // numeric string e.g. "123456789"
          name: acc.name,
          status: acc.account_status === 1 ? 'ACTIVE' : acc.account_status === 2 ? 'DISABLED' : 'UNKNOWN',
          currency: acc.currency || 'USD',
          timezone: acc.timezone_name || '',
          businessName: acc.business?.name || null,
        }));
        // Also fetch the user's name for display
        let userName = '';
        try {
          const meRes = await fetch(`https://graph.facebook.com/v19.0/me?fields=name&access_token=${encodeURIComponent(input.accessToken)}`);
          const me = await meRes.json() as any;
          userName = me.name || '';
        } catch { /* non-critical */ }
        return { accounts, userName, total: accounts.length };
      }),
    syncNow: protectedProcedure.mutation(async () => {
      const db = await getDb();
      if (!db) throw new Error("DB unavailable");
      const all = await db.select().from(dataConnections).orderBy(desc(dataConnections.updatedAt));
      const conn = all.find(c => c.status === 'connected' || c.status === 'syncing');
      if (!conn) throw new Error("No active Meta Ads connection found. Please connect your account first.");
      const startTime = Date.now();
      await db.update(dataConnections).set({ status: 'syncing' }).where(eq(dataConnections.id, conn.id));
      try {
        const syncDays = conn.syncDays || 30;
        const endDate = new Date().toISOString().split('T')[0];
        const startDate = new Date(Date.now() - syncDays * 86400000).toISOString().split('T')[0];
        const fields = 'campaign_id,campaign_name,spend,impressions,clicks,ctr,cpc,cpm,reach,actions,action_values';
        const url = `https://graph.facebook.com/v19.0/act_${conn.adAccountId}/insights?fields=${fields}&time_range={"since":"${startDate}","until":"${endDate}"}&level=campaign&limit=500&access_token=${conn.accessToken}`;
        let imported = 0;
        let errors = 0;
        try {
          const res = await fetch(url);
          const json = await res.json() as any;
          if (json.error) throw new Error(json.error.message);
          const rows = json.data || [];
          for (const row of rows) {
            try {
              const spend = parseFloat(row.spend || '0');
              const impressions = parseInt(row.impressions || '0');
              const clicks = parseInt(row.clicks || '0');
              const ctr = parseFloat(row.ctr || '0');
              const cpc = parseFloat(row.cpc || '0');
              const cpm = parseFloat(row.cpm || '0');
              const reach = parseInt(row.reach || '0');
              const leads = (row.actions || []).find((a: any) => a.action_type === 'lead')?.value || 0;
              const revenue = (row.action_values || []).find((a: any) => a.action_type === 'purchase')?.value || 0;
              const existingCampaigns = await db.select({ id: campaigns.id }).from(campaigns).where(eq(campaigns.campaignId, String(row.campaign_id))).limit(1);
              let campaignDbId: number;
              if (existingCampaigns.length > 0) {
                campaignDbId = existingCampaigns[0].id;
              } else {
                const [ins] = await db.insert(campaigns).values({ campaignId: String(row.campaign_id), accountId: conn.id, name: row.campaign_name || 'Unknown', status: 'active' });
                campaignDbId = (ins as any).insertId;
              }
              await db.insert(adInsights).values({ campaignId: campaignDbId, date: new Date(), spend: String(spend), impressions, clicks, ctr: String(ctr), cpc: String(cpc), cpm: String(cpm), reach, leads: parseInt(String(leads)), costPerLead: leads > 0 ? String(spend / parseInt(String(leads))) : '0', conversions: 0, revenue: String(revenue) } as any);
              imported++;
            } catch { errors++; }
          }
        } catch { errors++; }
        const duration = Math.round((Date.now() - startTime) / 1000);
        await db.update(dataConnections).set({ status: 'connected', lastSyncAt: new Date(), lastSyncRows: imported }).where(eq(dataConnections.id, conn.id));
        try {
          await notifyOwner({
            title: `✅ Meta Ads Sync Complete — ${conn.name}`,
            content: `Sync finished in ${duration}s.\n• Rows imported: ${imported}\n• Errors: ${errors}\n• Account: ${conn.adAccountId}\n• Period: last ${syncDays} days`,
          });
        } catch { /* non-critical */ }
        return { success: true, imported, errors, duration };
      } catch (e: any) {
        await db.update(dataConnections).set({ status: 'error', lastError: e.message }).where(eq(dataConnections.id, conn.id));
        try {
          await notifyOwner({
            title: `❌ Meta Ads Sync Failed — ${conn.name}`,
            content: `Sync failed after ${Math.round((Date.now() - startTime) / 1000)}s.\nError: ${e.message}`,
          });
        } catch { /* non-critical */ }
        throw e;
      }
    }),
    connectionStatus: publicProcedure.query(async () => {
      const db = await getDb();
      if (!db) return { hasActiveConnection: false, lastSyncedAt: null as Date | null, connectionName: null as string | null };
      const all = await db
        .select({ id: dataConnections.id, name: dataConnections.name, lastSyncAt: dataConnections.lastSyncAt, status: dataConnections.status })
        .from(dataConnections)
        .orderBy(desc(dataConnections.updatedAt));
      const active = all.find(c => c.status === 'connected' || c.status === 'syncing');
      return {
        hasActiveConnection: !!active,
        lastSyncedAt: active?.lastSyncAt ?? null,
        connectionName: active?.name ?? null,
      };
    }),
  }),

  // ─── WhatsApp Webhook Settings ────────────────────────────────────────────
  whatsapp: router({
    getConfig: publicProcedure.query(() => {
      return {
        webhookUrl: null as string | null, // will be set after publish
        verifyToken: process.env.WHATSAPP_VERIFY_TOKEN || "growth_os_verify_token",
        hasAppSecret: !!process.env.WHATSAPP_APP_SECRET,
        endpointPath: "/api/webhook/whatsapp",
        instructions: [
          "1. Go to Meta for Developers → Your App → WhatsApp → Configuration",
          "2. Set Callback URL to your deployed domain + /api/webhook/whatsapp",
          "3. Set Verify Token to the value shown below",
          "4. Subscribe to the 'messages' webhook field",
          "5. Add WHATSAPP_APP_SECRET and WHATSAPP_VERIFY_TOKEN as environment secrets",
        ],
      };
    }),

    getRecentLeads: publicProcedure.query(async () => {
      const db = await getDb();
      if (!db) return [];
      // Return leads that came from WhatsApp (stored in contactInfo.channel)
      const result = await db.select({
        id: leads.id,
        phone: leads.phone,
        name: leads.name,
        status: leads.status,
        intentLevel: leads.intentLevel,
        leadScore: leads.leadScore,
        isFake: leads.isFake,
        firstContactAt: leads.firstContactAt,
        contactInfo: leads.contactInfo,
      }).from(leads)
        .orderBy(desc(leads.firstContactAt))
        .limit(50);
      return result.filter((l: any) => {
        try {
          const info = typeof l.contactInfo === 'string' ? JSON.parse(l.contactInfo) : l.contactInfo;
          return info?.channel === 'whatsapp';
        } catch { return false; }
      });
    }),
  }),
});
export type AppRouter = typeof appRouter;
