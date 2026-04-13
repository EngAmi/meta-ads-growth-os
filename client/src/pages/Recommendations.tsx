import { trpc } from "@/lib/trpc";
import { PageHeader } from "@/components/ui/PageHeader";
import { PriorityBadge, StatusBadge } from "@/components/ui/StatusBadge";
import { Lightbulb, DollarSign, CheckCircle, Clock, XCircle, Sparkles, TrendingUp, AlertTriangle, Zap } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { useAuth } from "@/_core/hooks/useAuth";

// ── Rule-to-category lookup for engine recommendations ─────────────────────────
const RULE_CATEGORY: Record<string, keyof typeof categoryConfig> = {
  C1: "ads",
  C2: "ads",
  F1: "funnel",
  F2: "funnel",
  A1: "ads",
  S1: "funnel",
};

// Derive a legacy-compatible priority label from a numeric priorityScore
function scoreToPriority(score: number): string {
  if (score >= 8000) return "critical";
  if (score >= 3000) return "high";
  if (score >= 1000) return "medium";
  return "low";
}

const categoryConfig = {
  ads: { label: "Ads", color: "oklch(0.62 0.19 258)", bg: "oklch(0.62 0.19 258 / 0.1)", icon: "📢" },
  leads: { label: "Leads", color: "oklch(0.68 0.18 305)", bg: "oklch(0.68 0.18 305 / 0.1)", icon: "👥" },
  sales: { label: "Sales", color: "oklch(0.82 0.17 85)", bg: "oklch(0.82 0.17 85 / 0.1)", icon: "🎯" },
  funnel: { label: "Funnel", color: "oklch(0.72 0.16 162)", bg: "oklch(0.72 0.16 162 / 0.1)", icon: "🔻" },
};

const priorityOrder = { critical: 0, high: 1, medium: 2, low: 3 };

