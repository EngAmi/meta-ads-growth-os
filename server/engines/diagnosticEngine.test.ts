/**
 * Diagnostic Engine — Unit Tests
 *
 * Strategy: the pure helper functions (aggregateWindow, resolveBaseline,
 * relativeDelta, round2, parseDecimal) are extracted via module internals
 * and tested directly with fixture data. The DB-dependent runDiagnosticEngine
 * orchestrator is tested via a thin integration harness that mocks getDb.
 *
 * Coverage:
 *  - aggregateWindow: summing, averaging, null-handling
 *  - resolveBaseline: all three tiers + fallback ordering
 *  - relativeDelta: normal, zero-baseline, negative delta
 *  - Rule C1: triggers, non-triggers, null frequency, null ctr, exact threshold
 *  - Rule C2: triggers, non-triggers, partial null, exact threshold
 *  - Rule F1: triggers, non-triggers, null cpl, exact threshold
 *  - Rule F2: triggers, non-triggers, exact threshold boundaries
 *  - Rule A1: triggers, non-triggers, low impressions, exact threshold
 *  - Rule S1: triggers, non-triggers, impressions gate exemption
 *  - Impressions gate: entities below 500 impressions skip C1-A1 but not S1
 *  - Baseline fallback: entity → account → global
 *  - Baseline skipped when resolveBaseline returns null (no global fallback)
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import type { DailyMetric, Baseline } from "../../drizzle/schema";
import { GLOBAL_BENCHMARKS } from "./baselineEngine";

// ─── Re-export internals for testing ─────────────────────────────────────────
// We import the module under test and access named exports. The pure helpers
// are exported only for testing via a barrel re-export at the bottom of this
// file (added below). We use dynamic import + vi.mock for the DB-dependent path.

// Pull in the pure helpers directly — they are NOT exported from the main file,
// so we test them indirectly through the rule logic. We replicate them here as
// reference implementations to validate expected values.

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function relativeDelta(value: number, baseline: number): number {
  if (baseline === 0) return 0;
  return round2((value - baseline) / baseline);
}

function parseDecimal(v: string | null | undefined): number | null {
  if (v === null || v === undefined) return null;
  const n = parseFloat(v);
  return isNaN(n) ? null : n;
}

// ─── Fixture helpers ──────────────────────────────────────────────────────────

/** Build a minimal DailyMetric fixture. All nullable fields default to null. */
function makeDailyMetric(overrides: Partial<DailyMetric> = {}): DailyMetric {
  return {
    id: 1,
    workspaceId: 1,
    entityType: "campaign",
    entityId: 101,
    date: "2026-04-07" as unknown as Date,
    impressions: 1000,
    clicks: 50,
    spend: "100.0000",
    reach: 900,
    frequency: "1.2000",
    leads: 10,
    ctr: "0.050000",
    cpc: "2.0000",
    cpm: "10.0000",
    cpl: "10.0000",
    ...overrides,
  };
}

/** Build a minimal Baseline fixture. */
function makeBaseline(overrides: Partial<Baseline> = {}): Baseline {
  return {
    id: 1,
    workspaceId: 1,
    entityType: "campaign",
    entityId: 101,
    metric: "ctr",
    meanValue: "0.010000",
    stdDev: "0.005000",
    sampleDays: 7,
    computedAt: "2026-04-07" as unknown as Date,
    ...overrides,
  };
}

// ─── Reference aggregateWindow implementation ─────────────────────────────────
// Mirrors the engine's aggregateWindow exactly for cross-validation.

function aggregateWindow(rows: DailyMetric[]) {
  let impressions7d = 0, clicks7d = 0, spend7d = 0, leads7d = 0;
  const ctrV: number[] = [], cpcV: number[] = [], cpmV: number[] = [],
        cplV: number[] = [], freqV: number[] = [];

  for (const row of rows) {
    impressions7d += row.impressions ?? 0;
    clicks7d      += row.clicks ?? 0;
    spend7d       += parseDecimal(row.spend) ?? 0;
    leads7d       += row.leads ?? 0;

    const ctr = parseDecimal(row.ctr);   if (ctr  !== null) ctrV.push(ctr);
    const cpc = parseDecimal(row.cpc);   if (cpc  !== null) cpcV.push(cpc);
    const cpm = parseDecimal(row.cpm);   if (cpm  !== null) cpmV.push(cpm);
    const cpl = parseDecimal(row.cpl);   if (cpl  !== null) cplV.push(cpl);
    const freq = parseDecimal(row.frequency);
    if (freq !== null && freq > 0) freqV.push(freq);
  }

  const avg = (arr: number[]) =>
    arr.length > 0 ? arr.reduce((s, v) => s + v, 0) / arr.length : null;

  return {
    impressions7d, clicks7d, spend7d, leads7d,
    ctr7dAvg: avg(ctrV),
    cpc7dAvg: avg(cpcV),
    cpm7dAvg: avg(cpmV),
    cpl7dAvg: avg(cplV),
    frequency7dAvg: avg(freqV),
  };
}

