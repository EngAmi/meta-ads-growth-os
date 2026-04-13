/**
 * Growth OS — Workspace Router (Build Slice v1.1)
 *
 * Procedures:
 *   workspace.mine   — return the workspace for the current user (auto-create on first call)
 *   workspace.update — update workspace name
 */

import { z } from "zod";
import { eq } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { router, protectedProcedure } from "../_core/trpc";
import { getDb } from "../db";
import { workspaces } from "../../drizzle/schema";

export const workspaceRouter = router({
  /**
   * Return the workspace that belongs to the authenticated user.
   * If no workspace exists yet, one is created automatically.
   */
  mine: protectedProcedure.query(async ({ ctx }) => {
    const db = await getDb();
    if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });

    const userId = ctx.user.id;

    const existing = await db
      .select()
      .from(workspaces)
      .where(eq(workspaces.ownerId, userId))
      .limit(1);

    if (existing.length > 0) return existing[0];

    // Auto-create workspace on first login
    await db.insert(workspaces).values({
      ownerId: userId,
      name: ctx.user.name ? `${ctx.user.name}'s Workspace` : "My Workspace",
    });

    const created = await db
      .select()
      .from(workspaces)
      .where(eq(workspaces.ownerId, userId))
      .limit(1);

    return created[0];
  }),

  /**
   * Update the workspace name.
   */
  update: protectedProcedure
    .input(
      z.object({
        name: z.string().min(1).max(100),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });

      const userId = ctx.user.id;

      const existing = await db
        .select({ id: workspaces.id })
        .from(workspaces)
        .where(eq(workspaces.ownerId, userId))
        .limit(1);

      if (existing.length === 0) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Workspace not found" });
      }

      await db
        .update(workspaces)
        .set({ name: input.name })
        .where(eq(workspaces.id, existing[0].id));

      return { success: true };
    }),
});
