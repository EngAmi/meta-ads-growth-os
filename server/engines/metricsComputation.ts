/**
 * Growth OS — Metrics Computation Engine
 *
 * Reads every daily_metrics row for the workspace that was written (or
 * re-written) by the data ingestion step, then computes the four derived
 * rate metrics and writes them back:
 *
 *   CTR = clicks / impressions          (dimensionless ratio, stored as decimal)
 *   CPC = spend  / clicks               (cost per click, USD)
 *   CPM = (spend / impressions) × 1000  (cost per 1 000 impressions, USD)
 *   CPL = spend  / leads                (cost per lead, USD)
 *
 * Divide-by-zero policy:
 *   - If the denominator is 0, the derived metric is set to NULL.
 *   - NULL means "not computable", not "zero cost". The diagnostic engine
 *     and baseline engine must treat NULL as absent data, not as 0.
 *
 * Precision:
 *   - CTR  → 6 decimal places  (e.g. 0.012345)
 *   - CPC  → 4 decimal places  (e.g. 1.2500)
 *   - CPM  → 4 decimal places  (e.g. 12.5000)
 *   - CPL  → 4 decimal places  (e.g. 8.7500)
 *
 * The module processes rows in batches of BATCH_SIZE to avoid loading the
 * entire workspace history into memory on large accounts.
 */

import { eq, and, isNull, or } from "drizzle-orm";
import { getDb } from "../db";
import { dailyMetrics, type DailyMetric } from "../../drizzle/schema";

// ─── Constants ────────────────────────────────────────────────────────────────

/** Number of rows fetched and processed per iteration. */
const BATCH_SIZE = 500;

// ─── Public interface ─────────────────────────────────────────────────────────

export interface MetricsComputationInput {
  workspaceId: number;
}

export interface MetricsComputationResult {
  rowsProcessed: number;
  rowsUpdated: number;
  rowsSkipped: number;
}

// ─── Computation helpers ──────────────────────────────────────────────────────

/**
 * Safe division — returns null when the denominator is zero or negative.
 */
function safeDivide(numerator: number, denominator: number): number | null {
  if (denominator <= 0) return null;
  return numerator / denominator;
}

/**
 * Format a nullable number to a fixed-precision string for Drizzle's decimal
 * column, or return null to write a SQL NULL.
 */
function fmt(value: number | null, decimals: number): string | null {
  if (value === null) return null;
  return value.toFixed(decimals);
}

/**
 * Parse a Drizzle decimal column value (returned as string | null) to a
 * JavaScript number.  Returns 0 if the value is null or unparseable.
 */
function parseDecimal(value: string | null | undefined): number {
  if (value === null || value === undefined) return 0;
  const n = parseFloat(value);
  return isNaN(n) ? 0 : n;
}

/**
 * Compute all four derived metrics for a single row.
 * Returns an object with the values to write back, using null for any metric
 * whose denominator is zero.
 */
function computeMetrics(row: DailyMetric): {
  ctr: string;
  cpc: string | null;
  cpm: string | null;
  cpl: string | null;
} {
  const impressions = row.impressions ?? 0;
  const clicks = row.clicks ?? 0;
  const spend = parseDecimal(row.spend);
  const leads = row.leads ?? 0;

  const ctr = safeDivide(clicks, impressions);
  const cpc = safeDivide(spend, clicks);
  const cpm = safeDivide(spend * 1000, impressions);
  const cpl = safeDivide(spend, leads);

  return {
    // CTR is stored as a NOT NULL column with default 0 — use "0.000000" when
    // impressions is zero rather than NULL.
    ctr: ctr !== null ? ctr.toFixed(6) : "0.000000",
    cpc: fmt(cpc, 4),
    cpm: fmt(cpm, 4),
    cpl: fmt(cpl, 4),
  };
}

/**
 * Returns true when the row's current derived values already match the
 * freshly computed values, so we can skip the UPDATE and save a round-trip.
 */