export default function Recommendations() {
  const { data: recs, refetch } = trpc.recommendations.list.useQuery();
  const { data: aiInsights, isLoading: aiLoading } = trpc.recommendations.generateAI.useQuery();
  const updateStatus = trpc.recommendations.updateStatus.useMutation({
    onSuccess: () => { refetch(); toast.success("Status updated"); },
    onError: () => toast.error("Failed to update status"),
  });
  const { isAuthenticated } = useAuth();
  const [filter, setFilter] = useState<string>("all");
  const [categoryFilter, setCategoryFilter] = useState<string>("all");

  // ── Engine recommendations ─────────────────────────────────────────────────
  const utils = trpc.useUtils();
  const { data: engineRecsResult } = trpc.engineRecommendations.list.useQuery({ status: "pending" });
  const engineRecs: any[] = (engineRecsResult as any)?.data ?? [];
  const useEngineData = engineRecs.length > 0;

  const acceptRec = trpc.engineRecommendations.accept.useMutation({
    onSuccess: () => {
      utils.engineRecommendations.list.invalidate();
      toast.success("Recommendation accepted");
    },
    onError: () => toast.error("Failed to accept recommendation"),
  });
  const dismissRec = trpc.engineRecommendations.dismiss.useMutation({
    onSuccess: () => {
      utils.engineRecommendations.list.invalidate();
      toast.success("Recommendation dismissed");
    },
    onError: () => toast.error("Failed to dismiss recommendation"),
  });

  // Normalise engine recs into the legacy card shape
  const normalizedEngineRecs: any[] = useEngineData
    ? engineRecs.map((r: any) => ({
        id: r.id,
        _isEngine: true,
        title: r.action,
        problem: r.reason,
        reason: r.reason,
        action: r.action,
        category: RULE_CATEGORY[r.ruleId] ?? "funnel",
        priority: scoreToPriority(Number(r.priorityScore ?? 0)),
        estimatedImpact: r.expectedImpact ?? null,
        status: "pending",
        confidenceScore: r.confidenceScore,
        ruleId: r.ruleId,
        entityName: r.entityName ?? null,
      }))
    : [];

  // Merge: engine takes precedence when available, legacy fills in otherwise
  const mergedRecs = useEngineData ? normalizedEngineRecs : (recs || []);

  const filtered = mergedRecs
    .filter((r: any) => filter === "all" || r.status === filter)
    .filter((r: any) => categoryFilter === "all" || r.category === categoryFilter)
    .sort((a: any, b: any) => {
      const pa = priorityOrder[a.priority as keyof typeof priorityOrder] ?? 4;
      const pb = priorityOrder[b.priority as keyof typeof priorityOrder] ?? 4;
      if (pa !== pb) return pa - pb;
      return Number(b.estimatedImpact || 0) - Number(a.estimatedImpact || 0);
    });

  const totalImpact = mergedRecs
    .filter((r: any) => r.status === "pending")
    .reduce((s: number, r: any) => s + Number(r.estimatedImpact || 0), 0);

  const criticalCount = mergedRecs.filter((r: any) => r.priority === "critical" && r.status === "pending").length;

  return (
    <div className="p-6 space-y-6 max-w-[1600px] mx-auto">
      <PageHeader
        title="AI Recommendation Engine"
        description="Prioritized actionable insights to maximize growth"
        icon={Lightbulb}
      >
        <div className="flex items-center gap-3">
          {criticalCount > 0 && (
            <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-[oklch(0.65_0.22_25/0.12)] border border-[oklch(0.65_0.22_25/0.25)]">
              <AlertTriangle className="h-3.5 w-3.5 text-[oklch(0.65_0.22_25)]" />
              <span className="text-xs font-medium text-[oklch(0.65_0.22_25)]">{criticalCount} critical</span>
            </div>
          )}
          <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-[oklch(0.72_0.16_162/0.12)] border border-[oklch(0.72_0.16_162/0.25)]">
            <TrendingUp className="h-3.5 w-3.5 text-[oklch(0.72_0.16_162)]" />
            <span className="text-xs font-medium text-[oklch(0.72_0.16_162)]">${totalImpact.toLocaleString()} potential</span>
          </div>
        </div>
      </PageHeader>

      {/* AI Insights Panel */}
      <div className="rounded-xl border border-primary/20 bg-primary/5 p-5">
        <div className="flex items-center gap-2 mb-4">
          <Sparkles className="h-4 w-4 text-primary" />
          <h2 className="text-sm font-semibold text-foreground">AI-Generated Insights</h2>
          {aiLoading && <span className="text-xs text-muted-foreground animate-pulse">Analyzing data...</span>}
        </div>
        {aiInsights?.insights && (
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {aiInsights.insights.map((insight: any, i: number) => (
              <div key={i} className="rounded-lg border border-primary/15 bg-background/60 p-4">
                <div className="flex items-start gap-2 mb-2">
                  <div className="h-5 w-5 rounded-full bg-primary/20 flex items-center justify-center text-xs font-bold text-primary shrink-0">{i + 1}</div>
                  <p className="text-sm font-semibold text-foreground">{insight.title}</p>
                </div>
                <p className="text-xs text-muted-foreground mb-2">{insight.insight}</p>
                <div className="bg-muted/40 rounded-lg p-2 mb-2">
                  <p className="text-xs font-medium text-foreground">Action: <span className="text-muted-foreground font-normal">{insight.action}</span></p>
                </div>
                <p className="text-xs font-medium text-[oklch(0.72_0.16_162)]">{insight.impact}</p>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Filters */}
      <div className="flex items-center gap-3 flex-wrap">
        <div className="flex gap-1 bg-muted/30 rounded-lg p-1 border border-border">
          {["all", "pending", "in_progress", "completed", "dismissed"].map(s => (
            <button
              key={s}
              onClick={() => setFilter(s)}
              className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors capitalize ${filter === s ? "bg-card text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"}`}
            >
              {s.replace("_", " ")}
            </button>
          ))}
        </div>
        <div className="flex gap-1 bg-muted/30 rounded-lg p-1 border border-border">
          {["all", "ads", "leads", "sales", "funnel"].map(c => (
            <button
              key={c}
              onClick={() => setCategoryFilter(c)}
              className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors capitalize ${categoryFilter === c ? "bg-card text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"}`}
            >
              {c === "all" ? "All" : categoryConfig[c as keyof typeof categoryConfig]?.icon + " " + c}
            </button>
          ))}
        </div>
        <span className="text-xs text-muted-foreground ml-auto">{filtered.length} recommendations</span>
      </div>

      {/* Recommendations List */}
      <div className="space-y-4">
        {filtered.map((r: any) => {
          const cat = categoryConfig[r.category as keyof typeof categoryConfig];
          const isCompleted = r.status === "completed";
          const isDismissed = r.status === "dismissed";

          return (
            <div
              key={r.id}
              className={`rounded-xl border bg-card p-5 transition-all ${
                isCompleted ? "opacity-60 border-border/50" :
                isDismissed ? "opacity-40 border-border/30" :
                r.priority === "critical" ? "border-[oklch(0.65_0.22_25/0.4)]" :
                r.priority === "high" ? "border-[oklch(0.82_0.17_85/0.3)]" :
                "border-border"
              }`}
            >
              <div className="flex items-start justify-between gap-4">
                <div className="flex items-start gap-4 flex-1 min-w-0">
                  {/* Category Icon */}
                  <div
                    className="h-10 w-10 rounded-xl flex items-center justify-center text-lg shrink-0"
                    style={{ background: cat?.bg }}
                  >
                    {cat?.icon}
                  </div>

                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap mb-1">
                      <h3 className="text-sm font-semibold text-foreground">{r.title}</h3>
                      <PriorityBadge priority={r.priority} />
                      <StatusBadge status="gray" label={cat?.label || r.category} />
                    </div>

                    {/* Problem / Reason / Action */}
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mt-3">
                      <div className="rounded-lg bg-muted/30 p-3 border border-border/50">
                        <p className="text-xs font-semibold text-[oklch(0.65_0.22_25)] mb-1 flex items-center gap-1">
                          <AlertTriangle className="h-3 w-3" /> Problem
                        </p>
                        <p className="text-xs text-muted-foreground">{r.problem}</p>
                      </div>
                      <div className="rounded-lg bg-muted/30 p-3 border border-border/50">
                        <p className="text-xs font-semibold text-[oklch(0.82_0.17_85)] mb-1 flex items-center gap-1">
                          <Zap className="h-3 w-3" /> Why
                        </p>
                        <p className="text-xs text-muted-foreground">{r.reason}</p>
                      </div>
                      <div className="rounded-lg bg-muted/30 p-3 border border-border/50">
                        <p className="text-xs font-semibold text-[oklch(0.72_0.16_162)] mb-1 flex items-center gap-1">
                          <CheckCircle className="h-3 w-3" /> Action
                        </p>
                        <p className="text-xs text-muted-foreground">{r.action}</p>
                      </div>
                    </div>
                  </div>
                </div>

                {/* Right side: Impact + Actions */}
                <div className="flex flex-col items-end gap-3 shrink-0">
                  {r.estimatedImpact && (
                    <div className="text-right">
                      <p className="text-xs text-muted-foreground">Est. Impact</p>
                      <p className="text-base font-bold text-[oklch(0.72_0.16_162)]">
                        +${Number(r.estimatedImpact).toLocaleString()}
                      </p>
                    </div>
                  )}
                  {r._isEngine && r.confidenceScore != null && (
                    <div className="text-right">
                      <p className="text-xs text-muted-foreground">Confidence</p>
                      <p className="text-sm font-semibold text-foreground">{(Number(r.confidenceScore) * 100).toFixed(0)}%</p>
                    </div>
                  )}
                  {r._isEngine && r.entityName && (
                    <p className="text-xs text-muted-foreground text-right max-w-[120px] truncate">{r.entityName}</p>
                  )}
                  {/* Engine recommendation buttons */}
                  {r._isEngine && isAuthenticated && !isCompleted && !isDismissed && (
                    <div className="flex gap-2">
                      <button
                        onClick={() => acceptRec.mutate({ recommendationId: r.id })}
                        disabled={acceptRec.isPending}
                        className="flex items-center gap-1 px-3 py-1.5 text-xs font-medium rounded-lg bg-[oklch(0.72_0.16_162/0.15)] text-[oklch(0.72_0.16_162)] hover:bg-[oklch(0.72_0.16_162/0.25)] transition-colors border border-[oklch(0.72_0.16_162/0.2)] disabled:opacity-40"
                      >
                        <CheckCircle className="h-3 w-3" /> Accept
                      </button>
                      <button
                        onClick={() => dismissRec.mutate({ recommendationId: r.id })}
                        disabled={dismissRec.isPending}
                        className="flex items-center gap-1 px-3 py-1.5 text-xs font-medium rounded-lg bg-muted/50 text-muted-foreground hover:text-foreground transition-colors border border-border disabled:opacity-40"
                      >
                        <XCircle className="h-3 w-3" />
                      </button>
                    </div>
                  )}
                  {/* Legacy recommendation buttons */}
                  {!r._isEngine && isAuthenticated && !isCompleted && !isDismissed && (
                    <div className="flex gap-2">
                      {r.status === "pending" && (
                        <button
                          onClick={() => updateStatus.mutate({ id: r.id, status: "in_progress" })}
                          className="flex items-center gap-1 px-3 py-1.5 text-xs font-medium rounded-lg bg-primary/15 text-primary hover:bg-primary/25 transition-colors border border-primary/20"
                        >
                          <Clock className="h-3 w-3" /> Start
                        </button>
                      )}
                      {r.status === "in_progress" && (
                        <button
                          onClick={() => updateStatus.mutate({ id: r.id, status: "completed" })}
                          className="flex items-center gap-1 px-3 py-1.5 text-xs font-medium rounded-lg bg-[oklch(0.72_0.16_162/0.15)] text-[oklch(0.72_0.16_162)] hover:bg-[oklch(0.72_0.16_162/0.25)] transition-colors border border-[oklch(0.72_0.16_162/0.2)]"
                        >
                          <CheckCircle className="h-3 w-3" /> Done
                        </button>
                      )}
                      <button
                        onClick={() => updateStatus.mutate({ id: r.id, status: "dismissed" })}
                        className="flex items-center gap-1 px-3 py-1.5 text-xs font-medium rounded-lg bg-muted/50 text-muted-foreground hover:text-foreground transition-colors border border-border"
                      >
                        <XCircle className="h-3 w-3" />
                      </button>
                    </div>
                  )}
                  {(isCompleted || isDismissed) && (
                    <StatusBadge status={isCompleted ? "green" : "gray"} label={r.status.replace("_", " ")} />
                  )}
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
