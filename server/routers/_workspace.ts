/**
 * Shared helper: resolve or auto-create the workspace for the authenticated user.
 *
 * All engine routers use this instead of a local resolveWorkspaceId that throws
 * when no workspace exists yet. This matches the behaviour of workspace.mine —
 * the first call from any page creates the workspace transparently.
 */

import { asc, eq, isNull } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { getDb } from "../db";
import { workspaces, users } from "../../drizzle/schema";
import * as schema from "../../drizzle/schema";
import { protectedProcedure } from "../_core/trpc";
import { ENV } from "../_core/env";

/** In-flight creations per user, so parallel (batched) requests share one insert. */
const pending = new Map<number, Promise<number>>();

async function findWorkspace(userId: number): Promise<number | null> {
  const db = await getDb();
  if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });
  // Oldest first: if duplicates ever exist (multi-instance race), every request
  // still resolves to the same workspace.
  const rows = await db
    .select({ id: workspaces.id })
    .from(workspaces)
    .where(eq(workspaces.ownerId, userId))
    .orderBy(asc(workspaces.id))
    .limit(1);
  return rows[0]?.id ?? null;
}

export async function resolveOrCreateWorkspace(
  userId: number,
  userName?: string | null,
): Promise<number> {
  const existing = await findWorkspace(userId);
  if (existing !== null) return existing;

  // A tRPC batch fires several procedures at once; without this they each
  // created a workspace on first login.
  const inFlight = pending.get(userId);
  if (inFlight) return inFlight;

  const p = (async () => {
    const again = await findWorkspace(userId);
    if (again !== null) return again;
    const db = (await getDb())!;
    await db.insert(workspaces).values({
      ownerId: userId,
      name: userName ? `${userName}'s Workspace` : "My Workspace",
    });
    return (await findWorkspace(userId))!;
  })().finally(() => pending.delete(userId));

  pending.set(userId, p);
  return p;
}

// ─── Workspace-scoped procedure ───────────────────────────────────────────────


/** Legacy (pre-v1.1) tables that carry a nullable workspaceId since migration 0009. */
export const LEGACY_WORKSPACE_TABLES = [
  schema.adsAccounts,
  schema.campaigns,
  schema.adSets,
  schema.ads,
  schema.adInsights,
  schema.leads,
  schema.salesAgents,
  schema.salesActivities,
  schema.funnelBottlenecks,
  schema.recommendations,
  schema.dailySummaries,
  schema.dataConnections,
  schema.importJobs,
  schema.weeklyReports,
] as const;

const CLAIM_INTERVAL_MS = 10 * 60 * 1000;
let lastClaimAt = 0;

/**
 * Rows written before workspaces existed (or by the seed script) have
 * workspaceId = NULL. They belong to the app owner, so the first admin request
 * assigns them to the admin's workspace. Throttled; idempotent.
 */
export async function claimOrphanLegacyRows(workspaceId: number, force = false): Promise<void> {
  const now = Date.now();
  if (!force && now - lastClaimAt < CLAIM_INTERVAL_MS) return;
  lastClaimAt = now;
  const db = await getDb();
  if (!db) return;
  for (const table of LEGACY_WORKSPACE_TABLES) {
    await db.update(table).set({ workspaceId } as any).where(isNull(table.workspaceId));
  }
}

/** Workspace of the app owner (OWNER_OPEN_ID), for inbound data with no session (webhooks). */
export async function getOwnerWorkspaceId(): Promise<number | null> {
  if (!ENV.ownerOpenId) return null;
  const db = await getDb();
  if (!db) return null;
  const [owner] = await db
    .select({ id: users.id, name: users.name })
    .from(users)
    .where(eq(users.openId, ENV.ownerOpenId))
    .limit(1);
  if (!owner) return null;
  return resolveOrCreateWorkspace(owner.id, owner.name);
}

/**
 * protectedProcedure + ctx.workspaceId. Every legacy query must filter on it,
 * so one signed-in user can never read or change another workspace's data.
 */
export const workspaceProcedure = protectedProcedure.use(async ({ ctx, next }) => {
  // No DB: let the procedure run its own "database unavailable" fallback.
  // -1 never matches a real workspace, so nothing can leak.
  if (!(await getDb())) return next({ ctx: { ...ctx, workspaceId: -1 } });
  const workspaceId = await resolveOrCreateWorkspace(ctx.user.id, ctx.user.name);
  if (ctx.user.role === "admin") await claimOrphanLegacyRows(workspaceId);
  return next({ ctx: { ...ctx, workspaceId } });
});
