/**
 * Growth OS — Recommendation Engine
 *
 * Converts triggered diagnostics (engine_diagnostics) for the current runId
 * into structured recommendations (engine_recommendations).
 *
 * ─── Rule-to-action mapping (Build Slice v1.1) ───────────────────────────────
 *
 * | Rule | Action     | Confidence | Reason template                                                                                                  |
 * |------|------------|------------|------------------------------------------------------------------------------------------------------------------|
 * | C1   | TEST       | 0.80       | "Creative fatigue detected: frequency {value} with CTR down {delta}% vs baseline. Test new creative."           |
 * | C2   | TEST       | 0.72       | "CPM up {delta}% with declining CTR. Audience saturation likely. Test new audience segment."                     |
 * | F1   | FIX_FUNNEL | 0.78       | "High CTR but CPL {delta}% above baseline. Landing page or form is the bottleneck."                             |
 * | F2   | PAUSE      | 0.85       | "Spent {spend} with only {leads} leads in 7 days. CPL unsustainable. Pause and diagnose."                        |
 * | A1   | TEST       | 0.70       | "CPL {delta}% above baseline at scale. Audience quality degrading. Test lookalike or interest exclusion."        |
 * | S1   | PAUSE      | 0.88       | "Spent {spend7d} with 0 leads in 7 days ({impressions7d} impressions). Lead form or pixel event is likely broken. Pause and audit the form." |
 *
 * ─── Priority score formula ───────────────────────────────────────────────────
 *   priorityScore = severity × confidenceScore × (dailyBudget / 100)
 *   dailyBudget is the entity's daily budget in USD. Defaults to 100 when unavailable.
 *
 * ─── Deduplication ────────────────────────────────────────────────────────────
 *   Skip if a recommendation for the same (entityId, action, ruleId) already
 *   exists with status = 'pending' and createdAt > 7 days ago.
 *
 * ─── Expiry ───────────────────────────────────────────────────────────────────
 *   expiresAt = NOW() + 72 hours
 */

import { eq, and, gt, inArray } from "drizzle-orm";
import { getDb } from "../db";
import {
  engineDiagnostics,
  engineRecommendations,
  engineCampaigns,
  engineAdSets,
  type EngineDiagnostic,
  type EngineCampaign,
  type EngineAdSet,
} from "../../drizzle/schema";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface RecommendationEngineInput {
  workspaceId: number;
  runId: string;
}

export interface RecommendationEngineResult {
  recommendationsCreated: number;
  duplicatesSkipped: number;
}

type RecAction = "PAUSE" | "SCALE" | "TEST" | "MONITOR" | "FIX_FUNNEL" | "FIX_SALES";

interface RuleSpec {
  action: RecAction;
  confidence: number;
  buildReason: (evidence: Record<string, unknown>) => string;
}

// ─── Rule definitions ─────────────────────────────────────────────────────────

