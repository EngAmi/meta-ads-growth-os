/**
 * Unit tests for resolveCronSchedule()
 *
 * Covers:
 *  - valid CRON_SCHEDULE env var → used as-is
 *  - invalid CRON_SCHEDULE env var → falls back to default + logs a warning
 *  - missing CRON_SCHEDULE env var → falls back to default silently
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { resolveCronSchedule } from "./nightlyScheduler";

const DEFAULT = "0 0 * * *";

describe("resolveCronSchedule", () => {
  const originalEnv = process.env.CRON_SCHEDULE;

  beforeEach(() => {
    // Ensure a clean slate before each test
    delete process.env.CRON_SCHEDULE;
  });

  afterEach(() => {
    // Restore original env value after each test
    if (originalEnv === undefined) {
      delete process.env.CRON_SCHEDULE;
    } else {
      process.env.CRON_SCHEDULE = originalEnv;
    }
  });

  it("returns the default schedule when CRON_SCHEDULE is not set", () => {
    expect(resolveCronSchedule()).toBe(DEFAULT);
  });

  it("returns the default schedule when CRON_SCHEDULE is an empty string", () => {
    process.env.CRON_SCHEDULE = "";
    expect(resolveCronSchedule()).toBe(DEFAULT);
  });

  it("returns the default schedule when CRON_SCHEDULE is whitespace only", () => {
    process.env.CRON_SCHEDULE = "   ";
    expect(resolveCronSchedule()).toBe(DEFAULT);
  });

  it("returns a valid custom schedule when CRON_SCHEDULE is a valid cron expression", () => {
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

    const result = resolveCronSchedule();

    expect(result).toBe(DEFAULT);
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
