/**
 * Growth OS — Data Ingestion Engine
 *
 * Fetches campaigns, ad sets, and daily insights from the Meta Graph API
 * for every active integration in the workspace, then upserts the results
 * into engine_campaigns, engine_ad_sets, and daily_metrics.
 *
 * After a successful sync the integration row is updated with:
 *   - lastSyncAt = now()
 *   - lastSyncRows = total rows upserted
 *   - lastSyncError = null
 *   - status = 'active'
 *
 * Error handling:
 *   - Meta error code 190 (token expired/invalid) → status = 'expired'
 *   - Throttling (codes 4/17/32/613/800xx) and transient 5xx → exponential
 *     back-off inside server/meta/graph.ts
 *   - Any other API error → status = 'error', lastSyncError = message, throw
 *
 * Meta Graph API version: see META_GRAPH_API_VERSION in server/meta/graph.ts
 * Insights fields pulled: impressions, clicks, spend, reach, frequency, actions
 * Leads: Meta's `lead` roll-up (falls back to instant-form + pixel leads)
 */

import { eq, and } from "drizzle-orm";
import { getDb } from "../db";
import {
  integrations,
  engineCampaigns,
  engineAdSets,
  dailyMetrics,
  type Integration,
} from "../../drizzle/schema";
import {
  graphGetAll,
  extractLeads,
  MetaApiError,
  stripActPrefix,
  type MetaAction,
} from "../meta/graph";

// ─── Constants ────────────────────────────────────────────────────────────────

/** Number of days of insights to pull on each sync. */
const SYNC_DAYS = 30;

// ─── Meta API types ───────────────────────────────────────────────────────────

type EntityStatus = "ACTIVE" | "PAUSED" | "DELETED" | "ARCHIVED";

interface MetaCampaign {
  id: string;
  name: string;
  objective?: string;
  status: EntityStatus;
  daily_budget?: string;
}

interface MetaAdSet {
  id: string;
  name: string;
  campaign_id: string;
  status: EntityStatus;
  daily_budget?: string;
}

interface MetaInsight {
  date_start: string;           // "YYYY-MM-DD"
  date_stop: string;            // "YYYY-MM-DD" (same as date_start for day breakdown)
  campaign_id?: string;
  adset_id?: string;
  impressions: string;
  clicks: string;
  spend: string;
  reach: string;
  frequency: string;
  actions?: MetaAction[];
}

// ─── Public interface ─────────────────────────────────────────────────────────

export interface DataIngestionInput {
  workspaceId: number;
}

