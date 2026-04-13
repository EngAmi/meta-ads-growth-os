/**
 * Growth OS — Recommendations Router (Build Slice v1.1)
 *
 * Procedures:
 *   recommendations.list    — list pending recommendations sorted by priorityScore desc
 *   recommendations.accept  — mark a recommendation as accepted
 *   recommendations.dismiss — mark a recommendation as dismissed
 */

import { z } from "zod";
import { eq, and, desc } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { router, protectedProcedure } from "../_core/trpc";
import { getDb } from "../db";
import { workspaces, engineRecommendations } from "../../drizzle/schema";

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

export const recommendationsRouter = router({
  /**
   * List recommendations for the workspace.
   * Defaults to status = 'pending', sorted by priorityScore descending.
   */
  list: protectedProcedure
    .input(
      z.object({
        status: z
          .enum(["pending", "accepted", "dismissed", "expired"])
          .default("pending"),
        limit: z.number().int().min(1).max(100).default(20),
        offset: z.number().int().min(0).default(0),
      }),
    )
    .query(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) return { data: [], total: 0 };

      const workspaceId = await resolveWorkspaceId(ctx.user.id);

      const data = await db
        .select()
        .from(engineRecommendations)
        .where(
          and(
            eq(engineRecommendations.workspaceId, workspaceId),
            eq(engineRecommendations.status, input.status),
          ),
        )
        .orderBy(desc(engineRecommendations.priorityScore))
        .limit(input.limit)
        .offset(input.offset);

      const countRows = await db
        .select({ id: engineRecommendations.id })
        .from(engineRecommendations)
        .where(
          and(
            eq(engineRecommendations.workspaceId, workspaceId),
            eq(engineRecommendations.status, input.status),
          ),
        );

      return { data, total: countRows.length };
    }),

  /**
   * Mark a recommendation as accepted.
   */
  accept: protectedProcedure
    .input(z.object({ recommendationId: z.number().int().positive() }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });

      const workspaceId = await resolveWorkspaceId(ctx.user.id);

      const rows = await db
        .select({ id: engineRecommendations.id })
        .from(engineRecommendations)
        .where(
          and(
            eq(engineRecommendations.id, input.recommendationId),
            eq(engineRecommendations.workspaceId, workspaceId),
          ),
        )
        .limit(1);

      if (rows.length === 0) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Recommendation not found" });
      }

      await db
        .update(engineRecommendations)
        .set({ status: "accepted" })
        .where(eq(engineRecommendations.id, input.recommendationId));

      return { success: true };
    }),

  /**
   * Mark a recommendation as dismissed.
   */
  dismiss: protectedProcedure
    .input(z.object({ recommendationId: z.number().int().positive() }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });

      const workspaceId = await resolveWorkspaceId(ctx.user.id);

      const rows = await db
        .select({ id: engineRecommendations.id })
        .from(engineRecommendations)
        .where(
          and(
            eq(engineRecommendations.id, input.recommendationId),
            eq(engineRecommendations.workspaceId, workspaceId),
          ),
        )
        .limit(1);

      if (rows.length === 0) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Recommendation not found" });
      }

      await db
        .update(engineRecommendations)
        .set({ status: "dismissed" })
        .where(eq(engineRecommendations.id, input.recommendationId));

      return { success: true };
    }),
});
