/**
 * Growth OS — Daily Brief Engine
 *
 * Assembles the Daily Decision Brief from live diagnostics, recommendations,
 * and yesterday's metrics, then persists one row per day to `daily_briefs`.
 *
 * Safe to re-run: uses INSERT ... ON DUPLICATE KEY UPDATE on (workspaceId, briefDate).
 * No LLM — all reason and headline text comes from the approved templates.
 *
 * ─── Brief structure ─────────────────────────────────────────────────────────
 *
 * actionOfTheDay — highest-priority pending recommendation with confidenceScore >= 0.65
 *
 * funnelHealth — green/yellow/red per stage:
 *   ads:
 *     green  → avg CPL <= baseline_cpl × 1.10 AND no C1/C2 diagnostics active
 *     yellow → avg CPL between 1.10× and 1.35× baseline OR one C1/C2 active
 *     red    → avg CPL > 1.35× baseline OR F2 diagnostic active
 *   leads:
 *     green  → total leads last 7d >= 7d average × 0.85
 *     yellow → total leads last 7d between 0.60× and 0.85× average
 *     red    → total leads last 7d < 0.60× average OR S1 diagnostic active
 *   sales:
 *     green  → no S1 diagnostic active
 *     yellow → S1 active with severity < 70
 *     red    → S1 active with severity >= 70
 *
 * topIssues — up to 3 active diagnostics sorted by severity descending
 *
 * kpis — yesterday's account-level totals: totalSpend, totalLeads, avgCPL, activeCampaigns
 */

import { eq, and, gte, lt, desc } from "drizzle-orm";
import { getDb } from "../db";
import {
  engineDiagnostics,
  engineRecommendations,
  engineCampaigns,
  engineAdSets,
  dailyMetrics,
  baselines,
  dailyBriefs,
  type EngineDiagnostic,
  type EngineRecommendation,
  type EngineCampaign,
  type EngineAdSet,
} from "../../drizzle/schema";
import { GLOBAL_BENCHMARKS } from "./baselineEngine";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface DailyBriefEngineInput {
  workspaceId: number;
  runId: string;
}

export interface DailyBriefEngineResult {
  briefId: number;
  briefDate: string;
}

type TrafficLight = "green" | "yellow" | "red";

interface ActionOfTheDay {
  action: string;
  entityName: string;
  reason: string;
  expectedImpact: number | null;
  currency: string;
}

interface FunnelHealth {
  ads: TrafficLight;
  leads: TrafficLight;
  sales: TrafficLight;
}

interface TopIssue {
  ruleId: string;
  category: string;
  entityName: string;
  severity: number;
  headline: string;
}

interface KPIs {
  totalSpend: number;
  totalLeads: number;
  avgCPL: number;
  activeCampaigns: number;
}

// ─── Headline templates (mirrors Module 5 reason templates) ──────────────────

