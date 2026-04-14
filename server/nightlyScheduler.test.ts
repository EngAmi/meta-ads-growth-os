/**
 * Unit tests for nightlyScheduler.ts
 *
 * Covers:
 *  1. resolveCronSchedule — valid / invalid / missing env var
 *  2. notifyFailure — calls notifyOwner with correct args; swallows notification errors
 *  3. runNightlyPipelines duplicate-run guard — skips workspace with recent run; proceeds when run is old
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { resolveCronSchedule, notifyFailure, runNightlyPipelines } from "./nightlyScheduler";

// ─── Module mocks ─────────────────────────────────────────────────────────────

vi.mock("./_core/notification", () => ({
  notifyOwner: vi.fn().mockResolvedValue(true),
}));

vi.mock("./db", () => ({
  getDb: vi.fn(),
}));

vi.mock("./engines/pipeline", () => ({
  runPipeline: vi.fn(),
}));

// ─── Helpers ──────────────────────────────────────────────────────────────────

const DEFAULT = "0 0 * * *";
const TWENTY_HOURS_MS = 20 * 60 * 60 * 1000;

// ─── 1. resolveCronSchedule ───────────────────────────────────────────────────

describe("resolveCronSchedule", () => {
  const originalEnv = process.env.CRON_SCHEDULE;

  beforeEach(() => { delete process.env.CRON_SCHEDULE; });

  afterEach(() => {
    if (originalEnv === undefined) delete process.env.CRON_SCHEDULE;
    else process.env.CRON_SCHEDULE = originalEnv;
  });

  it("returns the default when CRON_SCHEDULE is not set", () => {
    expect(resolveCronSchedule()).toBe(DEFAULT);
  });

  it("returns the default when CRON_SCHEDULE is an empty string", () => {
    process.env.CRON_SCHEDULE = "";
    expect(resolveCronSchedule()).toBe(DEFAULT);
  });

  it("returns the default when CRON_SCHEDULE is whitespace only", () => {
    process.env.CRON_SCHEDULE = "   ";
    expect(resolveCronSchedule()).toBe(DEFAULT);
  });

  it("returns a valid custom schedule", () => {
    process.env.CRON_SCHEDULE = "0 3 * * *";
    expect(resolveCronSchedule()).toBe("0 3 * * *");
  });

  it("returns a valid weekday-only schedule", () => {
    process.env.CRON_SCHEDULE = "0 0 * * 1-5";
    expect(resolveCronSchedule()).toBe("0 0 * * 1-5");
  });

  it("falls back to default and logs a warning when CRON_SCHEDULE is invalid", () => {
    process.env.CRON_SCHEDULE = "not-a-cron";
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    const result = resolveCronSchedule();

    expect(result).toBe(DEFAULT);
    expect(warnSpy).toHaveBeenCalledOnce();
    expect(warnSpy.mock.calls[0][0]).toContain("CRON_SCHEDULE");
    expect(warnSpy.mock.calls[0][0]).toContain("not-a-cron");
    expect(warnSpy.mock.calls[0][0]).toContain(DEFAULT);

    warnSpy.mockRestore();
  });

  it("falls back to default and logs a warning when CRON_SCHEDULE has wrong field count", () => {
    process.env.CRON_SCHEDULE = "0 0 * *"; // only 4 fields
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    expect(resolveCronSchedule()).toBe(DEFAULT);
    expect(warnSpy).toHaveBeenCalledOnce();

    warnSpy.mockRestore();
  });

  it("does NOT log a warning when CRON_SCHEDULE is valid", () => {
    process.env.CRON_SCHEDULE = "0 6 * * *";
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    resolveCronSchedule();
    expect(warnSpy).not.toHaveBeenCalled();
    warnSpy.mockRestore();
  });

  it("does NOT log a warning when CRON_SCHEDULE is missing", () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    resolveCronSchedule();
    expect(warnSpy).not.toHaveBeenCalled();
    warnSpy.mockRestore();
  });
});

// ─── 2. notifyFailure ─────────────────────────────────────────────────────────

describe("notifyFailure", () => {
  let notifyOwnerMock: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    const mod = await import("./_core/notification");
    notifyOwnerMock = mod.notifyOwner as ReturnType<typeof vi.fn>;
    notifyOwnerMock.mockReset();
    notifyOwnerMock.mockResolvedValue(true);
  });

  it("calls notifyOwner with workspaceId, runId, and summary when result.status === 'failed'", async () => {
    await notifyFailure({ workspaceId: 42, runId: "run-abc", summary: "step1: timeout" });

    expect(notifyOwnerMock).toHaveBeenCalledOnce();
    const call = notifyOwnerMock.mock.calls[0][0];
    expect(call.title).toContain("workspace 42");
    expect(call.content).toContain("workspace 42");
    expect(call.content).toContain("run-abc");
    expect(call.content).toContain("step1: timeout");
  });

  it("calls notifyOwner with workspaceId and summary (no runId) on unhandled exception path", async () => {
    await notifyFailure({ workspaceId: 7, summary: "unexpected crash" });

    expect(notifyOwnerMock).toHaveBeenCalledOnce();
    const call = notifyOwnerMock.mock.calls[0][0];
    expect(call.title).toContain("workspace 7");
    expect(call.content).toContain("workspace 7");
    expect(call.content).toContain("unexpected crash");
    // runId line must NOT appear when runId is omitted
    expect(call.content).not.toContain("Run ID:");
  });

  it("swallows notifyOwner errors and logs them without rethrowing", async () => {
    notifyOwnerMock.mockRejectedValueOnce(new Error("notification service down"));
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    // Must not throw
    await expect(
      notifyFailure({ workspaceId: 99, summary: "some failure" })
    ).resolves.toBeUndefined();

    expect(errorSpy).toHaveBeenCalledOnce();
    expect(errorSpy.mock.calls[0][0]).toContain("workspace=99");

    errorSpy.mockRestore();
  });
});

// ─── 3. Duplicate-run guard ───────────────────────────────────────────────────

describe("runNightlyPipelines — duplicate-run guard", () => {
  let getDbMock: ReturnType<typeof vi.fn>;
  let runPipelineMock: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    const dbMod = await import("./db");
    getDbMock = dbMod.getDb as ReturnType<typeof vi.fn>;
    getDbMock.mockReset();

    const pipeMod = await import("./engines/pipeline");
    runPipelineMock = pipeMod.runPipeline as ReturnType<typeof vi.fn>;
    runPipelineMock.mockReset();
    runPipelineMock.mockResolvedValue({
      status: "completed",
      runId: "run-1",
      stepsCompleted: 6,
      durationMs: 1000,
      stepErrors: {},
    });
  });

  /** Build a minimal Drizzle-like db mock with configurable query results. */
  function buildDbMock({
    activeWorkspaceIds,
    recentRunWorkspaceIds,
  }: {
    activeWorkspaceIds: number[];
    recentRunWorkspaceIds: number[];
  }) {
    // Each .select().from().where() chain returns the configured rows.
    // Call order:
    //   1 → manageExpiringTokens: expiring integrations (always [] in unit tests)
    //   2 → active integrations query
    //   3 → recent runs query
    // The delete chain (OAuth session cleanup) is handled separately.
    let callCount = 0;
    const queryChain = {
      select: vi.fn().mockReturnThis(),
      from: vi.fn().mockReturnThis(),
      where: vi.fn().mockImplementation(() => {
        callCount++;
        if (callCount === 1) {
          // manageExpiringTokens: no expiring tokens in unit tests
          return Promise.resolve([]);
        }
        if (callCount === 2) {
          // active integrations query
          return Promise.resolve(activeWorkspaceIds.map(id => ({ workspaceId: id })));
        }
        // callCount >= 3: recent runs query (and any subsequent cleanup queries)
        return Promise.resolve(recentRunWorkspaceIds.map(id => ({ workspaceId: id })));
      }),
      // delete chain for OAuth session cleanup — returns affectedRows: 0
      delete: vi.fn().mockReturnThis(),
    };
    return queryChain;
  }

  it("skips a workspace that has a successful run within the last 20 hours", async () => {
    const db = buildDbMock({
      activeWorkspaceIds: [1],
      recentRunWorkspaceIds: [1], // workspace 1 already ran recently
    });
    getDbMock.mockResolvedValue(db);

    await runNightlyPipelines();

    expect(runPipelineMock).not.toHaveBeenCalled();
  });

  it("runs the pipeline for a workspace whose last successful run is older than 20 hours", async () => {
    const db = buildDbMock({
      activeWorkspaceIds: [2],
      recentRunWorkspaceIds: [], // no recent run for workspace 2
    });
    getDbMock.mockResolvedValue(db);

    await runNightlyPipelines();

    expect(runPipelineMock).toHaveBeenCalledOnce();
    expect(runPipelineMock.mock.calls[0][0]).toMatchObject({
      workspaceId: 2,
      trigger: "cron",
    });
  });

  it("runs only the workspace without a recent run when one workspace has a recent run and another does not", async () => {
    const db = buildDbMock({
      activeWorkspaceIds: [10, 20],
      recentRunWorkspaceIds: [10], // workspace 10 already ran, workspace 20 has not
    });
    getDbMock.mockResolvedValue(db);

    await runNightlyPipelines();

    expect(runPipelineMock).toHaveBeenCalledOnce();
    expect(runPipelineMock.mock.calls[0][0]).toMatchObject({
      workspaceId: 20,
      trigger: "cron",
    });
  });

  it("does nothing when there are no active integrations", async () => {
    const db = buildDbMock({
      activeWorkspaceIds: [],
      recentRunWorkspaceIds: [],
    });
    getDbMock.mockResolvedValue(db);

    await runNightlyPipelines();

    expect(runPipelineMock).not.toHaveBeenCalled();
  });

  it("aborts early when the database is unavailable", async () => {
    getDbMock.mockResolvedValue(null);

    await runNightlyPipelines();

    expect(runPipelineMock).not.toHaveBeenCalled();
  });
});