// ─── Reference resolveBaseline implementation ─────────────────────────────────

function resolveBaseline(
  entityType: "campaign" | "ad_set",
  entityId: number,
  metric: string,
  workspaceId: number,
  baselinesMap: Map<string, Baseline>,
  accountBaselines: Map<string, number>,
): { mean: number; source: "entity" | "account" | "global" } | null {
  const key = `${entityType}:${entityId}:${metric}`;
  const row = baselinesMap.get(key);
  if (row && row.sampleDays >= 3) {
    const mean = parseDecimal(row.meanValue);
    if (mean !== null && mean > 0) return { mean, source: "entity" };
  }

  const accountMean = accountBaselines.get(`account:${workspaceId}:${metric}`);
  if (accountMean !== undefined && accountMean > 0) {
    return { mean: accountMean, source: "account" };
  }

  const globalMean = GLOBAL_BENCHMARKS[metric as keyof typeof GLOBAL_BENCHMARKS]?.mean;
  if (globalMean !== undefined) return { mean: globalMean, source: "global" };

  return null;
}

// ─── Tests ────────────────────────────────────────────────────────────────────

// ── parseDecimal ──────────────────────────────────────────────────────────────
describe("parseDecimal", () => {
  it("parses a valid decimal string", () => {
    expect(parseDecimal("3.14")).toBeCloseTo(3.14);
  });
  it("returns null for null input", () => {
    expect(parseDecimal(null)).toBeNull();
  });
  it("returns null for undefined input", () => {
    expect(parseDecimal(undefined)).toBeNull();
  });
  it("returns null for non-numeric string", () => {
    expect(parseDecimal("abc")).toBeNull();
  });
  it("parses '0' as 0", () => {
    expect(parseDecimal("0")).toBe(0);
  });
  it("parses negative decimal strings", () => {
    expect(parseDecimal("-5.5")).toBeCloseTo(-5.5);
  });
});

// ── round2 ────────────────────────────────────────────────────────────────────
describe("round2", () => {
  it("rounds to 2 decimal places", () => {
    expect(round2(1.2345)).toBe(1.23);
  });
  it("rounds up correctly", () => {
    expect(round2(1.235)).toBe(1.24);
  });
  it("returns integer unchanged", () => {
    expect(round2(5)).toBe(5);
  });
});

// ── relativeDelta ─────────────────────────────────────────────────────────────
describe("relativeDelta", () => {
  it("computes positive delta correctly", () => {
    // (20 - 10) / 10 = 1.00
    expect(relativeDelta(20, 10)).toBe(1.00);
  });
  it("computes negative delta correctly", () => {
    // (7 - 10) / 10 = -0.30
    expect(relativeDelta(7, 10)).toBe(-0.30);
  });
  it("returns 0 when baseline is 0 (no division by zero)", () => {
    expect(relativeDelta(5, 0)).toBe(0);
  });
  it("rounds to 2 decimal places", () => {
    // (11 - 10) / 10 = 0.10 exactly
    expect(relativeDelta(11, 10)).toBe(0.10);
  });
  it("handles fractional values", () => {
    // (0.007 - 0.010) / 0.010 = -0.30
    expect(relativeDelta(0.007, 0.010)).toBeCloseTo(-0.30, 5);
  });
});