function isDirty(
  row: DailyMetric,
  computed: ReturnType<typeof computeMetrics>,
): boolean {
  // Always treat a row with any NULL derived metric as dirty so it gets
  // recomputed — this catches rows written by dataIngestion with cpc/cpm/cpl = null.
  if (row.cpc === null || row.cpm === null) return true;

  if (parseDecimal(row.ctr).toFixed(6) !== computed.ctr) return true;
  if (fmt(parseDecimal(row.cpc), 4) !== computed.cpc) return true;
  if (fmt(parseDecimal(row.cpm), 4) !== computed.cpm) return true;
  if (fmt(parseDecimal(row.cpl), 4) !== computed.cpl) return true;

  return false;
}

// ─── Main export ──────────────────────────────────────────────────────────────

export async function runMetricsComputation(
  input: MetricsComputationInput,
): Promise<MetricsComputationResult> {
  const { workspaceId } = input;
  const db = await getDb();
  if (!db) throw new Error("[MetricsComputation] Database not available");

  let rowsProcessed = 0;
  let rowsUpdated = 0;
  let rowsSkipped = 0;
  let offset = 0;

  console.log(
    `[MetricsComputation] Starting for workspaceId ${workspaceId}`,
  );

  // Process in batches to keep memory usage bounded.
  while (true) {
    // Fetch only rows that need computation: those where at least one derived
    // metric is NULL (freshly ingested rows) or all derived metrics are present
    // (re-sync rows that may have changed raw values).
    // We use a simple full-workspace scan with offset pagination; for large
    // accounts this is acceptable because the table is indexed on (workspaceId, date).
    const batch: DailyMetric[] = await db
      .select()
      .from(dailyMetrics)
      .where(
        and(
          eq(dailyMetrics.workspaceId, workspaceId),
          // Prioritise rows with NULL derived metrics (freshly ingested).
          // A second pass will catch rows whose raw values changed.
          or(
            isNull(dailyMetrics.cpc),
            isNull(dailyMetrics.cpm),
          ),
        ),
      )
      .limit(BATCH_SIZE)
      .offset(offset);

    if (batch.length === 0) break;

    for (const row of batch) {
      rowsProcessed += 1;
      const computed = computeMetrics(row);

      if (!isDirty(row, computed)) {
        rowsSkipped += 1;
        continue;
      }

      await db
        .update(dailyMetrics)
        .set({
          ctr: computed.ctr,
          cpc: computed.cpc,
          cpm: computed.cpm,
          cpl: computed.cpl,
        })
        .where(eq(dailyMetrics.id, row.id));

      rowsUpdated += 1;
    }

    // If the batch was smaller than BATCH_SIZE, we've reached the end.
    if (batch.length < BATCH_SIZE) break;

    // Advance offset only when no rows were updated in this batch (i.e. all
    // rows were already up-to-date).  When rows are updated the WHERE clause
    // will naturally exclude them from the next page.
    if (rowsUpdated === 0) {
      offset += BATCH_SIZE;
    }
  }

  // Second pass: recompute rows whose raw values may have changed on a re-sync
  // (cpc/cpm are no longer NULL but raw values differ).
  // We do a full workspace scan here but skip rows where isDirty returns false.
  let secondOffset = 0;
  while (true) {
    const batch: DailyMetric[] = await db
      .select()
      .from(dailyMetrics)
      .where(eq(dailyMetrics.workspaceId, workspaceId))
      .limit(BATCH_SIZE)
      .offset(secondOffset);

    if (batch.length === 0) break;

    for (const row of batch) {
      rowsProcessed += 1;
      const computed = computeMetrics(row);

      if (!isDirty(row, computed)) {
        rowsSkipped += 1;
        continue;
      }

      await db
        .update(dailyMetrics)
        .set({
          ctr: computed.ctr,
          cpc: computed.cpc,
          cpm: computed.cpm,
          cpl: computed.cpl,
        })
        .where(eq(dailyMetrics.id, row.id));

      rowsUpdated += 1;
    }

    if (batch.length < BATCH_SIZE) break;
    secondOffset += BATCH_SIZE;
  }

  console.log(
    `[MetricsComputation] Done — processed: ${rowsProcessed}, ` +
    `updated: ${rowsUpdated}, skipped: ${rowsSkipped}`,
  );

  return { rowsProcessed, rowsUpdated, rowsSkipped };
}
