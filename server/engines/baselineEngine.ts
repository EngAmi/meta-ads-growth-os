/**
 * Growth OS — Baseline Engine
 *
 * For every entity (campaign and ad_set) in the workspace, computes a
 * 14-day rolling baseline for each of the five rate metrics:
 *   ctr, cpl, cpc, cpm, frequency
 *
 * The baseline row written to `baselines` contains:
 *   meanValue   — arithmetic mean of the non-NULL daily values
 *   stdDev      — population standard deviation of those values
 *   sampleDays  — number of non-NULL days used in the computation
 *   computedAt  — today's UTC date (YYYY-MM-DD)
 *
 * Three-tier fallback when an entity has insufficient data (sampleDays < MIN_SAMPLE_DAYS):
 *
 *   Tier 1 — Entity baseline  (sampleDays >= MIN_SAMPLE_DAYS)
 *     Written normally.
 *
 *   Tier 2 — Account-level baseline
 *     Average the entity-level means across all entities in the workspace
 *     that DO have sufficient data for that metric.
 *     Written with entityId = ACCOUNT_ENTITY_ID (0) and entityType = 'campaign'.
 *     Used by the diagnostic engine when an entity row is absent.
 *
 *   Tier 3 — Global benchmark (hardcoded constants)
 *     Used by the diagnostic engine at runtime when neither entity nor
 *     account baseline is available.  Not written to the database.
 *
 * The account-level baseline row is always recomputed and upserted on each run.
 *
 * MIN_SAMPLE_DAYS = 3  (matches Build Slice v1.1 spec)
 * WINDOW_DAYS     = 14 (rolling window)
 */

import { eq, and, gte, isNotNull } from "drizzle-orm";
import { getDb } from "../db";
import { dailyMetrics, baselines, type DailyMetric } from "../../drizzle/schema";

// ─── Constants ────────────────────────────────────────────────────────────────

/** Minimum non-NULL sample days required for a valid entity-level baseline. */
const MIN_SAMPLE_DAYS = 3;

/** Rolling window in days. */
const WINDOW_DAYS = 14;

/**
 * Sentinel entityId used to store the account-level (workspace-wide) baseline.
 * The diagnostic engine reads this row when no entity-level baseline exists.
 */
const ACCOUNT_ENTITY_ID = 0;

/**
 * Global benchmark constants (Tier 3).
 * These are NOT written to the database; the diagnostic engine uses them
 * directly when neither entity nor account baseline is available.
 */
export const GLOBAL_BENCHMARKS: Record<MetricName, { mean: number; stdDev: number }> = {
  ctr:       { mean: 0.010000, stdDev: 0.005000 },  // 1.0% CTR
  cpc:       { mean: 1.500000, stdDev: 0.500000 },  // $1.50 CPC
  cpm:       { mean: 12.00000, stdDev: 4.000000 },  // $12.00 CPM
  cpl:       { mean: 15.00000, stdDev: 5.000000 },  // $15.00 CPL
  frequency: { mean: 2.000000, stdDev: 0.500000 },  // 2.0 frequency
};

// ─── Types ────────────────────────────────────────────────────────────────────

export type MetricName = "ctr" | "cpl" | "cpc" | "cpm" | "frequency";

const METRICS: MetricName[] = ["ctr", "cpl", "cpc", "cpm", "frequency"];

export interface BaselineEngineInput {
  workspaceId: number;
}

export interface BaselineEngineResult {
  baselinesWritten: number;
  entitiesSkipped: number;
  accountBaselinesWritten: number;
}

// ─── Math helpers ─────────────────────────────────────────────────────────────

/** Parse a Drizzle decimal string (or null) to a number. Returns null on null input. */
function parseDecimal(v: string | null | undefined): number | null {
  if (v === null || v === undefined) return null;
  const n = parseFloat(v);
  return isNaN(n) ? null : n;
}

/** Compute mean of a non-empty array of numbers. */
function mean(values: number[]): number {
  return values.reduce((s, v) => s + v, 0) / values.length;
}

/** Compute population standard deviation of a non-empty array. */
function stdDev(values: number[], mu: number): number {
  if (values.length < 2) return 0;
  const variance =
    values.reduce((s, v) => s + (v - mu) ** 2, 0) / values.length;
  return Math.sqrt(variance);
}

/**
 * Extract the value of a named metric from a DailyMetric row.
 * Returns null when the value is NULL in the database (denominator was zero).
 */
function extractMetric(row: DailyMetric, metric: MetricName): number | null {
  switch (metric) {
    case "ctr":       return parseDecimal(row.ctr);
    case "cpl":       return parseDecimal(row.cpl);
    case "cpc":       return parseDecimal(row.cpc);
    case "cpm":       return parseDecimal(row.cpm);
    case "frequency": return parseDecimal(row.frequency);
  }
}

// ─── Upsert helper ────────────────────────────────────────────────────────────