const HEADLINE_TEMPLATES: Record<string, (ev: Record<string, unknown>) => string> = {
  C1: (ev) => {
    const value =
      typeof ev["value"] === "number" ? ev["value"].toFixed(3) : String(ev["value"]);
    const delta =
      typeof ev["delta"] === "number" ? Math.abs(Math.round(ev["delta"] * 100)) : 0;
    return `Creative fatigue: frequency ${value}, CTR down ${delta}% vs baseline.`;
  },
  C2: (ev) => {
    const delta =
      typeof ev["delta"] === "number" ? Math.round(ev["delta"] * 100) : 0;
    return `CPM up ${delta}% with declining CTR — possible audience saturation.`;
  },
  F1: (ev) => {
    const delta =
      typeof ev["delta"] === "number" ? Math.round(ev["delta"] * 100) : 0;
    return `High CTR but CPL ${delta}% above baseline — funnel bottleneck.`;
  },
  F2: (_ev) =>
    `Significant spend with fewer than 5 leads in 7 days — CPL unsustainable.`,
  A1: (ev) => {
    const delta =
      typeof ev["delta"] === "number" ? Math.round(ev["delta"] * 100) : 0;
    return `CPL ${delta}% above baseline at scale — audience quality degrading.`;
  },
  S1: (ev) => {
    const spend =
      typeof ev["spend7d"] === "number"
        ? `$${(ev["spend7d"] as number).toFixed(2)}`
        : "significant spend";
    return `Spent ${spend} with 0 leads in 7 days — lead form or pixel likely broken.`;
  },
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

function parseDecimal(v: string | null | undefined): number | null {
  if (v === null || v === undefined) return null;
  const n = parseFloat(v);
  return isNaN(n) ? null : n;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function todayUTC(): Date {
  const d = new Date();
  d.setUTCHours(0, 0, 0, 0);
  return d;
}

function yesterdayUTC(): Date {
  const d = todayUTC();
  d.setUTCDate(d.getUTCDate() - 1);
  return d;
}

// ─── Action of the Day ────────────────────────────────────────────────────────

async function selectActionOfTheDay(
  workspaceId: number,
  runId: string,
  campaignMap: Map<number, EngineCampaign>,
  adSetMap: Map<number, EngineAdSet>,
  db: NonNullable<Awaited<ReturnType<typeof getDb>>>,
): Promise<ActionOfTheDay> {
  const recs: EngineRecommendation[] = await db
    .select()
    .from(engineRecommendations)
    .where(
      and(
        eq(engineRecommendations.workspaceId, workspaceId),
        eq(engineRecommendations.runId, runId),
        eq(engineRecommendations.status, "pending"),
      ),
    )
    .orderBy(desc(engineRecommendations.priorityScore))
    .limit(5);

  const eligible = recs.filter((r) => {
    const cs = parseDecimal(r.confidenceScore);
    return cs !== null && cs >= 0.65;
  });

  if (eligible.length === 0) {
    return {
      action: "MONITOR",
      entityName: "—",
      reason: "No high-confidence recommendations today.",
      expectedImpact: null,
      currency: "USD",
    };
  }

  const top = eligible[0];

  let entityName = `Entity #${top.entityId}`;
  if (top.entityType === "campaign") {
    const c = campaignMap.get(top.entityId);
    if (c) entityName = c.name;
  } else {
    const a = adSetMap.get(top.entityId);
    if (a) entityName = a.name;
  }

  return {
    action: top.action,
    entityName,
    reason: top.reason,
    expectedImpact: parseDecimal(top.expectedImpact),
    currency: "USD",
  };
}

// ─── Funnel Health ────────────────────────────────────────────────────────────

async function computeFunnelHealth(
  workspaceId: number,
  activeDiagnostics: EngineDiagnostic[],
  db: NonNullable<Awaited<ReturnType<typeof getDb>>>,
): Promise<FunnelHealth> {
  const today = todayUTC();

  // ── Ads stage ────────────────────────────────────────────────────────────
  const hasC1orC2 = activeDiagnostics.some(
    (d) => d.ruleId === "C1" || d.ruleId === "C2",
  );
  const hasF2 = activeDiagnostics.some((d) => d.ruleId === "F2");

  const windowStart7d = new Date(today);
  windowStart7d.setUTCDate(windowStart7d.getUTCDate() - 7);

  const metricsRows7d = await db
    .select()
    .from(dailyMetrics)
    .where(
      and(
        eq(dailyMetrics.workspaceId, workspaceId),
        gte(dailyMetrics.date, windowStart7d),
      ),
    );

  let totalSpend7d = 0;
  let totalLeads7d = 0;
  for (const row of metricsRows7d) {
    totalSpend7d += parseDecimal(row.spend) ?? 0;
    totalLeads7d += row.leads ?? 0;
  }
  const avgCPL7d = totalLeads7d > 0 ? totalSpend7d / totalLeads7d : null;

  // Resolve baseline CPL: account-level sentinel (entityId=0) or global benchmark
  const blRows = await db
    .select()
    .from(baselines)
    .where(
      and(
        eq(baselines.workspaceId, workspaceId),
        eq(baselines.metric, "cpl"),
        gte(baselines.computedAt, today),
      ),
    );

  const accountRow = blRows.find((b) => b.entityId === 0);
  const baselineCPL =
    accountRow && accountRow.sampleDays >= 3
      ? (parseDecimal(accountRow.meanValue) ?? GLOBAL_BENCHMARKS.cpl.mean)
      : GLOBAL_BENCHMARKS.cpl.mean;

  let adsStatus: TrafficLight = "green";
  if (hasF2 || (avgCPL7d !== null && avgCPL7d > baselineCPL * 1.35)) {
    adsStatus = "red";
  } else if (
    hasC1orC2 ||
    (avgCPL7d !== null && avgCPL7d > baselineCPL * 1.10)
  ) {
    adsStatus = "yellow";
  }

  // ── Leads stage ──────────────────────────────────────────────────────────
  const s1Diagnostics = activeDiagnostics.filter((d) => d.ruleId === "S1");
  const hasS1 = s1Diagnostics.length > 0;

  const sevenDaysAgo = new Date(today);
  sevenDaysAgo.setUTCDate(sevenDaysAgo.getUTCDate() - 7);
  const fourteenDaysAgo = new Date(today);
  fourteenDaysAgo.setUTCDate(fourteenDaysAgo.getUTCDate() - 14);

  const prior7Rows = await db
    .select()
    .from(dailyMetrics)
    .where(
      and(
        eq(dailyMetrics.workspaceId, workspaceId),
        gte(dailyMetrics.date, fourteenDaysAgo),
        lt(dailyMetrics.date, sevenDaysAgo),
      ),
    );
  const leadsPrior7d = prior7Rows.reduce((s, r) => s + (r.leads ?? 0), 0);

  let leadsStatus: TrafficLight = "green";
  if (hasS1 || (leadsPrior7d > 0 && totalLeads7d < leadsPrior7d * 0.60)) {
    leadsStatus = "red";
  } else if (leadsPrior7d > 0 && totalLeads7d < leadsPrior7d * 0.85) {
    leadsStatus = "yellow";
  }

  // ── Sales stage ──────────────────────────────────────────────────────────
  let salesStatus: TrafficLight = "green";
  if (hasS1) {
    const maxS1Severity = Math.max(...s1Diagnostics.map((d) => d.severity));
    salesStatus = maxS1Severity >= 70 ? "red" : "yellow";
  }

  return { ads: adsStatus, leads: leadsStatus, sales: salesStatus };
}

// ─── Top 3 Issues ─────────────────────────────────────────────────────────────

function selectTopIssues(
  activeDiagnostics: EngineDiagnostic[],
  campaignMap: Map<number, EngineCampaign>,
  adSetMap: Map<number, EngineAdSet>,
): TopIssue[] {
  const sorted = [...activeDiagnostics]
    .sort((a, b) => b.severity - a.severity)
    .slice(0, 3);

  return sorted.map((diag) => {
    let entityName = `Entity #${diag.entityId}`;
    if (diag.entityType === "campaign") {
      const c = campaignMap.get(diag.entityId);
      if (c) entityName = c.name;
    } else {
      const a = adSetMap.get(diag.entityId);
      if (a) entityName = a.name;
    }

    const evidence = (diag.evidence ?? {}) as Record<string, unknown>;
    const templateFn = HEADLINE_TEMPLATES[diag.ruleId];
    const headline = templateFn
      ? templateFn(evidence)
      : `Rule ${diag.ruleId} triggered.`;

    return {
      ruleId: diag.ruleId,
      category: diag.category,
      entityName,
      severity: diag.severity,
      headline,
    };
  });
}

// ─── KPIs ─────────────────────────────────────────────────────────────────────

async function computeKPIs(
  workspaceId: number,
  db: NonNullable<Awaited<ReturnType<typeof getDb>>>,
): Promise<KPIs> {
  const yesterday = yesterdayUTC();
  const dayAfterYesterday = new Date(yesterday);
  dayAfterYesterday.setUTCDate(dayAfterYesterday.getUTCDate() + 1);

  const yesterdayRows = await db
    .select()
    .from(dailyMetrics)
    .where(
      and(
        eq(dailyMetrics.workspaceId, workspaceId),
        gte(dailyMetrics.date, yesterday),
        lt(dailyMetrics.date, dayAfterYesterday),
      ),
    );

  let totalSpend = 0;
  let totalLeads = 0;
  for (const row of yesterdayRows) {
    totalSpend += parseDecimal(row.spend) ?? 0;
    totalLeads += row.leads ?? 0;
  }

  const avgCPL = totalLeads > 0 ? round2(totalSpend / totalLeads) : 0;

  const activeCampaignsRows = await db
    .select({ id: engineCampaigns.id })
    .from(engineCampaigns)
    .where(
      and(
        eq(engineCampaigns.workspaceId, workspaceId),
        eq(engineCampaigns.status, "ACTIVE"),
      ),
    );

  return {
    totalSpend: round2(totalSpend),
    totalLeads,
    avgCPL,
    activeCampaigns: activeCampaignsRows.length,
  };
}

// ─── Main export ──────────────────────────────────────────────────────────────

export async function runDailyBriefEngine(
  input: DailyBriefEngineInput,
): Promise<DailyBriefEngineResult> {
  const { workspaceId, runId } = input;
  const db = await getDb();
  if (!db) throw new Error("[DailyBriefEngine] Database not available");

  const today = todayUTC();
  const todayStr = today.toISOString().slice(0, 10);

  console.log(
    `[DailyBriefEngine] Starting for workspaceId ${workspaceId}, runId ${runId}, date ${todayStr}`,
  );

  // ── 1. Load active diagnostics for this run ──────────────────────────────
  const activeDiagnostics: EngineDiagnostic[] = await db
    .select()
    .from(engineDiagnostics)
    .where(
      and(
        eq(engineDiagnostics.workspaceId, workspaceId),
        eq(engineDiagnostics.runId, runId),
        eq(engineDiagnostics.status, "active"),
      ),
    )
    .orderBy(desc(engineDiagnostics.severity));

  // ── 2. Build entity name lookup maps ────────────────────────────────────
  const campaignIds = activeDiagnostics
    .filter((d) => d.entityType === "campaign")
    .map((d) => d.entityId);
  const adSetIds = activeDiagnostics
    .filter((d) => d.entityType === "ad_set")
    .map((d) => d.entityId);

  const campaignMap = new Map<number, EngineCampaign>();
  const adSetMap = new Map<number, EngineAdSet>();

  if (campaignIds.length > 0) {
    const campaigns = await db
      .select()
      .from(engineCampaigns)
      .where(eq(engineCampaigns.workspaceId, workspaceId));
    for (const c of campaigns) campaignMap.set(c.id, c);
  }

  if (adSetIds.length > 0) {
    const adSets = await db
      .select()
      .from(engineAdSets)
      .where(eq(engineAdSets.workspaceId, workspaceId));
    for (const a of adSets) adSetMap.set(a.id, a);
  }

  // ── 3. Assemble brief components ─────────────────────────────────────────
  const [actionOfTheDay, funnelHealth, kpis] = await Promise.all([
    selectActionOfTheDay(workspaceId, runId, campaignMap, adSetMap, db),
    computeFunnelHealth(workspaceId, activeDiagnostics, db),
    computeKPIs(workspaceId, db),
  ]);

  const topIssues = selectTopIssues(activeDiagnostics, campaignMap, adSetMap);

  // ── 4. Persist — INSERT ... ON DUPLICATE KEY UPDATE ──────────────────────
  await db
    .insert(dailyBriefs)
    .values({
      workspaceId,
      runId,
      briefDate: today,
      actionOfTheDay,
      funnelHealth,
      topIssues,
      kpis,
    })
    .onDuplicateKeyUpdate({
      set: {
        runId,
        actionOfTheDay,
        funnelHealth,
        topIssues,
        kpis,
        createdAt: new Date(),
      },
    });

  // ── 5. Read back the row id ───────────────────────────────────────────────
  const rows = await db
    .select({ id: dailyBriefs.id })
    .from(dailyBriefs)
    .where(
      and(
        eq(dailyBriefs.workspaceId, workspaceId),
        eq(dailyBriefs.briefDate, today),
      ),
    )
    .limit(1);

  const briefId = rows[0]?.id ?? 0;

  console.log(
    `[DailyBriefEngine] Done — briefId: ${briefId}, date: ${todayStr}, ` +
      `ads: ${funnelHealth.ads}, leads: ${funnelHealth.leads}, sales: ${funnelHealth.sales}`,
  );

  return { briefId, briefDate: todayStr };
}