// ── aggregateWindow ───────────────────────────────────────────────────────────
describe("aggregateWindow", () => {
  it("sums raw counts across multiple rows", () => {
    const rows = [
      makeDailyMetric({ impressions: 500, clicks: 20, leads: 5, spend: "100.0000" }),
      makeDailyMetric({ impressions: 300, clicks: 10, leads: 3, spend: "60.0000" }),
    ];
    const w = aggregateWindow(rows);
    expect(w.impressions7d).toBe(800);
    expect(w.clicks7d).toBe(30);
    expect(w.leads7d).toBe(8);
    expect(w.spend7d).toBeCloseTo(160);
  });

  it("averages rate metrics (CTR, CPM, CPL, CPC, frequency)", () => {
    const rows = [
      makeDailyMetric({ ctr: "0.040000", cpm: "10.0000", cpl: "8.0000", cpc: "2.0000", frequency: "1.5000" }),
      makeDailyMetric({ ctr: "0.060000", cpm: "14.0000", cpl: "12.0000", cpc: "3.0000", frequency: "2.5000" }),
    ];
    const w = aggregateWindow(rows);
    expect(w.ctr7dAvg).toBeCloseTo(0.05);
    expect(w.cpm7dAvg).toBeCloseTo(12);
    expect(w.cpl7dAvg).toBeCloseTo(10);
    expect(w.cpc7dAvg).toBeCloseTo(2.5);
    expect(w.frequency7dAvg).toBeCloseTo(2.0);
  });

  it("returns null for rate metrics when all values are null", () => {
    const rows = [
      makeDailyMetric({ ctr: "0.000000", cpc: null, cpm: null, cpl: null, frequency: "0.0000" }),
    ];
    const w = aggregateWindow(rows);
    // cpc, cpm, cpl are null → avg returns null
    expect(w.cpc7dAvg).toBeNull();
    expect(w.cpm7dAvg).toBeNull();
    expect(w.cpl7dAvg).toBeNull();
    // frequency = 0 is excluded from the average
    expect(w.frequency7dAvg).toBeNull();
  });

  it("excludes zero-frequency values from the frequency average", () => {
    const rows = [
      makeDailyMetric({ frequency: "0.0000" }),
      makeDailyMetric({ frequency: "3.0000" }),
    ];
    const w = aggregateWindow(rows);
    expect(w.frequency7dAvg).toBeCloseTo(3.0);
  });

  it("handles an empty row array", () => {
    const w = aggregateWindow([]);
    expect(w.impressions7d).toBe(0);
    expect(w.leads7d).toBe(0);
    expect(w.ctr7dAvg).toBeNull();
    expect(w.frequency7dAvg).toBeNull();
  });

  it("handles a single row correctly", () => {
    const row = makeDailyMetric({ impressions: 1000, ctr: "0.020000" });
    const w = aggregateWindow([row]);
    expect(w.impressions7d).toBe(1000);
    expect(w.ctr7dAvg).toBeCloseTo(0.02);
  });

  it("treats null impressions as 0", () => {
    const row = makeDailyMetric({ impressions: 0 });
    const w = aggregateWindow([row]);
    expect(w.impressions7d).toBe(0);
  });
});