export interface DataIngestionResult {
  integrationsProcessed: number;
  campaignsUpserted: number;
  adSetsUpserted: number;
  metricsRowsUpserted: number;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

const KNOWN_STATUSES: EntityStatus[] = ["ACTIVE", "PAUSED", "DELETED", "ARCHIVED"];
const normStatus = (s: string): EntityStatus =>
  KNOWN_STATUSES.includes(s as EntityStatus) ? (s as EntityStatus) : "PAUSED";

/** Meta returns budgets in the account currency's minor unit (cents for USD/EGP/SAR). */
const toMajorUnits = (minor?: string) =>
  minor ? (parseInt(minor, 10) / 100).toFixed(4) : null;

/**
 * Format a Date as "YYYY-MM-DD" in UTC.
 */
function toDateString(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/**
 * Parse a date value into a UTC midnight Date.
 * Accepts:
 *   - ISO string  "YYYY-MM-DD"  → parsed directly
 *   - Numeric string or number   → treated as Excel serial date
 *     (Excel epoch: 1899-12-30, serial 1 = 1900-01-01)
 */
function parseDate(s: string | number): Date {
  const n = typeof s === "number" ? s : Number(s);
  if (!isNaN(n) && !/^\d{4}-/.test(String(s))) {
    // Excel serial date: days since 1899-12-30
    const excelEpoch = new Date(Date.UTC(1899, 11, 30));
    return new Date(excelEpoch.getTime() + n * 86_400_000);
  }
  return new Date(`${s}T00:00:00.000Z`);
}

// ─── Per-integration sync ─────────────────────────────────────────────────────

async function syncIntegration(
  integration: Integration,
  workspaceId: number,
): Promise<{ campaignsUpserted: number; adSetsUpserted: number; metricsRowsUpserted: number }> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  const { accessToken, metaAccountId, id: integrationId } = integration;
  const accountRef = `act_${stripActPrefix(metaAccountId)}`;

  let campaignsUpserted = 0;
  let adSetsUpserted = 0;
  let metricsRowsUpserted = 0;

  // ── 1. Campaigns ────────────────────────────────────────────────────────────
  const metaCampaigns = await graphGetAll<MetaCampaign>(`${accountRef}/campaigns`, accessToken, {
    fields: "id,name,objective,status,daily_budget",
    limit: 200,
  });

  // Map metaCampaignId → internal engine_campaigns.id for ad set FK resolution.
  const campaignIdMap = new Map<string, number>();

  for (const c of metaCampaigns) {
    const status = normStatus(c.status);

    const values = {
      workspaceId,
      integrationId,
      metaCampaignId: c.id,
      name: c.name,
      objective: c.objective ?? null,
      status,
      dailyBudget: toMajorUnits(c.daily_budget),
    };

    await db
      .insert(engineCampaigns)
      .values(values)
      .onDuplicateKeyUpdate({
        set: {
          name: values.name,
          objective: values.objective,
          status: values.status,
          dailyBudget: values.dailyBudget,
        },
      });

    // Resolve the internal id for the FK.
    const [row] = await db
      .select({ id: engineCampaigns.id })
      .from(engineCampaigns)
      .where(eq(engineCampaigns.metaCampaignId, c.id))
      .limit(1);

    if (row) {
      campaignIdMap.set(c.id, row.id);
      campaignsUpserted += 1;
    }
  }

  // ── 2. Ad Sets ──────────────────────────────────────────────────────────────
  const metaAdSets = await graphGetAll<MetaAdSet>(`${accountRef}/adsets`, accessToken, {
    fields: "id,name,campaign_id,status,daily_budget",
    limit: 200,
  });

  // Map metaAdSetId → internal engine_ad_sets.id for metrics FK resolution.
  const adSetIdMap = new Map<string, number>();

  for (const s of metaAdSets) {
    const internalCampaignId = campaignIdMap.get(s.campaign_id);
    if (!internalCampaignId) continue; // orphaned ad set — skip

    const status = normStatus(s.status);

    const values = {
      workspaceId,
      campaignId: internalCampaignId,
      metaAdSetId: s.id,
      name: s.name,
      status,
      dailyBudget: toMajorUnits(s.daily_budget),
    };

    await db
      .insert(engineAdSets)
      .values(values)
      .onDuplicateKeyUpdate({
        set: {
          name: values.name,
          status: values.status,
          dailyBudget: values.dailyBudget,
        },
      });

    const [row] = await db
      .select({ id: engineAdSets.id })
      .from(engineAdSets)
      .where(eq(engineAdSets.metaAdSetId, s.id))
      .limit(1);

    if (row) {
      adSetIdMap.set(s.id, row.id);
      adSetsUpserted += 1;
    }
  }

  // ── 3. Daily Insights — Campaign level ──────────────────────────────────────
  const sinceDate = new Date();
  sinceDate.setDate(sinceDate.getDate() - SYNC_DAYS);
  const since = toDateString(sinceDate);
  const until = toDateString(new Date());

  const insightParams = {
    time_increment: 1,
    time_range: JSON.stringify({ since, until }),
    limit: 500,
  };

  const campaignInsights = await graphGetAll<MetaInsight>(`${accountRef}/insights`, accessToken, {
    ...insightParams,
    fields: "campaign_id,impressions,clicks,spend,reach,frequency,actions",
    level: "campaign",
  });

  for (const ins of campaignInsights) {
    const internalCampaignId = ins.campaign_id
      ? campaignIdMap.get(ins.campaign_id)
      : undefined;
    if (!internalCampaignId) continue;

    const leads = extractLeads(ins.actions);
    const impressions = parseInt(ins.impressions, 10) || 0;
    const clicks = parseInt(ins.clicks, 10) || 0;
    const spend = parseFloat(ins.spend) || 0;
    const reach = parseInt(ins.reach, 10) || 0;
    const frequency = parseFloat(ins.frequency) || 0;
    const ctr = impressions > 0 ? clicks / impressions : 0;

    await db
      .insert(dailyMetrics)
      .values({
        workspaceId,
        entityType: "campaign",
        entityId: internalCampaignId,
        date: parseDate(ins.date_start),
        impressions,
        clicks,
        spend: spend.toFixed(4),
        reach,
        frequency: frequency.toFixed(4),
        leads,
        ctr: ctr.toFixed(6),
        // cpc / cpm / cpl are left NULL — metricsComputation.ts fills them
        cpc: null,
        cpm: null,
        cpl: null,
      })
      .onDuplicateKeyUpdate({
        set: {
          impressions,
          clicks,
          spend: spend.toFixed(4),
          reach,
          frequency: frequency.toFixed(4),
          leads,
          ctr: ctr.toFixed(6),
          cpc: null,
          cpm: null,
          cpl: null,
        },
      });

    metricsRowsUpserted += 1;
  }

  // ── 4. Daily Insights — Ad Set level ────────────────────────────────────────
  const adSetInsights = await graphGetAll<MetaInsight>(`${accountRef}/insights`, accessToken, {
    ...insightParams,
    fields: "adset_id,impressions,clicks,spend,reach,frequency,actions",
    level: "adset",
  });

  for (const ins of adSetInsights) {
    const internalAdSetId = ins.adset_id
      ? adSetIdMap.get(ins.adset_id)
      : undefined;
    if (!internalAdSetId) continue;

    const leads = extractLeads(ins.actions);
    const impressions = parseInt(ins.impressions, 10) || 0;
    const clicks = parseInt(ins.clicks, 10) || 0;
    const spend = parseFloat(ins.spend) || 0;
    const reach = parseInt(ins.reach, 10) || 0;
    const frequency = parseFloat(ins.frequency) || 0;
    const ctr = impressions > 0 ? clicks / impressions : 0;

    await db
      .insert(dailyMetrics)
      .values({
        workspaceId,
        entityType: "ad_set",
        entityId: internalAdSetId,
        date: parseDate(ins.date_start),
        impressions,
        clicks,
        spend: spend.toFixed(4),
        reach,
        frequency: frequency.toFixed(4),
        leads,
        ctr: ctr.toFixed(6),
        cpc: null,
        cpm: null,
        cpl: null,
      })
      .onDuplicateKeyUpdate({
        set: {
          impressions,
          clicks,
          spend: spend.toFixed(4),
          reach,
          frequency: frequency.toFixed(4),
          leads,
          ctr: ctr.toFixed(6),
          cpc: null,
          cpm: null,
          cpl: null,
        },
      });

    metricsRowsUpserted += 1;
  }

  return { campaignsUpserted, adSetsUpserted, metricsRowsUpserted };
}

// ─── Main export ──────────────────────────────────────────────────────────────

export async function runDataIngestion(
  input: DataIngestionInput,
): Promise<DataIngestionResult> {
  const { workspaceId } = input;
  const db = await getDb();
  if (!db) throw new Error("[DataIngestion] Database not available");

  // Load all active integrations for this workspace.
  const activeIntegrations = await db
    .select()
    .from(integrations)
    .where(
      and(
        eq(integrations.workspaceId, workspaceId),
        eq(integrations.status, "active"),
      ),
    );

  if (activeIntegrations.length === 0) {
    throw new Error(
      `[DataIngestion] No active integrations found for workspaceId ${workspaceId}`,
    );
  }

  let totalCampaigns = 0;
  let totalAdSets = 0;
  let totalMetrics = 0;
  let integrationsProcessed = 0;
  const failures: unknown[] = [];

  for (const integration of activeIntegrations) {
    console.log(
      `[DataIngestion] Syncing integration ${integration.id} ` +
      `(account: ${integration.metaAccountId})`,
    );

    try {
      const { campaignsUpserted, adSetsUpserted, metricsRowsUpserted } =
        await syncIntegration(integration, workspaceId);

      totalCampaigns += campaignsUpserted;
      totalAdSets += adSetsUpserted;
      totalMetrics += metricsRowsUpserted;
      integrationsProcessed += 1;

      const totalRows = campaignsUpserted + adSetsUpserted + metricsRowsUpserted;

      // Mark sync success.
      await db
        .update(integrations)
        .set({
          status: "active",
          lastSyncAt: new Date(),
          lastSyncRows: totalRows,
          lastSyncError: null,
        })
        .where(eq(integrations.id, integration.id));

      console.log(
        `[DataIngestion] Integration ${integration.id} synced — ` +
        `campaigns: ${campaignsUpserted}, adSets: ${adSetsUpserted}, metrics: ${metricsRowsUpserted}`,
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const isTokenExpired = err instanceof MetaApiError && err.isTokenExpired;

      await db
        .update(integrations)
        .set({
          status: isTokenExpired ? "expired" : "error",
          lastSyncError: message,
        })
        .where(eq(integrations.id, integration.id));

      console.error(
        `[DataIngestion] Integration ${integration.id} FAILED: ${message}`,
      );

      // Keep syncing the remaining integrations; one bad token must not
      // block every other ad account in the workspace.
      failures.push(err);
    }
  }

  // Re-throw so the pipeline orchestrator records this as a step failure.
  if (failures.length > 0) throw failures[0];

  return {
    integrationsProcessed,
    campaignsUpserted: totalCampaigns,
    adSetsUpserted: totalAdSets,
    metricsRowsUpserted: totalMetrics,
  };
}
