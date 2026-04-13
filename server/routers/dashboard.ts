/**
 * Growth OS — Dashboard Router (Build Slice v1.1)
 *
 * Procedures:
 *   dashboard.brief       — return the most recent daily_briefs row for the workspace
 *   dashboard.funnelHealth — return the funnel health signal from the latest brief
 *   dashboard.kpis        — return yesterday's KPIs from the latest brief
 *   dashboard.runHistory  — return the last 10 pipeline_runs rows for the workspace
 */

import { eq, desc } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { router, protectedProcedure } from "../_core/trpc";
import { getDb } from "../db";
import { workspaces, dailyBriefs, pipelineRuns } from "../../drizzle/schema";

// ─── Helper ───────────────────────────────────────────────────────────────────

async function resolveWorkspaceId(userId: number): Promise<number> {
  const db = await getDb();
  if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });

  const rows = await db
    .select({ id: workspaces.id })
    .from(workspaces)
    .where(eq(workspaces.ownerId, userId))
    .limit(1);

  if (rows.length === 0) {
    throw new TRPCError({ code: "NOT_FOUND", message: "Workspace not found" });
  }
  return rows[0].id;
}

// ─── Router ───────────────────────────────────────────────────────────────────

export const dashboardRouter = router({
  /**
   * Return the most recent daily_briefs row for the workspace.
   * Returns null if no brief has been generated yet.
   */
  brief: protectedProcedure.query(async ({ ctx }) => {
    const db = await getDb();
    if (!db) return null;

    const workspaceId = await resolveWorkspaceId(ctx.user.id);

    const rows = await db
      .select()
      .from(dailyBriefs)
      .where(eq(dailyBriefs.workspaceId, workspaceId))
      .orderBy(desc(dailyBriefs.briefDate))
      .limit(1);

    return rows[0] ?? null;
  }),

  /**
   * Return the funnel health signal from the latest brief.
   * Shape: { ads: 'green'|'yellow'|'red', leads: ..., sales: ... } | null
   */
  funnelHealth: protectedProcedure.query(async ({ ctx }) => {
    const db = await getDb();
    if (!db) return null;

    const workspaceId = await resolveWorkspaceId(ctx.user.id);

    const rows = await db
      .select({ funnelHealth: dailyBriefs.funnelHealth })
      .from(dailyBriefs)
      .where(eq(dailyBriefs.workspaceId, workspaceId))
      .orderBy(desc(dailyBriefs.briefDate))
      .limit(1);

    if (rows.length === 0) return null;

    return rows[0].funnelHealth as {
      ads: "green" | "yellow" | "red";
      leads: "green" | "yellow" | "red";
      sales: "green" | "yellow" | "red";
    } | null;
  }),

  /**
   * Return yesterday's KPIs from the latest brief.
   * Shape: { totalSpend, totalLeads, avgCPL, activeCampaigns } | null
   */
  kpis: protectedProcedure.query(async ({ ctx }) => {
    const db = await getDb();
    if (!db) return null;

    const workspaceId = await resolveWorkspaceId(ctx.user.id);

    const rows = await db
      .select({ kpis: dailyBriefs.kpis })
      .from(dailyBriefs)
      .where(eq(dailyBriefs.workspaceId, workspaceId))
      .orderBy(desc(dailyBriefs.briefDate))
      .limit(1);

    if (rows.length === 0) return null;

    return rows[0].kpis as {
      totalSpend: number;
      totalLeads: number;
      avgCPL: number;
      activeCampaigns: number;
    } | null;
  }),

  /**
   * Return the last 10 pipeline_runs rows for the workspace.
   * Used to display sync history and debug failed runs.
   */
  runHistory: protectedProcedure.query(async ({ ctx }) => {
    const db = await getDb();
    if (!db) return [];

    const workspaceId = await resolveWorkspaceId(ctx.user.id);

    return db
      .select({
        id: pipelineRuns.id,
        runId: pipelineRuns.runId,
        status: pipelineRuns.status,
        trigger: pipelineRuns.trigger,
        startedAt: pipelineRuns.startedAt,
        endedAt: pipelineRuns.endedAt,
        durationMs: pipelineRuns.durationMs,
        stepsCompleted: pipelineRuns.stepsCompleted,
      })
      .from(pipelineRuns)
      .where(eq(pipelineRuns.workspaceId, workspaceId))
      .orderBy(desc(pipelineRuns.startedAt))
      .limit(10);
  }),
});