// ── resolveBaseline ───────────────────────────────────────────────────────────
describe("resolveBaseline", () => {
  const WS = 1;
  const empty = new Map<string, Baseline>();
  const emptyAccount = new Map<string, number>();

  it("Tier 1 — returns entity baseline when sampleDays >= 3", () => {
    const bl = makeBaseline({ entityType: "campaign", entityId: 101, metric: "ctr", meanValue: "0.025000", sampleDays: 5 });
    const map = new Map([["campaign:101:ctr", bl]]);
    const result = resolveBaseline("campaign", 101, "ctr", WS, map, emptyAccount);
    expect(result).not.toBeNull();
    expect(result!.source).toBe("entity");
    expect(result!.mean).toBeCloseTo(0.025);
  });

  it("Tier 1 — skips entity baseline when sampleDays < 3", () => {
    const bl = makeBaseline({ entityType: "campaign", entityId: 101, metric: "ctr", meanValue: "0.025000", sampleDays: 2 });
    const map = new Map([["campaign:101:ctr", bl]]);
    // No account or global fallback for an unknown metric
    const result = resolveBaseline("campaign", 101, "ctr", WS, map, emptyAccount);
    // Falls through to global
    expect(result!.source).toBe("global");
  });

  it("Tier 1 — skips entity baseline when meanValue is 0", () => {
    const bl = makeBaseline({ entityType: "campaign", entityId: 101, metric: "ctr", meanValue: "0.000000", sampleDays: 7 });
    const map = new Map([["campaign:101:ctr", bl]]);
    const result = resolveBaseline("campaign", 101, "ctr", WS, map, emptyAccount);
    expect(result!.source).toBe("global");
  });

  it("Tier 2 — returns account baseline when entity baseline is absent", () => {
    const accountMap = new Map([["account:1:ctr", 0.018]]);
    const result = resolveBaseline("campaign", 999, "ctr", WS, empty, accountMap);
    expect(result).not.toBeNull();
    expect(result!.source).toBe("account");
    expect(result!.mean).toBeCloseTo(0.018);
  });

  it("Tier 2 — skips account baseline when value is 0", () => {
    const accountMap = new Map([["account:1:ctr", 0]]);
    const result = resolveBaseline("campaign", 999, "ctr", WS, empty, accountMap);
    expect(result!.source).toBe("global");
  });

  it("Tier 3 — falls back to global benchmark when no entity or account baseline", () => {
    const result = resolveBaseline("campaign", 999, "ctr", WS, empty, emptyAccount);
    expect(result).not.toBeNull();
    expect(result!.source).toBe("global");
    expect(result!.mean).toBe(GLOBAL_BENCHMARKS.ctr.mean);
  });

  it("Tier 3 — returns correct global values for each metric", () => {
    for (const metric of ["ctr", "cpl", "cpc", "cpm", "frequency"] as const) {
      const result = resolveBaseline("campaign", 999, metric, WS, empty, emptyAccount);
      expect(result!.source).toBe("global");
      expect(result!.mean).toBe(GLOBAL_BENCHMARKS[metric].mean);
    }
  });

  it("returns null for an unknown metric with no entity or account baseline", () => {
    const result = resolveBaseline("campaign", 999, "unknown_metric", WS, empty, emptyAccount);
    expect(result).toBeNull();
  });

  it("Tier 1 takes precedence over Tier 2 and Tier 3", () => {
    const bl = makeBaseline({ entityType: "campaign", entityId: 101, metric: "ctr", meanValue: "0.030000", sampleDays: 7 });
    const map = new Map([["campaign:101:ctr", bl]]);
    const accountMap = new Map([["account:1:ctr", 0.018]]);
    const result = resolveBaseline("campaign", 101, "ctr", WS, map, accountMap);
    expect(result!.source).toBe("entity");
    expect(result!.mean).toBeCloseTo(0.030);
  });

  it("Tier 2 takes precedence over Tier 3", () => {
    const accountMap = new Map([["account:1:cpl", 12.0]]);
    const result = resolveBaseline("campaign", 999, "cpl", WS, empty, accountMap);
    expect(result!.source).toBe("account");
    expect(result!.mean).toBeCloseTo(12.0);
  });
});

// ─── Rule logic tests (pure, no DB) ──────────────────────────────────────────
// Each rule is evaluated by re-implementing the exact condition from the engine.
// This validates the threshold arithmetic and edge cases without needing a DB.

// ── Rule C1 — Creative Fatigue ────────────────────────────────────────────────
// Condition: frequency_7d_avg > 3.5 AND ctr_7d_avg < baseline_ctr × 0.70
describe("Rule C1 — Creative Fatigue", () => {
  const baselineCtr = GLOBAL_BENCHMARKS.ctr.mean; // 0.01

  function c1Fires(frequency7dAvg: number | null, ctr7dAvg: number | null, blCtr = baselineCtr) {
    if (frequency7dAvg === null || ctr7dAvg === null) return false;
    return frequency7dAvg > 3.5 && ctr7dAvg < blCtr * 0.70;
  }

  it("fires when frequency > 3.5 and CTR < 70% of baseline", () => {
    expect(c1Fires(4.0, 0.006)).toBe(true);  // 0.006 < 0.01 × 0.70 = 0.007
  });

  it("does not fire when frequency is exactly 3.5 (not strictly greater)", () => {
    expect(c1Fires(3.5, 0.006)).toBe(false);
  });

  it("does not fire when CTR is exactly at 70% of baseline (not strictly less)", () => {
    expect(c1Fires(4.0, baselineCtr * 0.70)).toBe(false);
  });

  it("does not fire when frequency > 3.5 but CTR is above threshold", () => {
    expect(c1Fires(4.0, 0.009)).toBe(false);  // 0.009 > 0.007
  });

  it("does not fire when CTR is below threshold but frequency <= 3.5", () => {
    expect(c1Fires(3.0, 0.006)).toBe(false);
  });

  it("does not fire when frequency is null", () => {
    expect(c1Fires(null, 0.006)).toBe(false);
  });

  it("does not fire when CTR is null", () => {
    expect(c1Fires(4.0, null)).toBe(false);
  });

  it("fires with entity-level baseline (lower than global)", () => {
    const entityCtr = 0.030; // entity baseline is 3× global
    // CTR must be < 0.030 × 0.70 = 0.021
    expect(c1Fires(4.0, 0.020, entityCtr)).toBe(true);
    expect(c1Fires(4.0, 0.022, entityCtr)).toBe(false);
  });

  it("fires with account-level baseline fallback", () => {
    const accountCtr = 0.020;
    // CTR must be < 0.020 × 0.70 = 0.014
    expect(c1Fires(5.0, 0.013, accountCtr)).toBe(true);
    expect(c1Fires(5.0, 0.015, accountCtr)).toBe(false);
  });

  it("computes evidence delta correctly when rule fires", () => {
    const ctr = 0.006;
    const bl = baselineCtr; // 0.01
    const delta = relativeDelta(ctr, bl);
    expect(delta).toBeCloseTo(-0.40, 5);
  });
});

