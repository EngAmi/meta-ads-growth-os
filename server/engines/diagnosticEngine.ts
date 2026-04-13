/**
 * Growth OS — Diagnostic Engine
 *
 * Evaluates 6 diagnostic rules against the last 7 days of daily_metrics
 * for every active entity (campaign and ad_set) in the workspace, and
 * writes triggered diagnostics to engine_diagnostics.
 *
 * ─── Approved rules (Build Slice v1.1) ───────────────────────────────────────
 *
 * | Rule | Category  | Condition                                                          | Severity |
 * |------|-----------|---------------------------------------------------------------------|----------|
 * | C1   | creative  | frequency_7d_avg > 3.5 AND ctr_7d_avg < baseline_ctr × 0.70        | 70       |
 * | C2   | creative  | cpm_7d_avg > baseline_cpm × 1.40 AND ctr_7d_avg < baseline_ctr × 0.80 | 60    |
 * | F1   | funnel    | ctr_7d_avg > baseline_ctr × 1.20 AND cpl_7d_avg > baseline_cpl × 1.30 | 75    |
 * | F2   | funnel    | leads_7d < 5 AND spend_7d > 500                                     | 80       |
 * | A1   | audience  | cpl_7d_avg > baseline_cpl × 1.50 AND impressions_7d > 5000          | 65       |
 * | S1   | funnel    | leads_7d = 0 AND spend_7d > 200 AND impressions_7d >= 500           | 85       |
 *
 * ─── Gates ───────────────────────────────────────────────────────────────────
 * - Minimum impressions: skip any entity with impressions_7d < 500.
 *   (S1 is exempt from this gate — it uses its own impressions_7d >= 500 condition.)
 * - Baseline resolution: if resolveBaseline() returns null for a required metric,
 *   skip the rule for that entity and increment entitiesSkipped.
 *
 * ─── Baseline resolution (three-tier) ────────────────────────────────────────
 * Tier 1 — entity-level row in baselines (sampleDays >= 3, computedAt = today)
 * Tier 2 — account-level average: mean of all entity baselines in the workspace
 *           with sampleDays >= 3 for the same metric (pre-computed before the loop)
 * Tier 3 — GLOBAL_BENCHMARKS hardcoded constants
 *
 * ─── Evidence format ─────────────────────────────────────────────────────────
 * Standard: { metric, value, baseline, delta, threshold, period, baselineSource }
 * S1 only:  { metric, value, baseline: null, delta: null, spend7d, impressions7d, period, baselineSource: "none" }
 */

import { eq, and, gte, desc } from "drizzle-orm";
import { getDb } from "../db";
import {
  dailyMetrics,
  baselines,
  engineDiagnostics,
  engineCampaigns,
  engineAdSets,
  type DailyMetric,
  type Baseline,
} from "../../drizzle/schema";
import { GLOBAL_BENCHMARKS, type MetricName } from "./baselineEngine";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface DiagnosticEngineInput {
  workspaceId: number;
  runId: string;
}

export interface DiagnosticEngineResult {
  rulesEvaluated: number;
  diagnosticsCreated: number;
  entitiesSkipped: number;
}

type EntityType = "campaign" | "ad_set";
type DiagCategory = "creative" | "audience" | "funnel" | "tracking";

interface EntityWindow {
  entityType: EntityType;
  entityId: number;
  impressions7d: number;
  clicks7d: number;
  spend7d: number;
  leads7d: number;
  ctr7dAvg: number | null;
  cpc7dAvg: number | null;
  cpm7dAvg: number | null;
  cpl7dAvg: number | null;
  frequency7dAvg: number | null;
}

interface BaselineResolution {
  mean: number;
  source: "entity" | "account" | "global";
}

interface StandardEvidence {
  metric: string;
  value: number;
  baseline: number;
  delta: number;       // (value - baseline) / baseline, rounded to 2 dp
  threshold: number;   // the multiplier threshold that triggered the rule
  period: "7d";
  baselineSource: "entity" | "account" | "global";
}

