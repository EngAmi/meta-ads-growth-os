/**
 * Shared helper: resolve or auto-create the workspace for the authenticated user.
 *
 * All engine routers use this instead of a local resolveWorkspaceId that throws
 * when no workspace exists yet. This matches the behaviour of workspace.mine —
 * the first call from any page creates the workspace transparently.
 */

import { eq } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { getDb } from "../db";
import { workspaces } from "../../drizzle/schema";

export async function resolveOrCreateWorkspace(
  userId: number,
  userName?: string | null,
): Promise<number> {
  const db = await getDb();
  if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });

  const existing = await db
    .select({ id: workspaces.id })
    .from(workspaces)
    .where(eq(workspaces.ownerId, userId))
    .limit(1);

  if (existing.length > 0) return existing[0].id;

  // Auto-create on first access from any engine router
  await db.insert(workspaces).values({
    ownerId: userId,
    name: userName ? `${userName}'s Workspace` : "My Workspace",
  });

  const created = await db
    .select({ id: workspaces.id })
    .from(workspaces)
    .where(eq(workspaces.ownerId, userId))
    .limit(1);

  return created[0].id;
}