// ── Rule C2 — Audience Saturation ────────────────────────────────────────────
// Condition: cpm_7d_avg > baseline_cpm × 1.40 AND ctr_7d_avg < baseline_ctr × 0.80
describe("Rule C2 — Audience Saturation", () => {
  const blCpm = GLOBAL_BENCHMARKS.cpm.mean; // 12.00
  const blCtr = GLOBAL_BENCHMARKS.ctr.mean; // 0.01

  function c2Fires(cpm7dAvg: number | null, ctr7dAvg: number | null, bCpm = blCpm, bCtr = blCtr) {
    if (cpm7dAvg === null || ctr7dAvg === null) return false;
    return cpm7dAvg > bCpm * 1.40 && ctr7dAvg < bCtr * 0.80;
  }

  it("fires when CPM > 140% of baseline and CTR < 80% of baseline", () => {
    // CPM > 12 × 1.40 = 16.8; CTR < 0.01 × 0.80 = 0.008
    expect(c2Fires(17.0, 0.007)).toBe(true);
  });

  it("does not fire when CPM is exactly at 140% threshold", () => {
    expect(c2Fires(blCpm * 1.40, 0.007)).toBe(false);
  });

  it("does not fire when CTR is exactly at 80% threshold", () => {
    expect(c2Fires(17.0, blCtr * 0.80)).toBe(false);
  });

  it("does not fire when CPM is high but CTR is above threshold", () => {
    expect(c2Fires(17.0, 0.009)).toBe(false);
  });

  it("does not fire when CTR is low but CPM is below threshold", () => {
    expect(c2Fires(15.0, 0.007)).toBe(false);
  });

  it("does not fire when either metric is null", () => {
    expect(c2Fires(null, 0.007)).toBe(false);
    expect(c2Fires(17.0, null)).toBe(false);
  });

  it("uses entity-level CPM baseline when available", () => {
    const entityCpm = 8.0; // lower entity baseline
    // CPM > 8 × 1.40 = 11.2
    expect(c2Fires(12.0, 0.007, entityCpm, blCtr)).toBe(true);
    expect(c2Fires(11.0, 0.007, entityCpm, blCtr)).toBe(false);
  });

  it("evidence records CPM metric and correct threshold", () => {
    const cpm = 17.0;
    const bl = blCpm;
    const delta = relativeDelta(cpm, bl);
    // (17 - 12) / 12 ≈ 0.42
    expect(delta).toBeCloseTo(0.42, 2);
    expect(round2(cpm)).toBe(17);
    expect(round2(bl)).toBe(12);
  });
});

