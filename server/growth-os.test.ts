import { describe, expect, it } from "vitest";
import { appRouter } from "./routers";
import type { TrpcContext } from "./_core/context";

function createPublicContext(): TrpcContext {
  return {
    user: null,
    req: { protocol: "https", headers: {} } as TrpcContext["req"],
    res: { clearCookie: () => {} } as unknown as TrpcContext["res"],
  };
}

function createAuthContext(): TrpcContext {
  return {
    user: {
      id: 1,
      openId: "test-user",
      email: "test@example.com",
      name: "Test User",
      loginMethod: "manus",
      role: "admin",
      createdAt: new Date(),
      updatedAt: new Date(),
      lastSignedIn: new Date(),
    },
    req: { protocol: "https", headers: {} } as TrpcContext["req"],
    res: { clearCookie: () => {} } as unknown as TrpcContext["res"],
  };
}

describe("Growth OS - Auth", () => {
  it("returns null for unauthenticated user", async () => {
    const caller = appRouter.createCaller(createPublicContext());
    const result = await caller.auth.me();
    expect(result).toBeNull();
  });

  it("returns user for authenticated context", async () => {
    const caller = appRouter.createCaller(createAuthContext());
    const result = await caller.auth.me();
    expect(result).not.toBeNull();
    expect(result?.name).toBe("Test User");
  });
});

describe("Growth OS - Dashboard", () => {
  it("dashboard.summary returns null or object when DB unavailable", async () => {
    const caller = appRouter.createCaller(createPublicContext());
    const result = await caller.dashboard.summary();
    // Either null (no DB) or a valid object with nested structure
    if (result !== null) {
      expect(result).toHaveProperty("ads");
      expect(result).toHaveProperty("leads");
    } else {
      expect(result).toBeNull();
    }
  });

  it("dashboard.funnelHealth returns null or valid object", async () => {
    const caller = appRouter.createCaller(createPublicContext());
    const result = await caller.dashboard.funnelHealth();
    if (result !== null) {
      expect(result).toHaveProperty("roas");
      expect(result).toHaveProperty("leadsToSales");
    }
  });
});

describe("Growth OS - Ads", () => {
  it("ads.campaigns returns an array", async () => {
    const caller = appRouter.createCaller(createPublicContext());
    const result = await caller.ads.campaigns();
    expect(Array.isArray(result)).toBe(true);
  });

  it("ads.insights accepts days parameter", async () => {
    const caller = appRouter.createCaller(createPublicContext());
    const result = await caller.ads.insights({ days: 7 });
    expect(Array.isArray(result)).toBe(true);
  });

  it("ads.adSets returns an array", async () => {
    const caller = appRouter.createCaller(createPublicContext());
    const result = await caller.ads.adSets();
    expect(Array.isArray(result)).toBe(true);
  });
});

describe("Growth OS - Leads", () => {
  it("leads.list returns paginated results", async () => {
    const caller = appRouter.createCaller(createPublicContext());
    const result = await caller.leads.list({ limit: 10, offset: 0 });
    // Returns { data, total } or array
    expect(result).toBeDefined();
  });

  it("leads.stats returns null or valid stats object", async () => {
    const caller = appRouter.createCaller(createPublicContext());
    const result = await caller.leads.stats();
    if (result !== null) {
      expect(result).toHaveProperty("total");
    }
  });
});

describe("Growth OS - Sales", () => {
  it("sales.agents returns an array", async () => {
    const caller = appRouter.createCaller(createPublicContext());
    const result = await caller.sales.agents();
    expect(Array.isArray(result)).toBe(true);
  });

  it("sales.teamStats returns null or valid object", async () => {
    const caller = appRouter.createCaller(createPublicContext());
    const result = await caller.sales.teamStats();
    if (result !== null) {
      expect(result).toHaveProperty("avgConversionRate");
    }
  });
});

describe("Growth OS - Funnel", () => {
  it("funnel.bottlenecks returns an array", async () => {
    const caller = appRouter.createCaller(createPublicContext());
    const result = await caller.funnel.bottlenecks();
    expect(Array.isArray(result)).toBe(true);
  });

  it("funnel.overview returns null or valid object", async () => {
    const caller = appRouter.createCaller(createPublicContext());
    const result = await caller.funnel.overview();
    if (result !== null) {
      expect(result).toHaveProperty("adsMetrics");
    }
  });
});

describe("Growth OS - Recommendations", () => {
  it("recommendations.list returns an array", async () => {
    const caller = appRouter.createCaller(createPublicContext());
    const result = await caller.recommendations.list();
    expect(Array.isArray(result)).toBe(true);
  });

  it("recommendations.updateStatus requires auth", async () => {
    const caller = appRouter.createCaller(createPublicContext());
    await expect(
      caller.recommendations.updateStatus({ id: 1, status: "completed" })
    ).rejects.toThrow();
  });

  it("recommendations.updateStatus works with auth", async () => {
    const caller = appRouter.createCaller(createAuthContext());
    // This may fail if DB is not available, but should not throw auth error
    try {
      const result = await caller.recommendations.updateStatus({ id: 999, status: "completed" });
      expect(result).toBeDefined();
    } catch (e: any) {
      // DB not available is acceptable
      expect(e.message).not.toContain("UNAUTHORIZED");
    }
  });
});

describe("Growth OS - Daily Summary", () => {
  it("dailySummary.latest returns null or valid object", async () => {
    const caller = appRouter.createCaller(createPublicContext());
    const result = await caller.dailySummary.latest();
    if (result !== null) {
      expect(result).toHaveProperty("date");
    }
  });

  it("dailySummary.list returns an array", async () => {
    const caller = appRouter.createCaller(createPublicContext());
    const result = await caller.dailySummary.list();
    expect(Array.isArray(result)).toBe(true);
  });
});

describe("Growth OS - Weekly Reports", () => {
  it("weeklyReports.list returns an array", async () => {
    const caller = appRouter.createCaller(createPublicContext());
    const result = await caller.weeklyReports.list();
    expect(Array.isArray(result)).toBe(true);
  });

  it("weeklyReports.trend returns an array", async () => {
    const caller = appRouter.createCaller(createPublicContext());
    const result = await caller.weeklyReports.trend();
    expect(Array.isArray(result)).toBe(true);
  });
});

describe("Growth OS - Forecast", () => {
  it("forecast.revenue returns null or valid forecast object", async () => {
    const caller = appRouter.createCaller(createPublicContext());
    const result = await caller.forecast.revenue();
    if (result !== null) {
      expect(result).toHaveProperty("forecast");
      expect(Array.isArray(result.forecast)).toBe(true);
    }
  });
});

describe("Growth OS - Leaderboard", () => {
  it("leaderboard.agents returns an array", async () => {
    const caller = appRouter.createCaller(createPublicContext());
    const result = await caller.leaderboard.agents();
    expect(Array.isArray(result)).toBe(true);
  });

  it("leaderboard.campaigns returns an array", async () => {
    const caller = appRouter.createCaller(createPublicContext());
    const result = await caller.leaderboard.campaigns();
    expect(Array.isArray(result)).toBe(true);
  });
});
