/**
 * Integration test: legacy data is isolated per workspace.
 *
 * Runs only when TEST_DATABASE_URL points at a disposable MySQL/MariaDB
 * database with migrations applied (`pnpm db:push`). Skipped otherwise.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { TrpcContext } from "./_core/context";

const TEST_DB = process.env.TEST_DATABASE_URL;
const suite = TEST_DB ? describe : describe.skip;

suite("Legacy workspace isolation (integration)", () => {
  let appRouter: typeof import("./routers").appRouter;
  let db: NonNullable<Awaited<ReturnType<typeof import("./db").getDb>>>;
  let schema: typeof import("../drizzle/schema");
  let drizzle: typeof import("drizzle-orm");
  let ctxA: TrpcContext;
  let ctxB: TrpcContext;
  const tag = `iso_${Date.now()}`;

  const makeCtx = (id: number, openId: string, role: "user" | "admin"): TrpcContext => ({
    user: {
      id,
      openId,
      email: `${openId}@example.com`,
      name: openId,
      loginMethod: "test",
      role,
      createdAt: new Date(),
      updatedAt: new Date(),
      lastSignedIn: new Date(),
    },
    req: { protocol: "https", headers: {} } as TrpcContext["req"],
    res: { clearCookie: () => {} } as unknown as TrpcContext["res"],
  });

  beforeAll(async () => {
    process.env.DATABASE_URL = TEST_DB;
    ({ appRouter } = await import("./routers"));
    const { getDb } = await import("./db");
    schema = await import("../drizzle/schema");
    drizzle = await import("drizzle-orm");
    db = (await getDb())!;

    for (const openId of [`${tag}_a`, `${tag}_b`]) {
      await db.insert(schema.users).values({ openId, name: openId, role: "user" });
    }
    const users = await db
      .select()
      .from(schema.users)
      .where(drizzle.like(schema.users.openId, `${tag}%`));
    const a = users.find((u) => u.openId.endsWith("_a"))!;
    const b = users.find((u) => u.openId.endsWith("_b"))!;
    ctxA = makeCtx(a.id, a.openId, "user");
    ctxB = makeCtx(b.id, b.openId, "user");

    // User A creates data through the API (workspace auto-created).
    const callerA = appRouter.createCaller(ctxA);
    await callerA.dataSources.saveConnection({
      name: `${tag} conn`,
      accessToken: "EAA-secret-token-A",
      adAccountId: "act_111",
      syncDays: 30,
    });
    const { resolveOrCreateWorkspace } = await import("./routers/_workspace");
    const wsA = await resolveOrCreateWorkspace(a.id, a.name);
    await db.insert(schema.leads).values({
      workspaceId: wsA,
      source: "meta_ads",
      name: `${tag} lead`,
      phone: "+200000000000",
      status: "new",
    } as any);
    await db.insert(schema.recommendations).values({
      workspaceId: wsA,
      category: "ads",
      priority: "high",
      title: `${tag} rec`,
      problem: "p",
      reason: "r",
      action: "a",
    } as any);
  });

  afterAll(async () => {
    if (!db) return;
    const { like, inArray } = drizzle;
    const users = await db.select().from(schema.users).where(like(schema.users.openId, `${tag}%`));
    const ids = users.map((u) => u.id);
    if (ids.length) {
      const wss = await db.select().from(schema.workspaces).where(inArray(schema.workspaces.ownerId, ids));
      const wsIds = wss.map((w) => w.id);
      if (wsIds.length) {
        await db.delete(schema.dataConnections).where(inArray(schema.dataConnections.workspaceId, wsIds));
        await db.delete(schema.leads).where(inArray(schema.leads.workspaceId, wsIds));
        await db.delete(schema.recommendations).where(inArray(schema.recommendations.workspaceId, wsIds));
        await db.delete(schema.workspaces).where(inArray(schema.workspaces.id, wsIds));
      }
      await db.delete(schema.users).where(inArray(schema.users.id, ids));
    }
  });

  it("owner sees their own connection (without the token)", async () => {
    const rows = await appRouter.createCaller(ctxA).dataSources.listConnections();
    const mine = rows.find((r) => r.name === `${tag} conn`);
    expect(mine).toBeDefined();
    expect(mine).not.toHaveProperty("accessToken");
  });

  it("another user cannot see workspace A's connections, leads or recommendations", async () => {
    const callerB = appRouter.createCaller(ctxB);
    const conns = await callerB.dataSources.listConnections();
    expect(conns.some((r) => r.name === `${tag} conn`)).toBe(false);

    const leads = await callerB.leads.list({ limit: 500, offset: 0 });
    expect(leads.data.some((l: any) => l.name === `${tag} lead`)).toBe(false);

    const recs = await callerB.recommendations.list();
    expect(recs.some((r: any) => r.title === `${tag} rec`)).toBe(false);
  });

  it("another user cannot modify or delete workspace A's rows by id", async () => {
    const callerA = appRouter.createCaller(ctxA);
    const callerB = appRouter.createCaller(ctxB);
    const conn = (await callerA.dataSources.listConnections()).find((r) => r.name === `${tag} conn`)!;
    const rec = (await callerA.recommendations.list()).find((r: any) => r.title === `${tag} rec`)!;

    await callerB.dataSources.deleteConnection({ id: conn.id });
    await callerB.recommendations.updateStatus({ id: rec.id, status: "dismissed" });
    await expect(callerB.dataSources.syncConnection({ connectionId: conn.id })).rejects.toThrow(
      /not found/i,
    );

    expect((await callerA.dataSources.listConnections()).some((r) => r.id === conn.id)).toBe(true);
    const recAfter = (await callerA.recommendations.list()).find((r: any) => r.id === rec.id);
    expect(recAfter?.status).toBe("pending");
  });
});