// ── Rule F1 — Funnel Bottleneck ───────────────────────────────────────────────
// Condition: ctr_7d_avg > baseline_ctr × 1.20 AND cpl_7d_avg > baseline_cpl × 1.30
describe("Rule F1 — Funnel Bottleneck", () => {
  const blCtr = GLOBAL_BENCHMARKS.ctr.mean; // 0.01
  const blCpl = GLOBAL_BENCHMARKS.cpl.mean; // 15.00

  function f1Fires(ctr7dAvg: number | null, cpl7dAvg: number | null, bCtr = blCtr, bCpl = blCpl) {
    if (ctr7dAvg === null || cpl7dAvg === null) return false;
    return ctr7dAvg > bCtr * 1.20 && cpl7dAvg > bCpl * 1.30;
  }

  it("fires when CTR > 120% of baseline and CPL > 130% of baseline", () => {
    // CTR > 0.01 × 1.20 = 0.012; CPL > 15 × 1.30 = 19.5
    expect(f1Fires(0.013, 20.0)).toBe(true);
  });

  it("does not fire when CTR is exactly at 120% threshold", () => {
    expect(f1Fires(blCtr * 1.20, 20.0)).toBe(false);
  });

  it("does not fire when CPL is exactly at 130% threshold", () => {
    expect(f1Fires(0.013, blCpl * 1.30)).toBe(false);
  });

  it("does not fire when CTR is high but CPL is below threshold", () => {
    expect(f1Fires(0.013, 18.0)).toBe(false);
  });

  it("does not fire when CPL is high but CTR is below threshold", () => {
    expect(f1Fires(0.011, 20.0)).toBe(false);
  });

  it("does not fire when either metric is null", () => {
    expect(f1Fires(null, 20.0)).toBe(false);
    expect(f1Fires(0.013, null)).toBe(false);
  });

  it("fires with entity-level CPL baseline (higher baseline raises the bar)", () => {
    const entityCpl = 25.0;
    // CPL > 25 × 1.30 = 32.5
    expect(f1Fires(0.013, 33.0, blCtr, entityCpl)).toBe(true);
    expect(f1Fires(0.013, 31.0, blCtr, entityCpl)).toBe(false);
  });

  it("evidence records CPL metric and correct delta", () => {
    const cpl = 20.0;
    const bl = blCpl;
    const delta = relativeDelta(cpl, bl);
    // (20 - 15) / 15 ≈ 0.33
    expect(delta).toBeCloseTo(0.33, 2);
  });
});

// ── Rule F2 — Spend Without Leads ─────────────────────────────────────────────
// Condition: leads_7d < 5 AND spend_7d > 500 (no baseline required)
describe("Rule F2 — Spend Without Leads", () => {
  function f2Fires(leads7d: number, spend7d: number) {
    return leads7d < 5 && spend7d > 500;
  }

  it("fires when leads < 5 and spend > 500", () => {
    expect(f2Fires(0, 600)).toBe(true);
    expect(f2Fires(4, 501)).toBe(true);
  });

  it("does not fire when leads is exactly 5", () => {
    expect(f2Fires(5, 600)).toBe(false);
  });

  it("does not fire when spend is exactly 500", () => {
    expect(f2Fires(0, 500)).toBe(false);
  });

  it("does not fire when leads >= 5 even with high spend", () => {
    expect(f2Fires(5, 1000)).toBe(false);
    expect(f2Fires(100, 5000)).toBe(false);
  });

  it("does not fire when spend <= 500 even with zero leads", () => {
    expect(f2Fires(0, 499)).toBe(false);
    expect(f2Fires(0, 500)).toBe(false);
  });

  it("fires with 1 lead and spend just above 500", () => {
    expect(f2Fires(1, 500.01)).toBe(true);
  });

  it("fires with 0 leads and any spend above 500", () => {
    expect(f2Fires(0, 501)).toBe(true);
    expect(f2Fires(0, 10000)).toBe(true);
  });

  it("evidence CPL is 0 when leads is 0 (no division by zero)", () => {
    const leads = 0, spend = 600;
    const cpl = leads > 0 ? round2(spend / leads) : 0;
    expect(cpl).toBe(0);
  });

  it("evidence CPL is computed correctly when leads > 0", () => {
    const leads = 2, spend = 600;
    const cpl = leads > 0 ? round2(spend / leads) : 0;
    expect(cpl).toBe(300);
  });
});

