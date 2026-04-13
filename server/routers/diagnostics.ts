/**
 * Growth OS — Diagnostics Router (Build Slice v1.1)
 *
 * Procedures:
 *   diagnostics.list        — list active diagnostics for the workspace, sorted by severity desc
 *   diagnostics.acknowledge — mark a diagnostic as acknowledged
 */

import { z } from "zod";
import { eq, and, desc } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { router, protectedProcedure } from "../_core/trpc";
import { getDb } from "../db";
import { workspaces, engineDiagnostics } from "../../drizzle/schema";

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

export const diagnosticsRouter = router({
  /**
   * List active diagnostics for the workspace, sorted by severity descending.
   * Optionally filter by ruleId or category.
   */
  list: protectedProcedure
    .input(
      z.object({
        status: z.enum(["active", "acknowledged"]).default("active"),
        ruleId: z.string().optional(),
        category: z.enum(["creative", "audience", "funnel", "tracking"]).optional(),
        limit: z.number().int().min(1).max(100).default(50),
        offset: z.number().int().min(0).default(0),
      }),
    )
    .query(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) return { data: [], total: 0 };

      const workspaceId = await resolveWorkspaceId(ctx.user.id);

      const conditions = [
        eq(engineDiagnostics.workspaceId, workspaceId),
        eq(engineDiagnostics.status, input.status),
      ];

      if (input.ruleId) {
        conditions.push(eq(engineDiagnostics.ruleId, input.ruleId));
      }
      if (input.category) {
        conditions.push(eq(engineDiagnostics.category, input.category));
      }

      const data = await db
        .select()
        .from(engineDiagnostics)
        .where(and(...conditions))
        .orderBy(desc(engineDiagnostics.severity))
        .limit(input.limit)
        .offset(input.offset);

      // Total count for pagination
      const countRows = await db
        .select({ id: engineDiagnostics.id })
        .from(engineDiagnostics)
        .where(and(...conditions));

      return { data, total: countRows.length };
    }),

  /**
   * Mark a diagnostic as acknowledged.
   * Only the workspace owner may acknowledge.
   */
  acknowledge: protectedProcedure
    .input(z.object({ diagnosticId: z.number().int().positive() }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });

      const workspaceId = await resolveWorkspaceId(ctx.user.id);

      // Verify ownership
      const rows = await db
        .select({ id: engineDiagnostics.id })
        .from(engineDiagnostics)
        .where(
          and(
            eq(engineDiagnostics.id, input.diagnosticId),
            eq(engineDiagnostics.workspaceId, workspaceId),
          ),
        )
        .limit(1);

      if (rows.length === 0) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Diagnostic not found" });
      }

      await db
        .update(engineDiagnostics)
        .set({ status: "acknowledged" })
        .where(eq(engineDiagnostics.id, input.diagnosticId));

      return { success: true };
    }),
});
