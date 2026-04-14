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
 *   - Rate limit (error code 17 / 80000 / 80003 / 80004 / 80005 / 80006 / 80008)
 *     → exponential back-off with up to MAX_RETRIES attempts
 *   - Any other API error → status = 'error', lastSyncError = message, throw
 *
 * Meta Graph API version: v19.0
 * Insights fields pulled: impressions, clicks, spend, reach, frequency, actions
 * Action type mapped to leads: 'lead', 'onsite_conversion.lead_grouped'
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

// ─── Constants ────────────────────────────────────────────────────────────────

const GRAPH_API_VERSION = "v19.0";
const GRAPH_API_BASE = `https://graph.facebook.com/${GRAPH_API_VERSION}`;

/** Number of days of insights to pull on each sync. */
const SYNC_DAYS = 30;

/** Maximum retry attempts on rate-limit responses. */
const MAX_RETRIES = 4;

/** Initial back-off delay in milliseconds (doubles on each retry). */
const INITIAL_BACKOFF_MS = 2_000;

/**
 * Meta API error codes that indicate a rate-limit condition.
 * https://developers.facebook.com/docs/graph-api/overview/rate-limiting/
 */
const RATE_LIMIT_CODES = new Set([17, 80000, 80003, 80004, 80005, 80006, 80008]);

/** Meta API error code for an expired or invalid access token. */
const TOKEN_EXPIRED_CODE = 190;

// ─── Meta API types ───────────────────────────────────────────────────────────

interface MetaApiError {
  message: string;
  type: string;
  code: number;
  error_subcode?: number;
  fbtrace_id?: string;
}

interface MetaApiResponse<T> {
  data?: T[];
  error?: MetaApiError;
  paging?: {
    cursors?: { before: string; after: string };
    next?: string;
  };
}

interface MetaCampaign {
  id: string;
  name: string;
  objective?: string;
  status: "ACTIVE" | "PAUSED" | "DELETED" | "ARCHIVED";
  daily_budget?: string;
}

interface MetaAdSet {
  id: string;
  name: string;
  campaign_id: string;
  status: "ACTIVE" | "PAUSED" | "DELETED" | "ARCHIVED";
  daily_budget?: string;
}

interface MetaInsightAction {
  action_type: string;
  value: string;
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
  actions?: MetaInsightAction[];
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

/** Sleep for `ms` milliseconds. */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Fetch a single Meta Graph API URL with automatic retry on rate-limit errors.
 * Throws a typed error on token expiry (code 190) or after exhausting retries.
 */
async function metaFetch<T>(
  url: string,
  attempt = 0,
): Promise<MetaApiResponse<T>> {
  const res = await fetch(url);
  const body = (await res.json()) as MetaApiResponse<T>;

  if (body.error) {
    const { code, message } = body.error;

    // Token expired — surface immediately, no retry.
    if (code === TOKEN_EXPIRED_CODE) {
      const err = new Error(`Meta token expired (code 190): ${message}`);
      (err as NodeJS.ErrnoException).code = "META_TOKEN_EXPIRED";
      throw err;
    }

    // Rate limit — back off and retry.
    if (RATE_LIMIT_CODES.has(code)) {
      if (attempt >= MAX_RETRIES) {
        throw new Error(
          `Meta rate limit exceeded after ${MAX_RETRIES} retries (code ${code}): ${message}`,
        );
      }
      const delay = INITIAL_BACKOFF_MS * Math.pow(2, attempt);
      console.warn(
        `[DataIngestion] Rate limit (code ${code}), retrying in ${delay}ms (attempt ${attempt + 1}/${MAX_RETRIES})`,
      );
      await sleep(delay);
      return metaFetch<T>(url, attempt + 1);
    }

    // Any other API error.
    throw new Error(`Meta API error (code ${code}): ${message}`);
  }

  return body;
}

/**
 * Paginate through all pages of a Meta Graph API endpoint and collect every
 * item from the `data` array.
 */
async function metaFetchAll<T>(firstUrl: string): Promise<T[]> {
  const items: T[] = [];
  let url: string | undefined = firstUrl;

  while (url) {
    const page: MetaApiResponse<T> = await metaFetch<T>(url);
    if (page.data) {
      items.push(...page.data);
    }
    url = page.paging?.next;
  }

  return items;
}

/**
 * Sum the `value` of all actions whose `action_type` maps to a lead event.
 */
function extractLeads(actions?: MetaInsightAction[]): number {
  if (!actions) return 0;
  const LEAD_TYPES = new Set(["lead", "onsite_conversion.lead_grouped"]);
  return actions
    .filter((a) => LEAD_TYPES.has(a.action_type))
    .reduce((sum, a) => sum + (parseInt(a.value, 10) || 0), 0);
}

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
  const accountRef = `act_${metaAccountId}`;

