/**
 * Growth OS — Nightly Pipeline Scheduler
 *
 * Schedules the engine pipeline to run automatically at midnight (server local time)
 * for every workspace that has an active Meta Ads integration.
 *
 * ─── Configuration ────────────────────────────────────────────────────────────
 * CRON_SCHEDULE  (env var, optional)
 *   Standard 5-field cron expression controlling when the nightly job fires.
 *   Default: "0 0 * * *"  (midnight every day, server local time)
 *   Example overrides:
 *     "0 3 * * *"   → 3:00 AM every day
 *     "0 0 * * 1-5" → midnight on weekdays only
 *
 * ─── Duplicate-run protection ─────────────────────────────────────────────────
 * If a successful run (status = 'completed' or 'partial') already exists for a
 * workspace within the last 20 hours, that workspace is skipped.
 *
 * ─── Failure notifications ────────────────────────────────────────────────────
 * If a cron-triggered pipeline run fails (status = 'failed' or unhandled exception),
 * the workspace owner is notified via notifyOwner(). Notification failures are
 * logged but do not affect the scheduler's own error handling.
 *
 * This module does NOT affect manual "Sync Now" behaviour — runPipeline() is called
 * directly and the trigger is set to 'cron' so runs are distinguishable in the DB.
 */

import cron from "node-cron";
import { and, eq, gte, inArray } from "drizzle-orm";
import { getDb } from "./db";
import { integrations, pipelineRuns } from "../drizzle/schema";
import { runPipeline } from "./engines/pipeline";
import { notifyOwner } from "./_core/notification";

// ─── Constants ────────────────────────────────────────────────────────────────

const TWENTY_HOURS_MS = 20 * 60 * 60 * 1000;

/**
 * Cron expression read from CRON_SCHEDULE env var.
 * Falls back to "0 0 * * *" (midnight daily) if the variable is absent or invalid.
 */
const DEFAULT_CRON_SCHEDULE = "0 0 * * *";

export function resolveCronSchedule(): string {
  const envVal = process.env.CRON_SCHEDULE?.trim();
  if (!envVal) return DEFAULT_CRON_SCHEDULE;
  if (!cron.validate(envVal)) {
    console.warn(
      `[nightly-cron] CRON_SCHEDULE="${envVal}" is invalid — falling back to default "${DEFAULT_CRON_SCHEDULE}"`
    );
    return DEFAULT_CRON_SCHEDULE;
  }
  return envVal;
}

// ─── Failure notification helper ──────────────────────────────────────────────

async function notifyFailure(params: {
  workspaceId: number;
  runId?: string;
  summary: string;
}): Promise<void> {
  const { workspaceId, runId, summary } = params;
  try {
    await notifyOwner({
      title: `[Growth OS] Nightly pipeline failed — workspace ${workspaceId}`,
      content:
        `The nightly cron pipeline failed for workspace ${workspaceId}.\n\n` +
        (runId ? `Run ID: ${runId}\n` : "") +
        `Failure summary: ${summary}`,
    });
  } catch (notifyErr) {
    // Notification failure must never propagate — just log it.
    console.error(
      `[nightly-cron] workspace=${workspaceId} — owner notification failed`,
      notifyErr
    );
  }
}

// ─── Main runner ──────────────────────────────────────────────────────────────

async function runNightlyPipelines(): Promise<void> {
  console.log("[nightly-cron] Starting nightly pipeline run");

  const db = await getDb();
  if (!db) {
    console.error("[nightly-cron] Database unavailable — aborting");
    return;
  }

  // 1. Fetch all workspaces with at least one active integration
  const activeIntegrations = await db
    .select({ workspaceId: integrations.workspaceId })
    .from(integrations)
    .where(eq(integrations.status, "active"));

  if (activeIntegrations.length === 0) {
    console.log("[nightly-cron] No active integrations found — nothing to run");
    return;
  }

  const workspaceIds = Array.from(
    new Set(activeIntegrations.map((r: { workspaceId: number }) => r.workspaceId))
  );
  console.log(`[nightly-cron] Found ${workspaceIds.length} workspace(s) with active integrations`);

  // 2. Find workspaces that already have a successful run in the last 20 hours
  const cutoff = new Date(Date.now() - TWENTY_HOURS_MS);

  const recentRuns = await db
    .select({ workspaceId: pipelineRuns.workspaceId })
    .from(pipelineRuns)
    .where(
      and(
        inArray(pipelineRuns.workspaceId, workspaceIds),
        inArray(pipelineRuns.status, ["completed", "partial"]),
        gte(pipelineRuns.startedAt, cutoff),
      )
    );

  const alreadyRan = new Set(recentRuns.map((r: { workspaceId: number }) => r.workspaceId));

  // 3. Run the pipeline for each eligible workspace sequentially
  for (const workspaceId of workspaceIds) {
    if (alreadyRan.has(workspaceId)) {
      console.log(`[nightly-cron] workspace=${workspaceId} — skipped (successful run within last 20 h)`);
      continue;
    }

    console.log(`[nightly-cron] workspace=${workspaceId} — started`);

    try {
      const result = await runPipeline({ workspaceId, trigger: "cron" });

      if (result.status === "failed") {
        const errEntries = result.stepErrors ? Object.entries(result.stepErrors as Record<string, string>) : [];
        const summary = errEntries.length
          ? errEntries.map(([step, err]) => `${step}: ${err}`).join("; ")
          : "pipeline returned failed status";

        console.error(
          `[nightly-cron] workspace=${workspaceId} — failed` +
          ` | runId=${result.runId} | errors=${JSON.stringify(result.stepErrors)}`
        );

        // Notify owner on cron failure only
        await notifyFailure({ workspaceId, runId: result.runId, summary });
      } else {
        console.log(
          `[nightly-cron] workspace=${workspaceId} — completed` +
          ` | status=${result.status} stepsCompleted=${result.stepsCompleted}` +
          ` | durationMs=${result.durationMs}`
        );
      }
    } catch (err) {
      const summary = err instanceof Error ? err.message : String(err);

      console.error(
        `[nightly-cron] workspace=${workspaceId} — failed (unhandled exception)`,
        err
      );

      // Notify owner on unhandled exception
      await notifyFailure({ workspaceId, summary });
    }
  }

  console.log("[nightly-cron] Nightly pipeline run finished");
}

// ─── Registration ─────────────────────────────────────────────────────────────

/**
 * Register the nightly cron job.
 * Call once from the server entry point after the DB connection is ready.
 *
 * The schedule is read from the CRON_SCHEDULE environment variable.
 * Default: "0 0 * * *" (midnight every day, server local time).
 */
export function registerNightlyScheduler(): void {
  const schedule = resolveCronSchedule();

  cron.schedule(schedule, () => {
    runNightlyPipelines().catch(err => {
      console.error("[nightly-cron] Unhandled error in nightly pipeline runner", err);
    });
  });

  console.log(
    `[nightly-cron] Nightly pipeline scheduler registered` +
    ` (schedule="${schedule}"` +
    `${schedule === DEFAULT_CRON_SCHEDULE ? " [default]" : " [from CRON_SCHEDULE env]"})`
  );
}