async function upsertBaseline(params: {
  workspaceId: number;
  entityType: "campaign" | "ad_set";
  entityId: number;
  metric: MetricName;
  meanValue: number;
  stdDevValue: number;
  sampleDays: number;
  computedAt: Date;
}): Promise<void> {
  const db = await getDb();
  if (!db) return;

  const row = {
    workspaceId: params.workspaceId,
    entityType: params.entityType,
    entityId: params.entityId,
    metric: params.metric,
    meanValue: params.meanValue.toFixed(6),
    stdDev: params.stdDevValue.toFixed(6),
    sampleDays: params.sampleDays,
    computedAt: params.computedAt,
  };

  await db
    .insert(baselines)
    .values(row)
    .onDuplicateKeyUpdate({
      set: {
        meanValue: row.meanValue,
        stdDev: row.stdDev,
        sampleDays: row.sampleDays,
      },
    });
}

// ─── Main export ──────────────────────────────────────────────────────────────

export async function runBaselineEngine(
  input: BaselineEngineInput,
): Promise<BaselineEngineResult> {
  const { workspaceId } = input;
  const db = await getDb();
  if (!db) throw new Error("[BaselineEngine] Database not available");

  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);

  // Compute the start of the 14-day window.
  const windowStart = new Date(today);
  windowStart.setUTCDate(windowStart.getUTCDate() - WINDOW_DAYS);

  console.log(
    `[BaselineEngine] Starting for workspaceId ${workspaceId}, ` +
    `window: ${windowStart.toISOString().slice(0, 10)} → ${today.toISOString().slice(0, 10)}`,
  );

  // ── 1. Fetch all daily_metrics rows in the window ──────────────────────────
  // We load the full window into memory. For Build Slice v1.1 this is bounded
  // by: 14 days × (campaigns + ad_sets) × 1 row each ≈ a few thousand rows max.
  const rows: DailyMetric[] = await db
    .select()
    .from(dailyMetrics)
    .where(
      and(
        eq(dailyMetrics.workspaceId, workspaceId),
        gte(dailyMetrics.date, windowStart),
      ),
    );

  // ── 2. Group rows by (entityType, entityId) ────────────────────────────────
  const entityMap = new Map<string, DailyMetric[]>();

  for (const row of rows) {
    const key = `${row.entityType}:${row.entityId}`;
    const bucket = entityMap.get(key);
    if (bucket) {
      bucket.push(row);
    } else {
      entityMap.set(key, [row]);
    }
  }

  let baselinesWritten = 0;
  let entitiesSkipped = 0;

  // ── 3. Per-entity, per-metric baseline ────────────────────────────────────
  // Also accumulate valid entity means for the account-level aggregation.
  // accountSamples[metric] = array of entity means that had sufficient data.
  const accountSamples: Record<MetricName, number[]> = {
    ctr: [], cpl: [], cpc: [], cpm: [], frequency: [],
  };

  for (const [key, entityRows] of Array.from(entityMap.entries())) {
    const [entityType, entityIdStr] = key.split(":");
    const entityId = parseInt(entityIdStr, 10);
    const typedEntityType = entityType as "campaign" | "ad_set";

    let entityHadAnyMetric = false;

    for (const metric of METRICS) {
      // Collect non-NULL values for this metric across the window.
      const values: number[] = [];
      for (const row of entityRows) {
        const v = extractMetric(row, metric);
        if (v !== null) values.push(v);
      }

      if (values.length < MIN_SAMPLE_DAYS) {
        // Insufficient data for this entity+metric — skip entity baseline.
        // The diagnostic engine will fall back to account or global.
        continue;
      }

      const mu = mean(values);
      const sigma = stdDev(values, mu);

      await upsertBaseline({
        workspaceId,
        entityType: typedEntityType,
        entityId,
        metric,
        meanValue: mu,
        stdDevValue: sigma,
        sampleDays: values.length,
        computedAt: today,
      });

      baselinesWritten += 1;
      entityHadAnyMetric = true;

      // Accumulate this entity's mean for the account-level aggregation.
      accountSamples[metric].push(mu);
    }

    if (!entityHadAnyMetric) {
      entitiesSkipped += 1;
    }
  }

  // ── 4. Account-level baseline (Tier 2) ────────────────────────────────────
  // Average the entity-level means for each metric across all entities that
  // had sufficient data.  Written with entityId = ACCOUNT_ENTITY_ID (0).
  let accountBaselinesWritten = 0;

  for (const metric of METRICS) {
    const samples = accountSamples[metric];
    if (samples.length === 0) continue; // No entity had data — skip.

    const mu = mean(samples);
    // stdDev of the entity means (cross-entity spread, not intra-entity).
    const sigma = stdDev(samples, mu);

    await upsertBaseline({
      workspaceId,
      entityType: "campaign",  // sentinel type for account-level row
      entityId: ACCOUNT_ENTITY_ID,
      metric,
      meanValue: mu,
      stdDevValue: sigma,
      sampleDays: samples.length,
      computedAt: today,
    });

    accountBaselinesWritten += 1;
  }

  console.log(
    `[BaselineEngine] Done — entity baselines: ${baselinesWritten}, ` +
    `entities skipped: ${entitiesSkipped}, ` +
    `account baselines: ${accountBaselinesWritten}`,
  );

  return { baselinesWritten, entitiesSkipped, accountBaselinesWritten };
}
