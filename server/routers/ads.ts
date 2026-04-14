/**
 * Growth OS — Ads Router (Build Slice v1.1)
 *
 * Procedures:
 *   ads.campaigns  — list engine_campaigns for the workspace with 7d and 30d metrics
 *   ads.adSets     — list engine_ad_sets for the workspace with 7d and 30d metrics
 *   ads.metrics    — daily_metrics time-series for a specific entity
 */

import { z } from "zod";
import { eq, and, gte, desc, sql } from "drizzle-orm";
import { router, protectedProcedure } from "../_core/trpc";
import { getDb } from "../db";
import {
  engineCampaigns,
  engineAdSets,
  dailyMetrics,
} from "../../drizzle/schema";
import { resolveOrCreateWorkspace } from "./_workspace";

// ─── Router ───────────────────────────────────────────────────────────────────

export const adsRouter = router({
  /**
   * List engine_campaigns for the workspace, joined with aggregated 7d and 30d metrics.
   */
  campaigns: protectedProcedure.query(async ({ ctx }) => {
    const db = await getDb();
    if (!db) return [];

    const workspaceId = await resolveOrCreateWorkspace(ctx.user.id, ctx.user.name);

    const campaigns = await db
      .select()
      .from(engineCampaigns)
      .where(eq(engineCampaigns.workspaceId, workspaceId))
      .orderBy(desc(engineCampaigns.updatedAt));

    if (campaigns.length === 0) return [];

    // Aggregate 7d metrics per campaign
    const metrics7d = await db
      .select({
        entityId: dailyMetrics.entityId,
        spend7d: sql<number>`COALESCE(SUM(${dailyMetrics.spend}), 0)`,
        impressions7d: sql<number>`COALESCE(SUM(${dailyMetrics.impressions}), 0)`,
        clicks7d: sql<number>`COALESCE(SUM(${dailyMetrics.clicks}), 0)`,
        leads7d: sql<number>`COALESCE(SUM(${dailyMetrics.leads}), 0)`,
        avgCtr7d: sql<number>`COALESCE(AVG(${dailyMetrics.ctr}), 0)`,
        avgCpc7d: sql<number>`COALESCE(AVG(${dailyMetrics.cpc}), 0)`,
        avgCpm7d: sql<number>`COALESCE(AVG(${dailyMetrics.cpm}), 0)`,
        avgCpl7d: sql<number>`COALESCE(AVG(${dailyMetrics.cpl}), 0)`,
      })
      .from(dailyMetrics)
      .where(
        and(
          eq(dailyMetrics.workspaceId, workspaceId),
          eq(dailyMetrics.entityType, "campaign"),
          gte(dailyMetrics.date, sql`DATE_SUB(CURDATE(), INTERVAL 7 DAY)`),
        ),
      )
      .groupBy(dailyMetrics.entityId);

    const metricsMap = new Map(metrics7d.map((m) => [m.entityId, m]));

    return campaigns.map((c) => {
      const m = metricsMap.get(c.id);
      return {
        ...c,
        spend7d: m?.spend7d ?? 0,
        impressions7d: m?.impressions7d ?? 0,
        clicks7d: m?.clicks7d ?? 0,
        leads7d: m?.leads7d ?? 0,
        avgCtr7d: m?.avgCtr7d ?? 0,
        avgCpc7d: m?.avgCpc7d ?? 0,
        avgCpm7d: m?.avgCpm7d ?? 0,
        avgCpl7d: m?.avgCpl7d ?? 0,
      };
    });
  }),

  /**
   * List engine_ad_sets for the workspace, joined with aggregated 7d metrics.
   */
  adSets: protectedProcedure.query(async ({ ctx }) => {
    const db = await getDb();
    if (!db) return [];

    const workspaceId = await resolveOrCreateWorkspace(ctx.user.id, ctx.user.name);

    const adSets = await db
      .select()
      .from(engineAdSets)
      .where(eq(engineAdSets.workspaceId, workspaceId))
      .orderBy(desc(engineAdSets.createdAt));

    if (adSets.length === 0) return [];

    const metrics7d = await db
      .select({
        entityId: dailyMetrics.entityId,
        spend7d: sql<number>`COALESCE(SUM(${dailyMetrics.spend}), 0)`,
        impressions7d: sql<number>`COALESCE(SUM(${dailyMetrics.impressions}), 0)`,
        clicks7d: sql<number>`COALESCE(SUM(${dailyMetrics.clicks}), 0)`,
        leads7d: sql<number>`COALESCE(SUM(${dailyMetrics.leads}), 0)`,
        avgCtr7d: sql<number>`COALESCE(AVG(${dailyMetrics.ctr}), 0)`,
        avgCpl7d: sql<number>`COALESCE(AVG(${dailyMetrics.cpl}), 0)`,
        avgCpm7d: sql<number>`COALESCE(AVG(${dailyMetrics.cpm}), 0)`,
      })
      .from(dailyMetrics)
      .where(
        and(
          eq(dailyMetrics.workspaceId, workspaceId),
          eq(dailyMetrics.entityType, "ad_set"),
          gte(dailyMetrics.date, sql`DATE_SUB(CURDATE(), INTERVAL 7 DAY)`),
        ),
      )
      .groupBy(dailyMetrics.entityId);

    const metricsMap = new Map(metrics7d.map((m) => [m.entityId, m]));

    return adSets.map((a) => {
      const m = metricsMap.get(a.id);
      return {
        ...a,
        spend7d: m?.spend7d ?? 0,
        impressions7d: m?.impressions7d ?? 0,
        clicks7d: m?.clicks7d ?? 0,
        leads7d: m?.leads7d ?? 0,
        avgCtr7d: m?.avgCtr7d ?? 0,
        avgCpl7d: m?.avgCpl7d ?? 0,
        avgCpm7d: m?.avgCpm7d ?? 0,
      };
    });
  }),

  /**
   * Daily metrics time-series for a specific campaign or ad set.
   * Returns up to `days` rows ordered by date ascending.
   */
  metrics: protectedProcedure
    .input(
      z.object({
        entityType: z.enum(["campaign", "ad_set"]),
        entityId: z.number().int().positive(),
        days: z.number().int().min(1).max(90).default(30),
      }),
    )
    .query(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) return [];

      const workspaceId = await resolveOrCreateWorkspace(ctx.user.id, ctx.user.name);

      return db
        .select()
        .from(dailyMetrics)
        .where(
          and(
            eq(dailyMetrics.workspaceId, workspaceId),
            eq(dailyMetrics.entityType, input.entityType),
            eq(dailyMetrics.entityId, input.entityId),
            gte(
              dailyMetrics.date,
              sql`DATE_SUB(CURDATE(), INTERVAL ${input.days} DAY)`,
            ),
          ),
        )
        .orderBy(dailyMetrics.date);
    }),
});