const RULE_SPECS: Record<string, RuleSpec> = {
  C1: {
    action: "TEST",
    confidence: 0.80,
    buildReason: (ev) => {
      const value =
        typeof ev["value"] === "number" ? ev["value"].toFixed(3) : String(ev["value"]);
      const delta =
        typeof ev["delta"] === "number" ? Math.abs(Math.round(ev["delta"] * 100)) : 0;
      return `Creative fatigue detected: frequency ${value} with CTR down ${delta}% vs baseline. Test new creative.`;
    },
  },
  C2: {
    action: "TEST",
    confidence: 0.72,
    buildReason: (ev) => {
      const delta =
        typeof ev["delta"] === "number" ? Math.round(ev["delta"] * 100) : 0;
      return `CPM up ${delta}% with declining CTR. Audience saturation likely. Test new audience segment.`;
    },
  },
  F1: {
    action: "FIX_FUNNEL",
    confidence: 0.78,
    buildReason: (ev) => {
      const delta =
        typeof ev["delta"] === "number" ? Math.round(ev["delta"] * 100) : 0;
      return `High CTR but CPL ${delta}% above baseline. Landing page or form is the bottleneck.`;
    },
  },
  F2: {
    action: "PAUSE",
    confidence: 0.85,
    buildReason: (ev) => {
      const spend =
        typeof ev["threshold"] === "number"
          ? `$${(ev["threshold"] as number).toFixed(0)}+`
          : "significant spend";
      const leads =
        typeof ev["value"] === "number" && ev["value"] === 0 ? "0" : "fewer than 5";
      return `Spent ${spend} with only ${leads} leads in 7 days. CPL unsustainable. Pause and diagnose.`;
    },
  },
  A1: {
    action: "TEST",
    confidence: 0.70,
    buildReason: (ev) => {
      const delta =
        typeof ev["delta"] === "number" ? Math.round(ev["delta"] * 100) : 0;
      return `CPL ${delta}% above baseline at scale. Audience quality degrading. Test lookalike or interest exclusion.`;
    },
  },
  S1: {
    action: "PAUSE",
    confidence: 0.88,
    buildReason: (ev) => {
      const spend =
        typeof ev["spend7d"] === "number"
          ? `$${(ev["spend7d"] as number).toFixed(2)}`
          : "significant spend";
      const impressions =
        typeof ev["impressions7d"] === "number"
          ? (ev["impressions7d"] as number).toLocaleString()
          : "many";
      return (
        `Spent ${spend} with 0 leads in 7 days (${impressions} impressions). ` +
        `Lead form or pixel event is likely broken. Pause and audit the form.`
      );
    },
  },
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

function parseDecimal(v: string | null | undefined): number | null {
  if (v === null || v === undefined) return null;
  const n = parseFloat(v);
  return isNaN(n) ? null : n;
}

/**
 * Compute priority score.
 * priorityScore = severity × confidenceScore × (dailyBudget / 100)
 * dailyBudget defaults to 100 when unavailable.
 */
function computePriorityScore(
  severity: number,
  confidence: number,
  dailyBudget: number | null,
): number {
  const budget = dailyBudget !== null && dailyBudget > 0 ? dailyBudget : 100;
  return Math.round(severity * confidence * (budget / 100) * 100) / 100;
}

// ─── Main export ──────────────────────────────────────────────────────────────

export async function runRecommendationEngine(
  input: RecommendationEngineInput,
): Promise<RecommendationEngineResult> {
  const { workspaceId, runId } = input;
  const db = await getDb();
  if (!db) throw new Error("[RecommendationEngine] Database not available");

  console.log(
    `[RecommendationEngine] Starting for workspaceId ${workspaceId}, runId ${runId}`,
  );

  // ── 1. Load diagnostics created in this run ──────────────────────────────
  const diagnostics: EngineDiagnostic[] = await db
    .select()
    .from(engineDiagnostics)
    .where(
      and(
        eq(engineDiagnostics.workspaceId, workspaceId),
        eq(engineDiagnostics.runId, runId),
        eq(engineDiagnostics.status, "active"),
      ),
    );

  if (diagnostics.length === 0) {
    console.log("[RecommendationEngine] No active diagnostics for this run.");
    return { recommendationsCreated: 0, duplicatesSkipped: 0 };
  }

  // ── 2. Load daily budgets for all entities referenced by diagnostics ─────
  const campaignIds = diagnostics
    .filter((d) => d.entityType === "campaign")
    .map((d) => d.entityId);
  const adSetIds = diagnostics
    .filter((d) => d.entityType === "ad_set")
    .map((d) => d.entityId);

  const campaignMap = new Map<number, EngineCampaign>();
  const adSetMap = new Map<number, EngineAdSet>();

  if (campaignIds.length > 0) {
    const campaigns: EngineCampaign[] = await db
      .select()
      .from(engineCampaigns)
      .where(inArray(engineCampaigns.id, campaignIds));
    for (const c of campaigns) campaignMap.set(c.id, c);
  }

  if (adSetIds.length > 0) {
    const adSets: EngineAdSet[] = await db
      .select()
      .from(engineAdSets)
      .where(inArray(engineAdSets.id, adSetIds));
    for (const a of adSets) adSetMap.set(a.id, a);

    // Also load parent campaigns for ad sets (needed for budget fallback)
    const parentCampaignIds = Array.from(new Set(adSets.map((a) => a.campaignId)));
    if (parentCampaignIds.length > 0) {
      const parentCampaigns: EngineCampaign[] = await db
        .select()
        .from(engineCampaigns)
        .where(inArray(engineCampaigns.id, parentCampaignIds));
      for (const c of parentCampaigns) {
        if (!campaignMap.has(c.id)) campaignMap.set(c.id, c);
      }
    }
  }

  // ── 3. Load existing pending recommendations for deduplication ───────────
  // Dedup window: status = 'pending' AND createdAt > 7 days ago.
  const sevenDaysAgo = new Date();
  sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

  const existingPending = await db
    .select({
      entityId: engineRecommendations.entityId,
      action: engineRecommendations.action,
      ruleId: engineRecommendations.ruleId,
    })
    .from(engineRecommendations)
    .where(
      and(
        eq(engineRecommendations.workspaceId, workspaceId),
        eq(engineRecommendations.status, "pending"),
        gt(engineRecommendations.createdAt, sevenDaysAgo),
      ),
    );

  // Build a dedup set: "entityId:action:ruleId"
  const dedupSet = new Set<string>();
  for (const r of existingPending) {
    dedupSet.add(`${r.entityId}:${r.action}:${r.ruleId}`);
  }

  // ── 4. Process each diagnostic ───────────────────────────────────────────
  const now = new Date();
  const expiresAt = new Date(now.getTime() + 72 * 60 * 60 * 1000); // +72 hours

  let recommendationsCreated = 0;
  let duplicatesSkipped = 0;

  for (const diag of diagnostics) {
    const spec = RULE_SPECS[diag.ruleId];
    if (!spec) {
      console.warn(
        `[RecommendationEngine] No spec for ruleId ${diag.ruleId} — skipping`,
      );
      continue;
    }

    // Deduplication check
    const dedupKey = `${diag.entityId}:${spec.action}:${diag.ruleId}`;
    if (dedupSet.has(dedupKey)) {
      duplicatesSkipped += 1;
      continue;
    }

    // Resolve daily budget for priority score
    let dailyBudget: number | null = null;
    if (diag.entityType === "campaign") {
      const campaign = campaignMap.get(diag.entityId);
      if (campaign) dailyBudget = parseDecimal(campaign.dailyBudget);
    } else {
      const adSet = adSetMap.get(diag.entityId);
      if (adSet) {
        dailyBudget = parseDecimal(adSet.dailyBudget);
        // Fall back to parent campaign budget if ad set has no own budget
        if (dailyBudget === null) {
          const parentCampaign = campaignMap.get(adSet.campaignId);
          if (parentCampaign) dailyBudget = parseDecimal(parentCampaign.dailyBudget);
        }
      }
    }

    const confidence = spec.confidence;
    const priorityScore = computePriorityScore(diag.severity, confidence, dailyBudget);

    // Build reason string from evidence
    const evidence = (diag.evidence ?? {}) as Record<string, unknown>;
    const reason = spec.buildReason(evidence).slice(0, 512); // enforce column length

    await db.insert(engineRecommendations).values({
      workspaceId,
      runId,
      diagnosticId: diag.id,
      action: spec.action,
      entityType: diag.entityType,
      entityId: diag.entityId,
      ruleId: diag.ruleId,
      reason,
      evidence,
      confidenceScore: confidence.toFixed(3),
      priorityScore: priorityScore.toFixed(2),
      expectedImpact: null,
      status: "pending",
      expiresAt,
    });

    // Register in dedup set so a second diagnostic in the same run for the
    // same entity+action+rule does not create a duplicate row.
    dedupSet.add(dedupKey);
    recommendationsCreated += 1;
  }

  console.log(
    `[RecommendationEngine] Done — created: ${recommendationsCreated}, ` +
    `duplicates skipped: ${duplicatesSkipped}`,
  );

  return { recommendationsCreated, duplicatesSkipped };
}
