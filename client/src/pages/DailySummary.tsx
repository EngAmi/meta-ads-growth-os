import { trpc } from "@/lib/trpc";
import { PageHeader } from "@/components/ui/PageHeader";
import { MetricCard } from "@/components/ui/MetricCard";
import { StatusBadge, SeverityBadge } from "@/components/ui/StatusBadge";
import { Sparkles, DollarSign, Users, Target, TrendingUp, AlertTriangle, CheckCircle, Clock, Zap } from "lucide-react";
import { Streamdown } from "streamdown";

function fmt(n: any, prefix = "", decimals = 0) {
  const v = Number(n || 0);
  if (v >= 1000000) return `${prefix}${(v / 1000000).toFixed(1)}M`;
  if (v >= 1000) return `${prefix}${(v / 1000).toFixed(1)}K`;
  return `${prefix}${v.toFixed(decimals)}`;
}

export default function DailySummary() {
  const { data: latestSummary, isLoading } = trpc.dailySummary.latest.useQuery();
  const { data: aiData } = trpc.dailySummary.generateAI.useQuery();
  const { data: bottlenecks } = trpc.funnel.bottlenecks.useQuery();
  const { data: topRecs } = trpc.recommendations.list.useQuery();

  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);
  const dateStr = yesterday.toLocaleDateString("en", { weekday: "long", year: "numeric", month: "long", day: "numeric" });

  if (isLoading) {
    return (
      <div className="p-6 space-y-4">
        <div className="h-8 w-64 bg-muted animate-pulse rounded-lg" />
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          {[...Array(4)].map((_, i) => <div key={i} className="h-28 bg-muted animate-pulse rounded-xl" />)}
        </div>
        <div className="h-64 bg-muted animate-pulse rounded-xl" />
      </div>
    );
  }

  const d = aiData?.data;
  const roas = d?.spend && Number(d.spend) > 0 ? Number(d.revenue) / Number(d.spend) : 0;
  const convRate = d?.leads && Number(d.leads) > 0 ? (Number(d.conversions) / Number(d.leads)) * 100 : 0;

  const criticalIssues = (bottlenecks || []).filter((b: any) => b.severity === "critical");
  const warnings = (bottlenecks || []).filter((b: any) => b.severity === "warning");
  const pendingRecs = (topRecs || []).filter((r: any) => r.status === "pending").slice(0, 5);

  return (
    <div className="p-6 space-y-6 max-w-[1600px] mx-auto">
      <PageHeader
        title="Daily AI Summary"
        description={dateStr}
        icon={Sparkles}
      >
        <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-primary/10 border border-primary/20">
          <Sparkles className="h-3.5 w-3.5 text-primary" />
          <span className="text-xs font-medium text-primary">AI-Generated</span>
        </div>
      </PageHeader>

      {/* Yesterday's KPIs */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <MetricCard
          title="Yesterday's Revenue"
          value={fmt(d?.revenue, "$")}
          subtitle="From ad campaigns"
          icon={DollarSign}
          status={roas >= 3 ? "green" : roas >= 1.5 ? "yellow" : "red"}
        />
        <MetricCard
          title="New Leads"
          value={fmt(d?.leads)}
          subtitle={`CPL: $${d?.spend && d?.leads && Number(d.leads) > 0 ? (Number(d.spend) / Number(d.leads)).toFixed(2) : "0"}`}
          icon={Users}
          status="blue"
        />
        <MetricCard
          title="Conversions"
          value={fmt(d?.conversions)}
          subtitle={`Rate: ${convRate.toFixed(1)}%`}
          icon={Target}
          status={convRate >= 15 ? "green" : convRate >= 8 ? "yellow" : "red"}
        />
        <MetricCard
          title="Ad Spend"
          value={fmt(d?.spend, "$")}
          subtitle={`ROAS: ${roas.toFixed(2)}x`}
          icon={TrendingUp}
          status={roas >= 3 ? "green" : roas >= 1.5 ? "yellow" : "red"}
        />
      </div>

      {/* AI Narrative */}
      {aiData?.summary && (
        <div className="rounded-xl border border-primary/20 bg-gradient-to-br from-primary/5 to-transparent p-6">
          <div className="flex items-center gap-3 mb-4">
            <div className="h-9 w-9 rounded-xl bg-primary/15 flex items-center justify-center">
              <Sparkles className="h-4 w-4 text-primary" />
            </div>
            <div>
              <h2 className="text-sm font-semibold text-foreground">AI Analysis</h2>
              <p className="text-xs text-muted-foreground">Generated from yesterday's performance data</p>
            </div>
          </div>
          <div className="text-sm text-muted-foreground leading-relaxed">
            <Streamdown>{String(aiData.summary)}</Streamdown>
          </div>
        </div>
      )}

      {/* Alerts + Actions */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Critical Issues */}
        <div className="rounded-xl border border-border bg-card p-5">
          <div className="flex items-center gap-2 mb-4">
            <AlertTriangle className="h-4 w-4 text-[oklch(0.65_0.22_25)]" />
            <h2 className="text-sm font-semibold text-foreground">Issues & Alerts</h2>
            <span className="ml-auto text-xs text-muted-foreground">{criticalIssues.length + warnings.length} active</span>
          </div>

          {criticalIssues.length > 0 && (
            <div className="mb-3">
              <p className="text-xs font-semibold text-[oklch(0.65_0.22_25)] mb-2 uppercase tracking-wide">Critical</p>
              <div className="space-y-2">
                {criticalIssues.slice(0, 3).map((b: any) => (
                  <div key={b.id} className="flex items-start gap-3 p-3 rounded-lg bg-[oklch(0.65_0.22_25/0.08)] border border-[oklch(0.65_0.22_25/0.2)]">
                    <AlertTriangle className="h-3.5 w-3.5 text-[oklch(0.65_0.22_25)] shrink-0 mt-0.5" />
                    <div>
                      <p className="text-xs font-medium text-foreground">{b.title}</p>
                      <p className="text-xs text-muted-foreground mt-0.5 line-clamp-2">{b.description}</p>
                      {b.revenueImpact && (
                        <p className="text-xs text-[oklch(0.65_0.22_25)] mt-1 font-medium">
                          ${Number(b.revenueImpact).toLocaleString()} at risk
                        </p>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {warnings.length > 0 && (
            <div>
              <p className="text-xs font-semibold text-[oklch(0.82_0.17_85)] mb-2 uppercase tracking-wide">Warnings</p>
              <div className="space-y-2">
                {warnings.slice(0, 3).map((b: any) => (
                  <div key={b.id} className="flex items-start gap-3 p-3 rounded-lg bg-[oklch(0.82_0.17_85/0.08)] border border-[oklch(0.82_0.17_85/0.2)]">
                    <Clock className="h-3.5 w-3.5 text-[oklch(0.82_0.17_85)] shrink-0 mt-0.5" />
                    <div>
                      <p className="text-xs font-medium text-foreground">{b.title}</p>
                      <p className="text-xs text-muted-foreground mt-0.5 line-clamp-2">{b.description}</p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {criticalIssues.length === 0 && warnings.length === 0 && (
            <div className="flex flex-col items-center justify-center py-8 text-center">
              <CheckCircle className="h-8 w-8 text-[oklch(0.72_0.16_162)] mb-2" />
              <p className="text-sm font-medium text-foreground">All Clear</p>
              <p className="text-xs text-muted-foreground mt-1">No critical issues detected</p>
            </div>
          )}
        </div>

        {/* Top 5 Actions for Today */}
        <div className="rounded-xl border border-border bg-card p-5">
          <div className="flex items-center gap-2 mb-4">
            <Zap className="h-4 w-4 text-[oklch(0.72_0.16_162)]" />
            <h2 className="text-sm font-semibold text-foreground">Top 5 Actions for Today</h2>
          </div>
          <div className="space-y-3">
            {pendingRecs.map((r: any, i: number) => (
              <div key={r.id} className="flex items-start gap-3 p-3 rounded-lg bg-muted/20 border border-border/50">
                <div className="h-6 w-6 rounded-full bg-primary/20 flex items-center justify-center text-xs font-bold text-primary shrink-0 mt-0.5">
                  {i + 1}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    <p className="text-xs font-semibold text-foreground truncate">{r.title}</p>
                    <SeverityBadge severity={r.priority} />
                  </div>
                  <p className="text-xs text-muted-foreground line-clamp-1">{r.action}</p>
                  {r.estimatedImpact && (
                    <p className="text-xs text-[oklch(0.72_0.16_162)] mt-1 font-medium">
                      +${Number(r.estimatedImpact).toLocaleString()} potential
                    </p>
                  )}
                </div>
              </div>
            ))}
            {pendingRecs.length === 0 && (
              <div className="flex flex-col items-center justify-center py-8 text-center">
                <CheckCircle className="h-8 w-8 text-[oklch(0.72_0.16_162)] mb-2" />
                <p className="text-sm font-medium text-foreground">All caught up!</p>
                <p className="text-xs text-muted-foreground mt-1">No pending actions</p>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Stored Summary from DB */}
      {latestSummary && (
        <div className="rounded-xl border border-border bg-card p-5">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-sm font-semibold text-foreground">Stored Daily Report</h2>
            <StatusBadge status="blue" label={new Date(latestSummary.date).toLocaleDateString("en", { month: "short", day: "numeric" })} />
          </div>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-4">
            <div className="bg-muted/30 rounded-lg p-3">
              <p className="text-xs text-muted-foreground">Revenue</p>
              <p className="text-lg font-bold text-[oklch(0.72_0.16_162)]">${Number(latestSummary.totalRevenue || 0).toLocaleString()}</p>
            </div>
            <div className="bg-muted/30 rounded-lg p-3">
              <p className="text-xs text-muted-foreground">Spend</p>
              <p className="text-lg font-bold text-foreground">${Number(latestSummary.totalSpend || 0).toLocaleString()}</p>
            </div>
            <div className="bg-muted/30 rounded-lg p-3">
              <p className="text-xs text-muted-foreground">Leads</p>
              <p className="text-lg font-bold text-foreground">{Number(latestSummary.totalLeads || 0).toLocaleString()}</p>
            </div>
            <div className="bg-muted/30 rounded-lg p-3">
              <p className="text-xs text-muted-foreground">Conversions</p>
              <p className="text-lg font-bold text-foreground">{Number(latestSummary.totalConversions || 0).toLocaleString()}</p>
            </div>
          </div>
          {latestSummary.aiSummary && (
            <div className="text-xs text-muted-foreground leading-relaxed border-t border-border pt-4">
              <Streamdown>{latestSummary.aiSummary}</Streamdown>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
