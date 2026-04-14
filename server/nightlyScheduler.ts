/**
 * Growth OS — Nightly Pipeline Scheduler
 *
 * Schedules the engine pipeline to run automatically at midnight (server local time)
 * for every workspace that has an active Meta Ads integration.
 *
 * Duplicate-run protection: if a successful run (status = 'completed' or 'partial')
 * already exists for a workspace within the last 20 hours, that workspace is skipped.
 *
 * This module does NOT affect manual "Sync Now" behaviour — runPipeline() is called
 * directly and the trigger is set to 'cron' so runs are distinguishable in the DB.
 */

import cron from "node-cron";
import { and, eq, gte, inArray } from "drizzle-orm";
import { getDb } from "./db";
import { integrations, pipelineRuns } from "../drizzle/schema";
import { runPipeline } from "./engines/pipeline";

const TWENTY_HOURS_MS = 20 * 60 * 60 * 1000;

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

  const workspaceIds = Array.from(new Set(activeIntegrations.map((r: { workspaceId: number }) => r.workspaceId)));
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
        console.error(
          `[nightly-cron] workspace=${workspaceId} — failed` +
          ` | errors=${JSON.stringify(result.stepErrors)}`
        );
      } else {
        console.log(
          `[nightly-cron] workspace=${workspaceId} — completed` +
          ` | status=${result.status} stepsCompleted=${result.stepsCompleted}` +
          ` | durationMs=${result.durationMs}`
        );
      }
    } catch (err) {
      console.error(
        `[nightly-cron] workspace=${workspaceId} — failed (unhandled exception)`,
        err
      );
    }
  }

  console.log("[nightly-cron] Nightly pipeline run finished");
}

/**
 * Register the nightly cron job.
 * Call once from the server entry point after the DB connection is ready.
 */
export function registerNightlyScheduler(): void {
  // Run at 00:00:00 every day (server local time)
  cron.schedule("0 0 * * *", () => {
    runNightlyPipelines().catch(err => {
      console.error("[nightly-cron] Unhandled error in nightly pipeline runner", err);
    });
  });

  console.log("[nightly-cron] Nightly pipeline scheduler registered (runs at 00:00 daily)");
}