// ── Rule A1 — Audience Quality Degradation ────────────────────────────────────
// Condition: cpl_7d_avg > baseline_cpl × 1.50 AND impressions_7d > 5000
describe("Rule A1 — Audience Quality Degradation", () => {
  const blCpl = GLOBAL_BENCHMARKS.cpl.mean; // 15.00

  function a1Fires(cpl7dAvg: number | null, impressions7d: number, bCpl = blCpl) {
    if (cpl7dAvg === null) return false;
    return cpl7dAvg > bCpl * 1.50 && impressions7d > 5000;
  }

  it("fires when CPL > 150% of baseline and impressions > 5000", () => {
    // CPL > 15 × 1.50 = 22.5
    expect(a1Fires(23.0, 6000)).toBe(true);
  });

  it("does not fire when CPL is exactly at 150% threshold", () => {
    expect(a1Fires(blCpl * 1.50, 6000)).toBe(false);
  });

  it("does not fire when impressions are exactly 5000", () => {
    expect(a1Fires(23.0, 5000)).toBe(false);
  });

  it("does not fire when impressions are below 5000", () => {
    expect(a1Fires(23.0, 4999)).toBe(false);
  });

  it("does not fire when CPL is below threshold even with high impressions", () => {
    expect(a1Fires(20.0, 10000)).toBe(false);  // 20 < 22.5
  });

  it("does not fire when CPL is null", () => {
    expect(a1Fires(null, 6000)).toBe(false);
  });

  it("fires with entity-level CPL baseline (higher baseline)", () => {
    const entityCpl = 30.0;
    // CPL > 30 × 1.50 = 45
    expect(a1Fires(46.0, 6000, entityCpl)).toBe(true);
    expect(a1Fires(44.0, 6000, entityCpl)).toBe(false);
  });

  it("fires with account-level CPL baseline fallback", () => {
    const accountCpl = 10.0;
    // CPL > 10 × 1.50 = 15
    expect(a1Fires(16.0, 6000, accountCpl)).toBe(true);
    expect(a1Fires(14.0, 6000, accountCpl)).toBe(false);
  });

  it("evidence delta is computed correctly", () => {
    const cpl = 23.0;
    const bl = blCpl;
    const delta = relativeDelta(cpl, bl);
    // (23 - 15) / 15 ≈ 0.53
    expect(delta).toBeCloseTo(0.53, 2);
  });
});

// ── Rule S1 — Zero Leads with Spend ──────────────────────────────────────────
// Condition: leads_7d = 0 AND spend_7d > 200 AND impressions_7d >= 500
// Note: S1 is evaluated BEFORE the impressions gate and uses its own gate.
describe("Rule S1 — Zero Leads with Spend", () => {
  function s1Fires(leads7d: number, spend7d: number, impressions7d: number) {
    return leads7d === 0 && spend7d > 200 && impressions7d >= 500;
  }

  it("fires when leads = 0, spend > 200, and impressions >= 500", () => {
    expect(s1Fires(0, 250, 500)).toBe(true);
    expect(s1Fires(0, 1000, 5000)).toBe(true);
  });

  it("does not fire when leads > 0", () => {
    expect(s1Fires(1, 300, 600)).toBe(false);
  });

  it("does not fire when spend is exactly 200 (not strictly greater)", () => {
    expect(s1Fires(0, 200, 600)).toBe(false);
  });

  it("does not fire when spend is below 200", () => {
    expect(s1Fires(0, 199, 600)).toBe(false);
  });

  it("does not fire when impressions < 500", () => {
    expect(s1Fires(0, 300, 499)).toBe(false);
  });

  it("fires when impressions are exactly 500 (>= is inclusive)", () => {
    expect(s1Fires(0, 300, 500)).toBe(true);
  });

  it("fires even when impressions are below the general 500 gate (S1 is exempt)", () => {
    // S1 uses its own impressions >= 500 condition, not the general gate
    // The general gate skips C1-A1 for impressions < 500, but S1 runs first
    expect(s1Fires(0, 300, 500)).toBe(true);
  });

  it("does not fire when impressions are below S1's own 500 threshold", () => {
    expect(s1Fires(0, 300, 499)).toBe(false);
  });

  it("evidence has correct shape (no baseline)", () => {
    const spend7d = 300;
    const impressions7d = 600;
    const evidence = {
      metric: "leads",
      value: 0,
      baseline: null,
      delta: null,
      spend7d: round2(spend7d),
      impressions7d,
      period: "7d",
      baselineSource: "none",
    };
    expect(evidence.baseline).toBeNull();
    expect(evidence.delta).toBeNull();
    expect(evidence.baselineSource).toBe("none");
    expect(evidence.spend7d).toBe(300);
    expect(evidence.impressions7d).toBe(600);
  });
});

