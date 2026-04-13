/**
 * Growth OS — Metrics Computation Engine (stub)
 *
 * Recomputes CTR, CPC, CPM, CPL from raw impressions/clicks/spend/leads
 * for all daily_metrics rows where the denominator is non-zero.
 *
 * TODO: implement full computation logic.
 */

export interface MetricsComputationInput {
  workspaceId: number;
}

export interface MetricsComputationResult {
  rowsUpdated: number;
}

export async function runMetricsComputation(
  _input: MetricsComputationInput,
): Promise<MetricsComputationResult> {
  // Stub — replace with real computation logic.
  console.log("[MetricsComputation] Stub — not yet implemented");
  return { rowsUpdated: 0 };
}
