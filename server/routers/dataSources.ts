/**
 * Growth OS — Data Sources Router (Build Slice v1.1)
 *
 * Procedures:
 *   dataSources.list       — list all integrations for the workspace
 *   dataSources.connect    — save a Meta Ads access token + ad account ID
 *   dataSources.disconnect — remove an integration
 *   dataSources.syncNow    — trigger a full pipeline run for the workspace
 *   dataSources.runStatus  — return the latest pipeline_runs row for the workspace
 */

import { z } from "zod";
import { eq, and, desc, SQL } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { router, protectedProcedure } from "../_core/trpc";
import { getDb } from "../db";
import { integrations, pipelineRuns } from "../../drizzle/schema";
import { runPipeline } from "../engines/pipeline";
import { resolveOrCreateWorkspace } from "./_workspace";

// ─── Helper alias ─────────────────────────────────────────────────────────────

const resolveWorkspaceId = (userId: number, userName?: string | null) =>
  resolveOrCreateWorkspace(userId, userName);

// ─── Router ───────────────────────────────────────────────────────────────────

export const dataSourcesRouter = router({
  /**
   * List all integrations for the authenticated user's workspace.
   */
  list: protectedProcedure.query(async ({ ctx }) => {
    const db = await getDb();
    if (!db) return [];

    const workspaceId = await resolveWorkspaceId(ctx.user.id, ctx.user.name);

    return db
      .select({
        id: integrations.id,
        provider: integrations.provider,
        adAccountId: integrations.metaAccountId,
        status: integrations.status,
        lastSyncAt: integrations.lastSyncAt,
        lastSyncRows: integrations.lastSyncRows,
        lastSyncError: integrations.lastSyncError,
        createdAt: integrations.createdAt,
      })
      .from(integrations)
      .where(eq(integrations.workspaceId, workspaceId))
      .orderBy(desc(integrations.createdAt));
  }),

  /**
   * Save a Meta Ads access token and ad account ID.
   * Creates a new integration or updates the existing one for this provider.
   */
  connect: protectedProcedure
    .input(
      z.object({
        provider: z.literal("meta"),
        accessToken: z.string().min(1),
        adAccountId: z.string().min(1),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });

      const workspaceId = await resolveWorkspaceId(ctx.user.id, ctx.user.name);

      await db
        .insert(integrations)
        .values({
          workspaceId,
          provider: input.provider,
          accessToken: input.accessToken,
          metaAccountId: input.adAccountId,
          status: "active",
        })
        .onDuplicateKeyUpdate({
          set: {
            accessToken: input.accessToken,
            metaAccountId: input.adAccountId,
            status: "active",
            lastSyncError: null,
          },
        });

      return { success: true };
    }),

  /**
   * Remove an integration by id.
   * Only the workspace owner may disconnect.
   */
  disconnect: protectedProcedure
    .input(z.object({ integrationId: z.number().int().positive() }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });

      const workspaceId = await resolveWorkspaceId(ctx.user.id, ctx.user.name);

      // Verify the integration belongs to this workspace
      const rows = await db
        .select({ id: integrations.id })
        .from(integrations)
        .where(
          and(
            eq(integrations.id, input.integrationId),
            eq(integrations.workspaceId, workspaceId),
          ),
        )
        .limit(1);

      if (rows.length === 0) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Integration not found" });
      }

      await db
        .delete(integrations)
        .where(eq(integrations.id, input.integrationId));

      return { success: true };
    }),

  /**
   * Trigger a full pipeline run for the workspace.
   * Returns the runId, status, and stepsCompleted so the UI can poll runStatus.
   */
  syncNow: protectedProcedure.mutation(async ({ ctx }) => {
    const workspaceId = await resolveWorkspaceId(ctx.user.id, ctx.user.name);

    const result = await runPipeline({ workspaceId, trigger: "manual" });

    return {
      runId: result.runId,
      status: result.status,
      stepsCompleted: result.stepsCompleted,
    };
  }),

  /**
   * Manually trigger a cron-style pipeline run from the Scheduled Runs tab.
   * Uses trigger='cron' so the run appears in the scheduled runs history.
   */
  runCronNow: protectedProcedure.mutation(async ({ ctx }) => {
    const workspaceId = await resolveWorkspaceId(ctx.user.id, ctx.user.name);

    const result = await runPipeline({ workspaceId, trigger: "cron" });

    return {
      runId: result.runId,
      status: result.status,
      stepsCompleted: result.stepsCompleted,
    };
  }),

  /**
   * Return the most recent pipeline_runs row for the workspace.
   * Used by the UI to poll sync progress.
   */
  runStatus: protectedProcedure.query(async ({ ctx }) => {
    const db = await getDb();
    if (!db) return null;

    const workspaceId = await resolveWorkspaceId(ctx.user.id, ctx.user.name);

    const rows = await db
      .select()
      .from(pipelineRuns)
      .where(eq(pipelineRuns.workspaceId, workspaceId))
      .orderBy(desc(pipelineRuns.startedAt))
      .limit(1);

    return rows[0] ?? null;
  }),

  /**
   * Return the last 20 cron-triggered pipeline runs for the workspace.
   * Optionally filtered by status (all | running | completed | failed | partial).
   * Used by the Scheduled Runs tab on the Data Sources page.
   */
  scheduledRuns: protectedProcedure
    .input(
      z.object({
        limit: z.number().int().min(1).max(100).default(20),
        status: z.enum(["all", "running", "completed", "failed", "partial"]).default("all"),
      }).optional(),
    )
    .query(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) return [];

      const workspaceId = await resolveWorkspaceId(ctx.user.id, ctx.user.name);

      const statusFilter = input?.status ?? "all";
      const conditions: SQL[] = [
        eq(pipelineRuns.workspaceId, workspaceId),
        eq(pipelineRuns.trigger, "cron"),
      ];
      if (statusFilter !== "all") {
        conditions.push(
          eq(pipelineRuns.status, statusFilter as "running" | "completed" | "failed" | "partial"),
        );
      }

      const rows = await db
        .select({
          id: pipelineRuns.id,
          runId: pipelineRuns.runId,
          status: pipelineRuns.status,
          trigger: pipelineRuns.trigger,
          startedAt: pipelineRuns.startedAt,
          endedAt: pipelineRuns.endedAt,
          durationMs: pipelineRuns.durationMs,
          stepsCompleted: pipelineRuns.stepsCompleted,
          stepErrors: pipelineRuns.stepErrors,
          stepResults: pipelineRuns.stepResults,
        })
        .from(pipelineRuns)
        .where(and(...conditions))
        .orderBy(desc(pipelineRuns.startedAt))
        .limit(input?.limit ?? 20);

      return rows;
    }),
});