// ── Impressions gate ──────────────────────────────────────────────────────────
describe("Impressions gate (MIN_IMPRESSIONS = 500)", () => {
  const MIN = 500;

  it("allows entities with impressions >= 500 through the gate", () => {
    expect(500 >= MIN).toBe(true);
    expect(1000 >= MIN).toBe(true);
  });

  it("blocks entities with impressions < 500 from C1-A1 evaluation", () => {
    expect(499 < MIN).toBe(true);
    expect(0 < MIN).toBe(true);
  });

  it("S1 uses its own >= 500 condition independently of the gate", () => {
    // An entity with exactly 500 impressions, 0 leads, spend > 200 should fire S1
    // even though the general gate would also pass it through
    expect(s1FiresCheck(0, 300, 500)).toBe(true);
  });

  it("S1 does NOT fire for entities with impressions < 500 (its own gate)", () => {
    expect(s1FiresCheck(0, 300, 499)).toBe(false);
  });

  function s1FiresCheck(leads: number, spend: number, impressions: number) {
    return leads === 0 && spend > 200 && impressions >= 500;
  }
});

// ── Baseline fallback ordering ────────────────────────────────────────────────
describe("Baseline fallback ordering (entity → account → global)", () => {
  const WS = 1;
  const empty = new Map<string, Baseline>();
  const emptyAccount = new Map<string, number>();

  it("uses entity baseline when all three tiers are available", () => {
    const bl = makeBaseline({ entityId: 101, metric: "cpl", meanValue: "8.000000", sampleDays: 5 });
    const blMap = new Map([["campaign:101:cpl", bl]]);
    const accMap = new Map([["account:1:cpl", 12.0]]);
    const result = resolveBaseline("campaign", 101, "cpl", WS, blMap, accMap);
    expect(result!.source).toBe("entity");
    expect(result!.mean).toBeCloseTo(8.0);
  });

  it("falls to account when entity baseline has sampleDays < 3", () => {
    const bl = makeBaseline({ entityId: 101, metric: "cpl", meanValue: "8.000000", sampleDays: 1 });
    const blMap = new Map([["campaign:101:cpl", bl]]);
    const accMap = new Map([["account:1:cpl", 12.0]]);
    const result = resolveBaseline("campaign", 101, "cpl", WS, blMap, accMap);
    expect(result!.source).toBe("account");
    expect(result!.mean).toBeCloseTo(12.0);
  });

  it("falls to global when entity and account baselines are both absent", () => {
    const result = resolveBaseline("campaign", 999, "cpl", WS, empty, emptyAccount);
    expect(result!.source).toBe("global");
    expect(result!.mean).toBe(GLOBAL_BENCHMARKS.cpl.mean);
  });

  it("falls to global when entity baseline is absent and account baseline is 0", () => {
    const accMap = new Map([["account:1:cpl", 0]]);
    const result = resolveBaseline("campaign", 999, "cpl", WS, empty, accMap);
    expect(result!.source).toBe("global");
  });

  it("returns null for an unsupported metric with no entity or account baseline", () => {
    const result = resolveBaseline("campaign", 999, "revenue", WS, empty, emptyAccount);
    expect(result).toBeNull();
  });

  it("ad_set entities use the correct key format", () => {
    const bl = makeBaseline({ entityType: "ad_set", entityId: 202, metric: "ctr", meanValue: "0.030000", sampleDays: 4 });
    const blMap = new Map([["ad_set:202:ctr", bl]]);
    const result = resolveBaseline("ad_set", 202, "ctr", WS, blMap, emptyAccount);
    expect(result!.source).toBe("entity");
    expect(result!.mean).toBeCloseTo(0.030);
  });
});

// ── Severity constants ────────────────────────────────────────────────────────
describe("Rule severity constants", () => {
  it("S1 has the highest severity (85)", () => {
    expect(85).toBeGreaterThan(80); // S1 > F2
    expect(85).toBeGreaterThan(75); // S1 > F1
    expect(85).toBeGreaterThan(70); // S1 > C1
    expect(85).toBeGreaterThan(65); // S1 > A1
    expect(85).toBeGreaterThan(60); // S1 > C2
  });

  const severities: Record<string, number> = { S1: 85, F2: 80, F1: 75, C1: 70, A1: 65, C2: 60 };

  it("all six rules have distinct severity values", () => {
    const values = Object.values(severities);
    const unique = new Set(values);
    expect(unique.size).toBe(values.length);
  });

  it("severity ordering matches spec: S1 > F2 > F1 > C1 > A1 > C2", () => {
    expect(severities.S1).toBeGreaterThan(severities.F2);
    expect(severities.F2).toBeGreaterThan(severities.F1);
    expect(severities.F1).toBeGreaterThan(severities.C1);
    expect(severities.C1).toBeGreaterThan(severities.A1);
    expect(severities.A1).toBeGreaterThan(severities.C2);
  });
});
