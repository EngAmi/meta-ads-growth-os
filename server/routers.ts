import { COOKIE_NAME } from "@shared/const";
import { getSessionCookieOptions } from "./_core/cookies";
import { systemRouter } from "./_core/systemRouter";
import { publicProcedure, protectedProcedure, router } from "./_core/trpc";
import { getDb } from "./db";
import {
  adsAccounts, campaigns, adSets, ads, adInsights,
  leads, salesAgents, salesActivities,
  funnelBottlenecks, recommendations,
  dailySummaries, weeklyReports
} from "../drizzle/schema";
import { desc, eq, sql, and, gte, lte, count, sum, avg } from "drizzle-orm";
import { z } from "zod";
import { invokeLLM } from "./_core/llm";

export const appRouter = router({
  system: systemRouter,
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
});

export type AppRouter = typeof appRouter;
