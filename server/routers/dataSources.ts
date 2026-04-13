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
import { eq, and, desc } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { router, protectedProcedure } from "../_core/trpc";
import { getDb } from "../db";
import { workspaces, integrations, pipelineRuns } from "../../drizzle/schema";
import { runPipeline } from "../engines/pipeline";

// ─── Helper: resolve workspaceId for the authenticated user ──────────────────

async function resolveWorkspaceId(userId: number): Promise<number> {
  const db = await getDb();
  if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });

  const rows = await db
    .select({ id: workspaces.id })
    .from(workspaces)
    .where(eq(workspaces.ownerId, userId))
    .limit(1);

  if (rows.length === 0) {
    throw new TRPCError({ code: "NOT_FOUND", message: "Workspace not found. Call workspace.mine first." });
  }

  return rows[0].id;
}

// ─── Router ───────────────────────────────────────────────────────────────────

export const dataSourcesRouter = router({
  /**
   * List all integrations for the authenticated user's workspace.
   */
  list: protectedProcedure.query(async ({ ctx }) => {
    const db = await getDb();
    if (!db) return [];

    const workspaceId = await resolveWorkspaceId(ctx.user.id);

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

      const workspaceId = await resolveWorkspaceId(ctx.user.id);

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

      const workspaceId = await resolveWorkspaceId(ctx.user.id);

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
    const workspaceId = await resolveWorkspaceId(ctx.user.id);

    const result = await runPipeline({ workspaceId, trigger: "manual" });

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

    const workspaceId = await resolveWorkspaceId(ctx.user.id);

    const rows = await db
      .select()
      .from(pipelineRuns)
      .where(eq(pipelineRuns.workspaceId, workspaceId))
      .orderBy(desc(pipelineRuns.startedAt))
      .limit(1);

    return rows[0] ?? null;
  }),
});
