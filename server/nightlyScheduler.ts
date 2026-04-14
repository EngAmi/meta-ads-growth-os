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
 * ─── Token management ─────────────────────────────────────────────────────────
 * Before each run:
 *   • Tokens expiring within 14 days are automatically extended via Meta Graph API.
 *   • Tokens expiring within 7 days (and failed to auto-renew) trigger an owner alert.
 *
 * This module does NOT affect manual "Sync Now" behaviour — runPipeline() is called
 * directly and the trigger is set to 'cron' so runs are distinguishable in the DB.
 */

import cron from "node-cron";
import { and, eq, gte, inArray, lt, lte } from "drizzle-orm";
import { getDb } from "./db";
import { integrations, metaOAuthSessions, pipelineRuns } from "../drizzle/schema";
import { runPipeline } from "./engines/pipeline";
import { notifyOwner } from "./_core/notification";

// ─── Constants ────────────────────────────────────────────────────────────────

const TWENTY_HOURS_MS = 20 * 60 * 60 * 1000;
const SEVEN_DAYS_MS   = 7  * 24 * 60 * 60 * 1000;
const FOURTEEN_DAYS_MS = 14 * 24 * 60 * 60 * 1000;

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

export async function notifyFailure(params: {
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

// ─── Meta token helpers ───────────────────────────────────────────────────────

/**
 * Attempt to extend a Meta long-lived token via the Graph API.
 * Returns the new token string on success, or null on failure.
 */
async function extendMetaToken(accessToken: string): Promise<string | null> {
  const appId     = process.env.META_APP_ID;
  const appSecret = process.env.META_APP_SECRET;
  // Skip if credentials are placeholder values
  if (!appId || !appSecret || appId === "000" || appSecret === "00") return null;
  try {
    const url = new URL("https://graph.facebook.com/v19.0/oauth/access_token");
    url.searchParams.set("grant_type",       "fb_exchange_token");
    url.searchParams.set("client_id",        appId);
    url.searchParams.set("client_secret",    appSecret);
    url.searchParams.set("fb_exchange_token", accessToken);
    const res = await fetch(url.toString());
    if (!res.ok) return null;
    const json = await res.json() as { access_token?: string };
    return json.access_token ?? null;
  } catch {
    return null;
  }
}

/**
 * Check all active integrations for expiring tokens.
 * - Tokens expiring within 14 days → attempt auto-renew via Meta Graph API.
 * - Tokens expiring within 7 days (and failed to auto-renew) → notify owner.
 */
async function manageExpiringTokens(): Promise<void> {
  const db = await getDb();
  if (!db) return;

  const now           = new Date();
  const in14Days      = new Date(now.getTime() + FOURTEEN_DAYS_MS);

  // Find all active integrations with tokens expiring within 14 days
  const expiring = await db
    .select({
      id:             integrations.id,
      workspaceId:    integrations.workspaceId,
      accessToken:    integrations.accessToken,
      tokenExpiresAt: integrations.tokenExpiresAt,
      accountName:    integrations.accountName,
      metaAccountId:  integrations.metaAccountId,
    })
    .from(integrations)
    .where(
      and(
        eq(integrations.status, "active"),
        lte(integrations.tokenExpiresAt, in14Days),
      )
    );

  if (expiring.length === 0) return;

  console.log(`[nightly-cron] Found ${expiring.length} integration(s) with tokens expiring within 14 days`);

  for (const intg of expiring) {
    const expiresAt  = intg.tokenExpiresAt ? new Date(intg.tokenExpiresAt) : null;
    const daysLeft   = expiresAt
      ? Math.ceil((expiresAt.getTime() - now.getTime()) / (1000 * 60 * 60 * 24))
      : 0;
    const label      = intg.accountName ?? `act_${intg.metaAccountId}`;

    // Attempt auto-renew
    const newToken = await extendMetaToken(intg.accessToken);
    if (newToken) {
      const newExpiry = new Date(now.getTime() + 60 * 24 * 60 * 60 * 1000); // 60 days
      await db
        .update(integrations)
        .set({ accessToken: newToken, tokenExpiresAt: newExpiry, updatedAt: new Date() })
        .where(eq(integrations.id, intg.id));
      console.log(
        `[nightly-cron] workspace=${intg.workspaceId} — token auto-renewed for "${label}" ` +
        `(was ${daysLeft}d left, new expiry ${newExpiry.toISOString().slice(0, 10)})`
      );
    } else if (daysLeft <= 7) {
      // Auto-renew failed and token expires within 7 days — alert owner
      console.warn(
        `[nightly-cron] workspace=${intg.workspaceId} — token for "${label}" expires in ${daysLeft}d, auto-renew failed`
      );
      try {
        await notifyOwner({
          title: `[Growth OS] Meta Ads token expiring in ${daysLeft}d — workspace ${intg.workspaceId}`,
          content:
            `The Meta Ads access token for account "${label}" (workspace ${intg.workspaceId}) ` +
            `will expire in ${daysLeft} day${daysLeft === 1 ? "" : "s"}.\n\n` +
            `Automatic renewal failed. Please reconnect via Data Sources → Meta Ads API → Continue with Facebook ` +
            `to avoid interruption to your nightly data sync.`,
        });
      } catch (notifyErr) {
        console.error(`[nightly-cron] Failed to send token expiry notification`, notifyErr);
      }
    } else {
      console.log(
        `[nightly-cron] workspace=${intg.workspaceId} — token for "${label}" expires in ${daysLeft}d, ` +
        `auto-renew skipped (credentials not configured)`
      );
    }
  }
}

// ─── Main runner ──────────────────────────────────────────────────────────────

export async function runNightlyPipelines(): Promise<void> {
  console.log("[nightly-cron] Starting nightly pipeline run");

  const db = await getDb();
  if (!db) {
    console.error("[nightly-cron] Database unavailable — aborting");
    return;
  }

  // 0. Manage expiring tokens (auto-renew + notify)
  await manageExpiringTokens();

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

  // Clean up expired OAuth sessions
  try {
    const result = await db
      .delete(metaOAuthSessions)
      .where(lt(metaOAuthSessions.expiresAt, new Date()));
    const deleted = (result as any)[0]?.affectedRows ?? 0;
    if (deleted > 0) {
      console.log(`[nightly-cron] Cleaned up ${deleted} expired meta_oauth_sessions`);
    }
  } catch (cleanupErr) {
    console.error("[nightly-cron] Failed to clean up expired OAuth sessions", cleanupErr);
  }
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