  let campaignsUpserted = 0;
  let adSetsUpserted = 0;
  let metricsRowsUpserted = 0;

  // ── 1. Campaigns ────────────────────────────────────────────────────────────
  const campaignFields = "id,name,objective,status,daily_budget";
  const campaignUrl =
    `${GRAPH_API_BASE}/${accountRef}/campaigns` +
    `?fields=${campaignFields}` +
    `&limit=200` +
    `&access_token=${accessToken}`;

  const metaCampaigns = await metaFetchAll<MetaCampaign>(campaignUrl);

  // Map metaCampaignId → internal engine_campaigns.id for ad set FK resolution.
  const campaignIdMap = new Map<string, number>();

  for (const c of metaCampaigns) {
    const status = (["ACTIVE", "PAUSED", "DELETED", "ARCHIVED"].includes(c.status)
      ? c.status
      : "PAUSED") as "ACTIVE" | "PAUSED" | "DELETED" | "ARCHIVED";

    const values = {
      workspaceId,
      integrationId,
      metaCampaignId: c.id,
      name: c.name,
      objective: c.objective ?? null,
      status,
      dailyBudget: c.daily_budget
        ? (parseInt(c.daily_budget, 10) / 100).toFixed(4)
        : null,
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
  const adSetFields = "id,name,campaign_id,status,daily_budget";
  const adSetUrl =
    `${GRAPH_API_BASE}/${accountRef}/adsets` +
    `?fields=${adSetFields}` +
    `&limit=200` +
    `&access_token=${accessToken}`;

  const metaAdSets = await metaFetchAll<MetaAdSet>(adSetUrl);

  // Map metaAdSetId → internal engine_ad_sets.id for metrics FK resolution.
  const adSetIdMap = new Map<string, number>();

  for (const s of metaAdSets) {
    const internalCampaignId = campaignIdMap.get(s.campaign_id);
    if (!internalCampaignId) continue; // orphaned ad set — skip

    const status = (["ACTIVE", "PAUSED", "DELETED", "ARCHIVED"].includes(s.status)
      ? s.status
      : "PAUSED") as "ACTIVE" | "PAUSED" | "DELETED" | "ARCHIVED";

    const values = {
      workspaceId,
      campaignId: internalCampaignId,
      metaAdSetId: s.id,
      name: s.name,
      status,
      dailyBudget: s.daily_budget
        ? (parseInt(s.daily_budget, 10) / 100).toFixed(4)
        : null,
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

  const insightFields =
    "campaign_id,impressions,clicks,spend,reach,frequency,actions";
  const campaignInsightUrl =
    `${GRAPH_API_BASE}/${accountRef}/insights` +
    `?fields=${insightFields}` +
    `&level=campaign` +
    `&time_increment=1` +
    `&time_range=${encodeURIComponent(JSON.stringify({ since, until }))}` +
    `&limit=500` +
    `&access_token=${accessToken}`;

  const campaignInsights = await metaFetchAll<MetaInsight>(campaignInsightUrl);

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
  const adSetInsightUrl =
    `${GRAPH_API_BASE}/${accountRef}/insights` +
    `?fields=adset_id,impressions,clicks,spend,reach,frequency,actions` +
    `&level=adset` +
    `&time_increment=1` +
    `&time_range=${encodeURIComponent(JSON.stringify({ since, until }))}` +
    `&limit=500` +
    `&access_token=${accessToken}`;

  const adSetInsights = await metaFetchAll<MetaInsight>(adSetInsightUrl);

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
      const isTokenExpired =
        err instanceof Error &&
        (err as NodeJS.ErrnoException).code === "META_TOKEN_EXPIRED";

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

      // Re-throw so the pipeline orchestrator records this as a step failure.
      throw err;
    }
  }

  return {
    integrationsProcessed,
    campaignsUpserted: totalCampaigns,
    adSetsUpserted: totalAdSets,
    metricsRowsUpserted: totalMetrics,
  };
}