interface S1Evidence {
  metric: "leads";
  value: 0;
  baseline: null;
  delta: null;
  spend7d: number;
  impressions7d: number;
  period: "7d";
  baselineSource: "none";
}

// ─── Constants ────────────────────────────────────────────────────────────────

/** Minimum 7-day impressions required to evaluate any rule (except S1). */
const MIN_IMPRESSIONS_GATE = 500;

/** Number of days in the evaluation window. */
const WINDOW_DAYS = 7;

// ─── Helpers ──────────────────────────────────────────────────────────────────

function parseDecimal(v: string | null | undefined): number | null {
  if (v === null || v === undefined) return null;
  const n = parseFloat(v);
  return isNaN(n) ? null : n;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/**
 * Compute the relative delta: (value - baseline) / baseline, rounded to 2 dp.
 */
function relativeDelta(value: number, baseline: number): number {
  if (baseline === 0) return 0;
  return round2((value - baseline) / baseline);
}

// ─── Baseline resolution ──────────────────────────────────────────────────────

/**
 * Resolve the baseline for a given entity × metric pair using the three-tier
 * fallback: entity → account → global benchmark.
 *
 * Returns null only when no tier can supply a value (should never happen for
 * the five supported metrics since GLOBAL_BENCHMARKS covers all of them).
 */
function resolveBaseline(
  entityType: EntityType,
  entityId: number,
  metric: MetricName,
  workspaceId: number,
  baselinesMap: Map<string, Baseline>,
  accountBaselines: Map<string, number>,
): BaselineResolution | null {
  // Tier 1 — entity-level
  const key = `${entityType}:${entityId}:${metric}`;
  const row = baselinesMap.get(key);
  if (row && row.sampleDays >= 3) {
    const mean = parseDecimal(row.meanValue);
    if (mean !== null && mean > 0) return { mean, source: "entity" };
  }

  // Tier 2 — account-level
  const accountMean = accountBaselines.get(`account:${workspaceId}:${metric}`);
  if (accountMean !== undefined && accountMean > 0) {
    return { mean: accountMean, source: "account" };
  }

  // Tier 3 — global benchmark
  const globalMean = GLOBAL_BENCHMARKS[metric]?.mean;
  if (globalMean !== undefined) {
    return { mean: globalMean, source: "global" };
  }

  return null;
}

// ─── 7-day window aggregation ─────────────────────────────────────────────────

/**
 * Aggregate the last WINDOW_DAYS of daily_metrics rows for a single entity
 * into a flat EntityWindow object.
 *
 * Rate metrics (CTR, CPC, CPM, CPL, frequency) are averaged over non-NULL days.
 * Raw counts (impressions, clicks, spend, leads) are summed.
 */
function aggregateWindow(rows: DailyMetric[]): Omit<EntityWindow, "entityType" | "entityId"> {
  let impressions7d = 0;
  let clicks7d = 0;
  let spend7d = 0;
  let leads7d = 0;

  const ctrValues: number[] = [];
  const cpcValues: number[] = [];
  const cpmValues: number[] = [];
  const cplValues: number[] = [];
  const freqValues: number[] = [];

  for (const row of rows) {
    impressions7d += row.impressions ?? 0;
    clicks7d += row.clicks ?? 0;
    spend7d += parseDecimal(row.spend) ?? 0;
    leads7d += row.leads ?? 0;

    const ctr = parseDecimal(row.ctr);
    if (ctr !== null) ctrValues.push(ctr);

    const cpc = parseDecimal(row.cpc);
    if (cpc !== null) cpcValues.push(cpc);

    const cpm = parseDecimal(row.cpm);
    if (cpm !== null) cpmValues.push(cpm);

    const cpl = parseDecimal(row.cpl);
    if (cpl !== null) cplValues.push(cpl);

    const freq = parseDecimal(row.frequency);
    if (freq !== null && freq > 0) freqValues.push(freq);
  }

  const avg = (arr: number[]) =>
    arr.length > 0 ? arr.reduce((s, v) => s + v, 0) / arr.length : null;

  return {
    impressions7d,
    clicks7d,
    spend7d,
    leads7d,
    ctr7dAvg: avg(ctrValues),
    cpc7dAvg: avg(cpcValues),
    cpm7dAvg: avg(cpmValues),
    cpl7dAvg: avg(cplValues),
    frequency7dAvg: avg(freqValues),
  };
}

// ─── Diagnostic writer ────────────────────────────────────────────────────────

async function writeDiagnostic(params: {
  workspaceId: number;
  runId: string;
  ruleId: string;
  category: DiagCategory;
  entityType: EntityType;
  entityId: number;
  severity: number;
  evidence: StandardEvidence | S1Evidence;
}): Promise<void> {
  const db = await getDb();
  if (!db) return;

  await db.insert(engineDiagnostics).values({
    workspaceId: params.workspaceId,
    runId: params.runId,
    ruleId: params.ruleId,
    category: params.category,
    entityType: params.entityType,
    entityId: params.entityId,
    severity: params.severity,
    evidence: params.evidence,
    status: "active",
  });
}

// ─── Main export ──────────────────────────────────────────────────────────────

export async function runDiagnosticEngine(
  input: DiagnosticEngineInput,
): Promise<DiagnosticEngineResult> {
  const { workspaceId, runId } = input;
  const db = await getDb();
  if (!db) throw new Error("[DiagnosticEngine] Database not available");

  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);

  const windowStart = new Date(today);
  windowStart.setUTCDate(windowStart.getUTCDate() - WINDOW_DAYS);

  console.log(
    `[DiagnosticEngine] Starting for workspaceId ${workspaceId}, runId ${runId}`,
  );

  // ── 1. Load all baselines computed today ────────────────────────────────────
  const allBaselines: Baseline[] = await db
    .select()
    .from(baselines)
    .where(
      and(
        eq(baselines.workspaceId, workspaceId),
        gte(baselines.computedAt, today),
      ),
    );

  // Build a lookup map: "entityType:entityId:metric" → Baseline row
  const baselinesMap = new Map<string, Baseline>();
  for (const b of allBaselines) {
    baselinesMap.set(`${b.entityType}:${b.entityId}:${b.metric}`, b);
  }

  // ── 2. Pre-compute account-level baselines (Tier 2) ─────────────────────────
  const accountBaselines = new Map<string, number>();
  for (const metric of ["ctr", "cpl", "cpc", "cpm", "frequency"] as MetricName[]) {
    const eligible = allBaselines.filter(
      (b) =>
        b.metric === metric &&
        b.sampleDays >= 3 &&
        b.entityId !== 0, // exclude the sentinel account row itself
    );
    if (eligible.length > 0) {
      const values = eligible.map((b) => parseDecimal(b.meanValue) ?? 0).filter((v) => v > 0);
      if (values.length > 0) {
        const accountMean = values.reduce((s, v) => s + v, 0) / values.length;
        accountBaselines.set(`account:${workspaceId}:${metric}`, accountMean);
      }
    }
  }

  // ── 3. Load 7-day daily_metrics for all entities ────────────────────────────
  const windowRows: DailyMetric[] = await db
    .select()
    .from(dailyMetrics)
    .where(
      and(
        eq(dailyMetrics.workspaceId, workspaceId),
        gte(dailyMetrics.date, windowStart),
      ),
    );

  // Group rows by "entityType:entityId"
  const entityWindowMap = new Map<string, DailyMetric[]>();
  for (const row of windowRows) {
    const key = `${row.entityType}:${row.entityId}`;
    const bucket = entityWindowMap.get(key);
    if (bucket) {
      bucket.push(row);
    } else {
      entityWindowMap.set(key, [row]);
    }
  }

  // ── 4. Build EntityWindow list ───────────────────────────────────────────────
  const entityWindows: EntityWindow[] = [];
  for (const [key, rows] of Array.from(entityWindowMap.entries())) {
    const [entityType, entityIdStr] = key.split(":");
    const entityId = parseInt(entityIdStr, 10);
    const agg = aggregateWindow(rows);
    entityWindows.push({
      entityType: entityType as EntityType,
      entityId,
      ...agg,
    });
  }

  // ── 5. Evaluate rules ────────────────────────────────────────────────────────
  let rulesEvaluated = 0;
  let diagnosticsCreated = 0;
  let entitiesSkipped = 0;

  for (const ew of entityWindows) {
    const { entityType, entityId, impressions7d, spend7d, leads7d } = ew;

    // ── Rule S1 — evaluated first, before the impressions gate ─────────────
    // Condition: leads_7d = 0 AND spend_7d > 200 AND impressions_7d >= 500
    rulesEvaluated += 1;
    if (leads7d === 0 && spend7d > 200 && impressions7d >= 500) {
      const evidence: S1Evidence = {
        metric: "leads",
        value: 0,
        baseline: null,
        delta: null,
        spend7d: round2(spend7d),
        impressions7d,
        period: "7d",
        baselineSource: "none",
      };
      await writeDiagnostic({
        workspaceId,
        runId,
        ruleId: "S1",
        category: "funnel",
        entityType,
        entityId,
        severity: 85,
        evidence,
      });
      diagnosticsCreated += 1;
    }

    // ── Minimum impressions gate (applies to C1, C2, F1, F2, A1) ───────────
    if (impressions7d < MIN_IMPRESSIONS_GATE) {
      entitiesSkipped += 1;
      continue;
    }

    // ── Rule C1 — Creative Fatigue ──────────────────────────────────────────
    // Condition: frequency_7d_avg > 3.5 AND ctr_7d_avg < baseline_ctr × 0.70
    rulesEvaluated += 1;
    {
      const { frequency7dAvg, ctr7dAvg } = ew;
      if (frequency7dAvg !== null && ctr7dAvg !== null && frequency7dAvg > 3.5) {
        const bl = resolveBaseline(entityType, entityId, "ctr", workspaceId, baselinesMap, accountBaselines);
        if (bl === null) {
          entitiesSkipped += 1;
        } else if (ctr7dAvg < bl.mean * 0.70) {
          const evidence: StandardEvidence = {
            metric: "ctr",
            value: round2(ctr7dAvg),
            baseline: round2(bl.mean),
            delta: relativeDelta(ctr7dAvg, bl.mean),
            threshold: -0.30,
            period: "7d",
            baselineSource: bl.source,
          };
          await writeDiagnostic({
            workspaceId, runId, ruleId: "C1", category: "creative",
            entityType, entityId, severity: 70, evidence,
          });
          diagnosticsCreated += 1;
        }
      }
    }

    // ── Rule C2 — Audience Saturation ───────────────────────────────────────
    // Condition: cpm_7d_avg > baseline_cpm × 1.40 AND ctr_7d_avg < baseline_ctr × 0.80
    rulesEvaluated += 1;
    {
      const { cpm7dAvg, ctr7dAvg } = ew;
      if (cpm7dAvg !== null && ctr7dAvg !== null) {
        const blCpm = resolveBaseline(entityType, entityId, "cpm", workspaceId, baselinesMap, accountBaselines);
        const blCtr = resolveBaseline(entityType, entityId, "ctr", workspaceId, baselinesMap, accountBaselines);
        if (blCpm === null || blCtr === null) {
          entitiesSkipped += 1;
        } else if (cpm7dAvg > blCpm.mean * 1.40 && ctr7dAvg < blCtr.mean * 0.80) {
          const evidence: StandardEvidence = {
            metric: "cpm",
            value: round2(cpm7dAvg),
            baseline: round2(blCpm.mean),
            delta: relativeDelta(cpm7dAvg, blCpm.mean),
            threshold: 0.40,
            period: "7d",
            baselineSource: blCpm.source,
          };
          await writeDiagnostic({
            workspaceId, runId, ruleId: "C2", category: "creative",
            entityType, entityId, severity: 60, evidence,
          });
          diagnosticsCreated += 1;
        }
      }
    }

    // ── Rule F1 — Funnel Bottleneck ─────────────────────────────────────────
    // Condition: ctr_7d_avg > baseline_ctr × 1.20 AND cpl_7d_avg > baseline_cpl × 1.30
    rulesEvaluated += 1;
    {
      const { ctr7dAvg, cpl7dAvg } = ew;
      if (ctr7dAvg !== null && cpl7dAvg !== null) {
        const blCtr = resolveBaseline(entityType, entityId, "ctr", workspaceId, baselinesMap, accountBaselines);
        const blCpl = resolveBaseline(entityType, entityId, "cpl", workspaceId, baselinesMap, accountBaselines);
        if (blCtr === null || blCpl === null) {
          entitiesSkipped += 1;
        } else if (ctr7dAvg > blCtr.mean * 1.20 && cpl7dAvg > blCpl.mean * 1.30) {
          const evidence: StandardEvidence = {
            metric: "cpl",
            value: round2(cpl7dAvg),
            baseline: round2(blCpl.mean),
            delta: relativeDelta(cpl7dAvg, blCpl.mean),
            threshold: 0.30,
            period: "7d",
            baselineSource: blCpl.source,
          };
          await writeDiagnostic({
            workspaceId, runId, ruleId: "F1", category: "funnel",
            entityType, entityId, severity: 75, evidence,
          });
          diagnosticsCreated += 1;
        }
      }
    }

    // ── Rule F2 — Spend Without Leads ───────────────────────────────────────
    // Condition: leads_7d < 5 AND spend_7d > 500
    // No baseline required — absolute threshold rule.
    rulesEvaluated += 1;
    if (leads7d < 5 && spend7d > 500) {
      const evidence: StandardEvidence = {
        metric: "cpl",
        value: leads7d > 0 ? round2(spend7d / leads7d) : 0,
        baseline: 0,
        delta: 0,
        threshold: 500,
        period: "7d",
        baselineSource: "none" as unknown as "entity", // no baseline used
      };
      await writeDiagnostic({
        workspaceId, runId, ruleId: "F2", category: "funnel",
        entityType, entityId, severity: 80, evidence,
      });
      diagnosticsCreated += 1;
    }

    // ── Rule A1 — Audience Quality Degradation ──────────────────────────────
    // Condition: cpl_7d_avg > baseline_cpl × 1.50 AND impressions_7d > 5000
    rulesEvaluated += 1;
    {
      const { cpl7dAvg } = ew;
      if (cpl7dAvg !== null && impressions7d > 5000) {
        const bl = resolveBaseline(entityType, entityId, "cpl", workspaceId, baselinesMap, accountBaselines);
        if (bl === null) {
          entitiesSkipped += 1;
        } else if (cpl7dAvg > bl.mean * 1.50) {
          const evidence: StandardEvidence = {
            metric: "cpl",
            value: round2(cpl7dAvg),
            baseline: round2(bl.mean),
            delta: relativeDelta(cpl7dAvg, bl.mean),
            threshold: 0.50,
            period: "7d",
            baselineSource: bl.source,
          };
          await writeDiagnostic({
            workspaceId, runId, ruleId: "A1", category: "audience",
            entityType, entityId, severity: 65, evidence,
          });
          diagnosticsCreated += 1;
        }
      }
    }
  }

  console.log(
    `[DiagnosticEngine] Done — rules evaluated: ${rulesEvaluated}, ` +
    `diagnostics created: ${diagnosticsCreated}, ` +
    `entities skipped: ${entitiesSkipped}`,
  );

  return { rulesEvaluated, diagnosticsCreated, entitiesSkipped };
}
