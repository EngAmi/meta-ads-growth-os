/**
 * Growth OS — Pipeline Orchestrator
 *
 * Runs the six engine modules in sequence, persists execution state to
 * `pipeline_runs`, and returns a structured run summary.
 *
 * Module order (Build Slice v1.1):
 *   1. dataIngestion        — fetch campaigns, ad sets, daily metrics from Meta API
 *   2. metricsComputation   — compute CTR / CPC / CPM / CPL from raw values
 *   3. baselineEngine       — compute 14-day rolling averages per entity per metric
 *   4. diagnosticEngine     — evaluate 6 diagnostic rules, write to engine_diagnostics
 *   5. recommendationEngine — map diagnostics → recommendations, write to engine_recommendations
 *   6. dailyBriefEngine     — assemble and persist the Daily Decision Brief
 *
 * Abort policy:
 *   - If dataIngestion fails, the pipeline aborts immediately (status = 'failed').
 *   - All other module failures are non-fatal: the pipeline continues and the
 *     final status is set to 'partial' if any stepErrors are present.
 */

import { randomUUID } from "crypto";
import { eq, sql } from "drizzle-orm";
import { getDb } from "../db";
import { pipelineRuns } from "../../drizzle/schema";

import { runDataIngestion } from "./dataIngestion";
import { runMetricsComputation } from "./metricsComputation";
import { runBaselineEngine } from "./baselineEngine";
import { runDiagnosticEngine } from "./diagnosticEngine";
import { runRecommendationEngine } from "./recommendationEngine";
import { runDailyBriefEngine } from "./dailyBriefEngine";

// ─── Types ────────────────────────────────────────────────────────────────────

export type PipelineTrigger = "cron" | "manual";

export interface PipelineInput {
  workspaceId: number;
  trigger: PipelineTrigger;
}

export interface PipelineRunSummary {
  runId: string;
  status: "completed" | "failed" | "partial";
  trigger: PipelineTrigger;
  stepsCompleted: number;
  stepResults: Record<string, object>;
  stepErrors: Record<string, string>;
  durationMs: number;
  startedAt: Date;
  endedAt: Date;
}

// ─── Internal helpers ─────────────────────────────────────────────────────────

/**
 * Merge a step's result object into the `stepResults` JSON column.
 */
async function recordStepResult(
  runId: string,
  stepName: string,
  result: object,
): Promise<void> {
  const db = await getDb();
  if (!db) return;

  await db
    .update(pipelineRuns)
    .set({
      stepResults: sql`JSON_SET(
        COALESCE(stepResults, '{}'),
        ${sql.raw(`'$.${stepName}'`)},
        CAST(${JSON.stringify(result)} AS JSON)
      )`,
      stepsCompleted: sql`stepsCompleted + 1`,
    })
    .where(eq(pipelineRuns.runId, runId));
}

/**
 * Write an error message for a failed step into the `stepErrors` JSON column.
 */
async function recordStepError(
  runId: string,
  stepName: string,
  message: string,
): Promise<void> {
  const db = await getDb();
  if (!db) return;

  await db
    .update(pipelineRuns)
    .set({
      stepErrors: sql`JSON_SET(
        COALESCE(stepErrors, '{}'),
        ${sql.raw(`'$.${stepName}'`)},
        ${message}
      )`,
    })
    .where(eq(pipelineRuns.runId, runId));
}

// ─── Main orchestrator ────────────────────────────────────────────────────────

export async function runPipeline(input: PipelineInput): Promise<PipelineRunSummary> {
  const { workspaceId, trigger } = input;
  const runId = randomUUID();
  const startedAt = new Date();

  const stepResults: Record<string, object> = {};
  const stepErrors: Record<string, string> = {};
  let stepsCompleted = 0;

  // ── 0. Insert the pipeline_runs row ────────────────────────────────────────
  const db = await getDb();
  if (db) {
    await db.insert(pipelineRuns).values({
      workspaceId,
      runId,
      status: "running",
      trigger,
      startedAt,
      stepResults: {},
      stepErrors: {},
    });
  }

  console.log(
    `[Pipeline] Run ${runId} started — trigger: ${trigger}, workspaceId: ${workspaceId}`,
  );

  // ── Generic step runner ─────────────────────────────────────────────────────
  // Returns { ok: true, result } on success or { ok: false } on failure.
  // Persists the outcome to pipeline_runs in both cases.
  async function runStep<T extends object>(
    stepName: string,
    fn: () => Promise<T>,
  ): Promise<{ ok: true; result: T } | { ok: false }> {
    console.log(`[Pipeline] Step: ${stepName} — starting`);
    try {
      const result = await fn();
      stepResults[stepName] = result;
      stepsCompleted += 1;
      await recordStepResult(runId, stepName, result);
      console.log(`[Pipeline] Step: ${stepName} — ok`, result);
      return { ok: true, result };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      stepErrors[stepName] = message;
      await recordStepError(runId, stepName, message);
      console.error(`[Pipeline] Step: ${stepName} — FAILED: ${message}`);
      return { ok: false };
    }
  }

  // ── Helper: finalise the pipeline_runs row and build the summary ────────────
  async function finalise(
    status: "completed" | "failed" | "partial",
  ): Promise<PipelineRunSummary> {
    const endedAt = new Date();
    const durationMs = endedAt.getTime() - startedAt.getTime();

    if (db) {
      await db
        .update(pipelineRuns)
        .set({ status, endedAt, durationMs, stepsCompleted })
        .where(eq(pipelineRuns.runId, runId));
    }

    console.log(
      `[Pipeline] Run ${runId} ${status.toUpperCase()} — ` +
      `${stepsCompleted}/6 steps, ${durationMs}ms`,
    );

    return {
      runId,
      status,
      trigger,
      stepsCompleted,
      stepResults,
      stepErrors,
      durationMs,
      startedAt,
      endedAt,
    };
  }

  // ── Step 1: Data Ingestion (abort on failure) ───────────────────────────────
  const ingestion = await runStep("dataIngestion", () =>
    runDataIngestion({ workspaceId }),
  );

  if (!ingestion.ok) {
    // Fatal — no data to process. Abort immediately.
    return finalise("failed");
  }

  // ── Step 2: Metrics Computation ─────────────────────────────────────────────
  await runStep("metricsComputation", () =>
    runMetricsComputation({ workspaceId }),
  );

  // ── Step 3: Baseline Engine ─────────────────────────────────────────────────
  await runStep("baselineEngine", () =>
    runBaselineEngine({ workspaceId }),
  );

  // ── Step 4: Diagnostic Engine ───────────────────────────────────────────────
  await runStep("diagnosticEngine", () =>
    runDiagnosticEngine({ workspaceId, runId }),
  );

  // ── Step 5: Recommendation Engine ──────────────────────────────────────────
  await runStep("recommendationEngine", () =>
    runRecommendationEngine({ workspaceId, runId }),
  );

  // ── Step 6: Daily Brief Engine ──────────────────────────────────────────────
  await runStep("dailyBriefEngine", () =>
    runDailyBriefEngine({ workspaceId, runId }),
  );

  // ── 7. Finalise ─────────────────────────────────────────────────────────────
  const hasErrors = Object.keys(stepErrors).length > 0;
  return finalise(hasErrors ? "partial" : "completed");
}
