import DashboardLayout from "@/components/DashboardLayout";
import { trpc } from "@/lib/trpc";
import { PageHeader } from "@/components/ui/PageHeader";
import { StatusBadge, SeverityBadge } from "@/components/ui/StatusBadge";
import { GitBranch, ArrowRight, AlertTriangle, Globe, TrendingDown, TrendingUp, Link2, Upload, CheckCircle2, RefreshCw, ChevronRight, X } from "lucide-react";
import { useLocation } from "wouter";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell, RadarChart, Radar, PolarGrid, PolarAngleAxis } from "recharts";

function fmt(n: any, prefix = "", decimals = 0) {
  const v = Number(n || 0);
  if (v >= 1000000) return `${prefix}${(v / 1000000).toFixed(1)}M`;
  if (v >= 1000) return `${prefix}${(v / 1000).toFixed(1)}K`;
  return `${prefix}${v.toFixed(decimals)}`;
}

const stageConfig = {
  ads: { label: "Ads", color: "oklch(0.62 0.19 258)", icon: "📢" },
  leads: { label: "Leads", color: "oklch(0.68 0.18 305)", icon: "👥" },
  sales: { label: "Sales", color: "oklch(0.82 0.17 85)", icon: "🎯" },
  revenue: { label: "Revenue", color: "oklch(0.72 0.16 162)", icon: "💰" },
  funnel: { label: "Funnel", color: "oklch(0.65 0.22 25)", icon: "🔻" },
};

// ── Engine diagnostic card ─────────────────────────────────────────────────────
function EngineDiagCard({
  d,
  borderColor,
  accentColor,
  onAcknowledge,
  isPending,
}: {
  d: any;
  borderColor: string;
  accentColor: string;
  onAcknowledge: (id: number) => void;
  isPending: boolean;
}) {
  const ev = d.evidence as any;
  const stage = d.category as keyof typeof stageConfig;
  const stageIcon = stageConfig[stage]?.icon ?? "🔍";
  const hasEvidence = ev?.metric && ev?.currentValue != null;
  return (
    <div
      className="rounded-lg bg-background/50 p-3"
      style={{ border: `1px solid ${borderColor}33` }}
    >
      <div className="flex items-start justify-between gap-2 mb-1">
        <p className="text-xs font-semibold text-foreground leading-snug">{d.headline}</p>
        <span className="text-xs text-muted-foreground shrink-0">{stageIcon}</span>
      </div>
      {d.entityName && (
        <p className="text-xs text-muted-foreground mb-1 truncate">{d.entityName}</p>
      )}
      {hasEvidence && (
        <div className="mt-1.5 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
          <span>
            Current:{" "}
            <span className="font-mono" style={{ color: accentColor }}>
              {typeof ev.currentValue === "number" ? ev.currentValue.toFixed(2) : ev.currentValue}
            </span>
          </span>
          {ev.baselineMean != null && (
            <>
              <span>·</span>
              <span>
                Baseline:{" "}
                <span className="font-mono text-[oklch(0.72_0.16_162)]">
                  {typeof ev.baselineMean === "number" ? ev.baselineMean.toFixed(2) : ev.baselineMean}
                </span>
              </span>
            </>
          )}
          {ev.deltaPercent != null && (
            <>
              <span>·</span>
              <span className="font-mono" style={{ color: accentColor }}>
                {ev.deltaPercent > 0 ? "+" : ""}{ev.deltaPercent.toFixed(1)}%
              </span>
            </>
          )}
        </div>
      )}
      <div className="mt-2 flex items-center justify-between">
        <span className="text-xs text-muted-foreground">
          Rule <span className="font-mono">{d.ruleId}</span>
          {ev?.baselineSource && ev.baselineSource !== "none" && (
            <span className="ml-1 opacity-60">· {ev.baselineSource} baseline</span>
          )}
        </span>
        <button
          onClick={() => onAcknowledge(d.id)}
          disabled={isPending}
          className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors disabled:opacity-40"
          title="Acknowledge"
        >
          <X className="h-3 w-3" />
          Ack
        </button>
      </div>
    </div>
  );
}

export default function FunnelDiagnosis() {
  const [, setLocation] = useLocation();
  const { data: connStatus } = trpc.dataSources.connectionStatus.useQuery();
  const { data: overview } = trpc.funnel.overview.useQuery();
  const { data: bottlenecks } = trpc.funnel.bottlenecks.useQuery();
  const { data: countryAnalysis } = trpc.funnel.countryAnalysis.useQuery();

  // ── Engine diagnostics ─────────────────────────────────────────────────────
  const utils = trpc.useUtils();
  const { data: engineDiagnosticsResult } = trpc.engineDiagnostics.list.useQuery({ status: 'active', limit: 20 });
  const acknowledge = trpc.engineDiagnostics.acknowledge.useMutation({
    onSuccess: () => utils.engineDiagnostics.list.invalidate(),
  });
  const engineDiagnostics = engineDiagnosticsResult?.data ?? [];
  const useEngineData = engineDiagnostics.length > 0;

  // Normalise engine diagnostics into the card shape
  const engineItems: any[] = useEngineData
    ? engineDiagnostics.map((d: any) => ({
        id: d.id,
        ruleId: d.ruleId,
        headline: d.headline ?? d.ruleId,
        category: d.category,
        severity: d.severity,
        entityName: d.entityName ?? null,
        evidence: d.evidence ?? {},
        tier: d.severity >= 80 ? 'critical' : d.severity >= 50 ? 'warning' : 'info',
      }))
    : [];

  const ads = overview?.adsMetrics as any;
  const leads = overview?.leadsMetrics as any;
  const sales = overview?.salesMetrics as any;

  const funnelFlow = [
    {
      stage: "Impressions",
      value: fmt(ads?.impressions),
      sub: `$${fmt(ads?.spend)} spent`,
      color: "oklch(0.62 0.19 258)",
      rate: null,
    },
    {
      stage: "Clicks",
      value: fmt(ads?.clicks),
      sub: `CTR: ${ads?.avgCtr ? Number(ads.avgCtr).toFixed(2) : 0}%`,
      color: "oklch(0.68 0.18 305)",
      rate: ads?.impressions && ads.clicks ? ((Number(ads.clicks) / Number(ads.impressions)) * 100).toFixed(2) + "%" : null,
    },
    {
      stage: "Leads",
      value: fmt(ads?.leads),
      sub: `CPL: $${ads?.avgCpl ? Number(ads.avgCpl).toFixed(2) : 0}`,
      color: "oklch(0.82 0.17 85)",
      rate: ads?.clicks && ads.leads ? ((Number(ads.leads) / Number(ads.clicks)) * 100).toFixed(2) + "%" : null,
    },
    {
      stage: "Qualified",
      value: fmt(leads?.qualified),
      sub: `${leads?.total ? ((Number(leads.qualified) / Number(leads.total)) * 100).toFixed(0) : 0}% of leads`,
      color: "oklch(0.75 0.15 200)",
      rate: leads?.total && leads.qualified ? ((Number(leads.qualified) / Number(leads.total)) * 100).toFixed(1) + "%" : null,
    },
    {
      stage: "Converted",
      value: fmt(leads?.converted),
      sub: `${leads?.total ? ((Number(leads.converted) / Number(leads.total)) * 100).toFixed(1) : 0}% close rate`,
      color: "oklch(0.72 0.16 162)",
      rate: leads?.qualified && leads.converted ? ((Number(leads.converted) / Number(leads.qualified)) * 100).toFixed(1) + "%" : null,
    },
    {
      stage: "Revenue",
      value: fmt(ads?.revenue, "$"),
      sub: `ROAS: ${ads?.spend && ads.revenue ? (Number(ads.revenue) / Number(ads.spend)).toFixed(1) : 0}x`,
      color: "oklch(0.72 0.16 162)",
      rate: null,
    },
  ];

  const countryData = (countryAnalysis || []).map((c: any) => ({
    country: c.country,
    spend: Number(c.spend),
    revenue: Number(c.revenue),
    leads: Number(c.leads),
    roas: Number(c.roas).toFixed(2),
    convRate: Number(c.convRate).toFixed(1),
    status: c.status,
  }));

  // Prefer engine data; fall back to legacy bottlenecks
  const criticalBottlenecks = useEngineData
    ? engineItems.filter(d => d.tier === 'critical')
    : (bottlenecks || []).filter((b: any) => b.severity === "critical");
  const warningBottlenecks = useEngineData
    ? engineItems.filter(d => d.tier === 'warning')
    : (bottlenecks || []).filter((b: any) => b.severity === "warning");
  const infoBottlenecks = useEngineData
    ? engineItems.filter(d => d.tier === 'info')
    : (bottlenecks || []).filter((b: any) => b.severity === "info");

  const totalRevenueImpact = (bottlenecks || []).reduce((s: number, b: any) => s + Number(b.revenueImpact || 0), 0);

  return (
    <div className="p-6 space-y-6 max-w-[1600px] mx-auto">
      <PageHeader
        title="Funnel Diagnosis"
        description="End-to-end funnel analysis: Ads → Leads → Sales → Revenue"
        icon={GitBranch}
      >
        <div className="flex items-center gap-2">
          {totalRevenueImpact > 0 && (
            <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-[oklch(0.65_0.22_25/0.12)] border border-[oklch(0.65_0.22_25/0.25)]">
              <AlertTriangle className="h-3.5 w-3.5 text-[oklch(0.65_0.22_25)]" />
              <span className="text-xs font-medium text-[oklch(0.65_0.22_25)]">
                ${totalRevenueImpact.toLocaleString()} revenue at risk
              </span>
            </div>
          )}
          {connStatus?.hasActiveConnection ? (
            <div className="flex items-center gap-1.5 text-xs text-[oklch(0.72_0.16_162)] bg-[oklch(0.72_0.16_162)/10] border border-[oklch(0.72_0.16_162)/25] px-3 py-1.5 rounded-lg">
              <CheckCircle2 className="h-3.5 w-3.5" />
              <span>Meta connected</span>
              {connStatus.lastSyncedAt && (
                <span className="text-muted-foreground flex items-center gap-1">
                  <RefreshCw className="h-3 w-3" />
                  {(() => {
                    const diff = Date.now() - new Date(connStatus.lastSyncedAt).getTime();
                    const mins = Math.floor(diff / 60000);
                    const hrs = Math.floor(mins / 60);
                    if (hrs > 0) return `${hrs}h ago`;
                    if (mins > 0) return `${mins}m ago`;
                    return "just now";
                  })()}
                </span>
              )}
              <button onClick={() => setLocation("/data-sources")} className="ml-1 hover:text-foreground transition-colors">
                <ChevronRight className="h-3 w-3" />
              </button>
            </div>
          ) : (
            <>
              <button
                onClick={() => setLocation("/data-sources?tab=api")}
                className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-[oklch(0.62_0.19_258)] text-white text-xs font-semibold hover:bg-[oklch(0.55_0.19_258)] transition-colors"
              >
                <Link2 className="h-3.5 w-3.5" />
                Connect Meta API
              </button>
              <button
                onClick={() => setLocation("/data-sources?tab=upload")}
                className="flex items-center gap-2 px-3 py-1.5 rounded-lg border border-border bg-card text-foreground text-xs font-semibold hover:bg-muted transition-colors"
              >
                <Upload className="h-3.5 w-3.5" />
                Upload CSV
              </button>
            </>
          )}
        </div>
      </PageHeader>

      {/* Funnel Flow Visualization */}
      <div className="rounded-xl border border-border bg-card p-6">
        <h2 className="text-sm font-semibold mb-5 text-foreground">Full Funnel Flow</h2>
        <div className="flex items-stretch gap-0 overflow-x-auto pb-2">
          {funnelFlow.map((stage, i) => (
            <div key={stage.stage} className="flex items-center shrink-0">
              <div className="flex flex-col items-center text-center w-32">
                {stage.rate && (
                  <div className="mb-2 px-2 py-0.5 rounded-full text-xs font-medium bg-muted/50 text-muted-foreground border border-border/50">
                    {stage.rate}
                  </div>
                )}
                {!stage.rate && <div className="mb-2 h-6" />}
                <div
                  className="w-full rounded-xl p-4 border border-border/50"
                  style={{ background: `${stage.color}14` }}
                >
                  <p className="text-xs font-medium text-muted-foreground mb-1">{stage.stage}</p>
                  <p className="text-xl font-bold" style={{ color: stage.color }}>{stage.value}</p>
                  <p className="text-xs text-muted-foreground mt-1">{stage.sub}</p>
                </div>
              </div>
              {i < funnelFlow.length - 1 && (
                <ArrowRight className="h-4 w-4 text-muted-foreground/30 mx-1 shrink-0" />
              )}
            </div>
          ))}
        </div>
      </div>

      {/* Bottlenecks */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Critical */}
        <div className="rounded-xl border border-[oklch(0.65_0.22_25/0.3)] bg-[oklch(0.65_0.22_25/0.05)] p-5">
          <div className="flex items-center gap-2 mb-4">
            <div className="h-2 w-2 rounded-full bg-[oklch(0.65_0.22_25)] animate-pulse" />
            <h2 className="text-sm font-semibold text-[oklch(0.65_0.22_25)]">Critical Issues ({criticalBottlenecks.length})</h2>
          </div>
          <div className="space-y-3">
            {criticalBottlenecks.map((b: any) =>
              useEngineData ? (
                <EngineDiagCard
                  key={b.id}
                  d={b}
                  borderColor="oklch(0.65 0.22 25)"
                  accentColor="oklch(0.65 0.22 25)"
                  onAcknowledge={id => acknowledge.mutate({ diagnosticId: id })}
                  isPending={acknowledge.isPending}
                />
              ) : (
                <div key={b.id} className="rounded-lg border border-[oklch(0.65_0.22_25/0.2)] bg-background/50 p-3">
                  <div className="flex items-start justify-between gap-2 mb-1">
                    <p className="text-xs font-semibold text-foreground">{b.title}</p>
                    <span className="text-xs text-muted-foreground shrink-0">{stageConfig[b.stage as keyof typeof stageConfig]?.icon}</span>
                  </div>
                  <p className="text-xs text-muted-foreground mb-2 line-clamp-2">{b.description}</p>
                  <div className="flex items-center justify-between">
                    {b.revenueImpact && (
                      <span className="text-xs font-medium text-[oklch(0.65_0.22_25)]">
                        ${Number(b.revenueImpact).toLocaleString()} at risk
                      </span>
                    )}
                    {b.country && <StatusBadge status="gray" label={b.country} />}
                  </div>
                  {b.currentValue && b.benchmarkValue && (
                    <div className="mt-2 flex items-center gap-2 text-xs text-muted-foreground">
                      <span>Current: <span className="text-[oklch(0.65_0.22_25)] font-mono">{Number(b.currentValue).toFixed(2)}</span></span>
                      <span>·</span>
                      <span>Benchmark: <span className="text-[oklch(0.72_0.16_162)] font-mono">{Number(b.benchmarkValue).toFixed(2)}</span></span>
                    </div>
                  )}
                </div>
              )
            )}
            {criticalBottlenecks.length === 0 && (
              <p className="text-xs text-muted-foreground text-center py-4">No critical issues</p>
            )}
          </div>
        </div>

        {/* Warnings */}
        <div className="rounded-xl border border-[oklch(0.82_0.17_85/0.3)] bg-[oklch(0.82_0.17_85/0.05)] p-5">
          <div className="flex items-center gap-2 mb-4">
            <div className="h-2 w-2 rounded-full bg-[oklch(0.82_0.17_85)]" />
            <h2 className="text-sm font-semibold text-[oklch(0.82_0.17_85)]">Warnings ({warningBottlenecks.length})</h2>
          </div>
          <div className="space-y-3">
            {warningBottlenecks.map((b: any) =>
              useEngineData ? (
                <EngineDiagCard
                  key={b.id}
                  d={b}
                  borderColor="oklch(0.82 0.17 85)"
                  accentColor="oklch(0.82 0.17 85)"
                  onAcknowledge={id => acknowledge.mutate({ diagnosticId: id })}
                  isPending={acknowledge.isPending}
                />
              ) : (
                <div key={b.id} className="rounded-lg border border-[oklch(0.82_0.17_85/0.2)] bg-background/50 p-3">
                  <div className="flex items-start justify-between gap-2 mb-1">
                    <p className="text-xs font-semibold text-foreground">{b.title}</p>
                    <span className="text-xs text-muted-foreground shrink-0">{stageConfig[b.stage as keyof typeof stageConfig]?.icon}</span>
                  </div>
                  <p className="text-xs text-muted-foreground mb-2 line-clamp-2">{b.description}</p>
                  <div className="flex items-center justify-between">
                    {b.revenueImpact && (
                      <span className="text-xs font-medium text-[oklch(0.82_0.17_85)]">
                        ${Number(b.revenueImpact).toLocaleString()} at risk
                      </span>
                    )}
                    {b.country && <StatusBadge status="gray" label={b.country} />}
                  </div>
                </div>
              )
            )}
            {warningBottlenecks.length === 0 && (
              <p className="text-xs text-muted-foreground text-center py-4">No warnings</p>
            )}
          </div>
        </div>

        {/* Info / Opportunities */}
        <div className="rounded-xl border border-[oklch(0.62_0.19_258/0.3)] bg-[oklch(0.62_0.19_258/0.05)] p-5">
          <div className="flex items-center gap-2 mb-4">
            <div className="h-2 w-2 rounded-full bg-[oklch(0.62_0.19_258)]" />
            <h2 className="text-sm font-semibold text-[oklch(0.62_0.19_258)]">Opportunities ({infoBottlenecks.length})</h2>
          </div>
          <div className="space-y-3">
            {infoBottlenecks.map((b: any) =>
              useEngineData ? (
                <EngineDiagCard
                  key={b.id}
                  d={b}
                  borderColor="oklch(0.62 0.19 258)"
                  accentColor="oklch(0.62 0.19 258)"
                  onAcknowledge={id => acknowledge.mutate({ diagnosticId: id })}
                  isPending={acknowledge.isPending}
                />
              ) : (
                <div key={b.id} className="rounded-lg border border-[oklch(0.62_0.19_258/0.2)] bg-background/50 p-3">
                  <div className="flex items-start justify-between gap-2 mb-1">
                    <p className="text-xs font-semibold text-foreground">{b.title}</p>
                    <span className="text-xs text-muted-foreground shrink-0">{stageConfig[b.stage as keyof typeof stageConfig]?.icon}</span>
                  </div>
                  <p className="text-xs text-muted-foreground mb-2 line-clamp-2">{b.description}</p>
                  {b.country && <StatusBadge status="gray" label={b.country} />}
                </div>
              )
            )}
            {infoBottlenecks.length === 0 && (
              <p className="text-xs text-muted-foreground text-center py-4">No opportunities found</p>
            )}
          </div>
        </div>
      </div>

      {/* Country Analysis */}
      <div className="rounded-xl border border-border bg-card overflow-hidden">
        <div className="p-5 border-b border-border">
          <h2 className="text-sm font-semibold flex items-center gap-2">
            <Globe className="h-4 w-4 text-primary" />
            Country-Specific Funnel Analysis
          </h2>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border bg-muted/20">
                <th className="text-left px-5 py-3 text-xs font-semibold text-muted-foreground">Country</th>
                <th className="text-left px-5 py-3 text-xs font-semibold text-muted-foreground">Ad Spend</th>
                <th className="text-left px-5 py-3 text-xs font-semibold text-muted-foreground">Leads</th>
                <th className="text-left px-5 py-3 text-xs font-semibold text-muted-foreground">Revenue</th>
                <th className="text-left px-5 py-3 text-xs font-semibold text-muted-foreground">ROAS</th>
                <th className="text-left px-5 py-3 text-xs font-semibold text-muted-foreground">Conv. Rate</th>
                <th className="text-left px-5 py-3 text-xs font-semibold text-muted-foreground">Funnel Health</th>
                <th className="text-left px-5 py-3 text-xs font-semibold text-muted-foreground">Trend</th>
              </tr>
            </thead>
            <tbody>
              {countryData.map((c: any) => (
                <tr key={c.country} className="border-b border-border/50 hover:bg-muted/20 transition-colors">
                  <td className="px-5 py-4 font-semibold text-sm text-foreground">{c.country}</td>
                  <td className="px-5 py-4 text-xs font-mono">${Number(c.spend).toLocaleString()}</td>
                  <td className="px-5 py-4 text-xs font-mono">{Number(c.leads).toLocaleString()}</td>
                  <td className="px-5 py-4 text-xs font-mono text-[oklch(0.72_0.16_162)]">${Number(c.revenue).toLocaleString()}</td>
                  <td className="px-5 py-4">
                    <StatusBadge status={Number(c.roas) >= 3 ? "green" : Number(c.roas) >= 1.5 ? "yellow" : "red"} label={`${Number(c.roas).toFixed(1)}x`} />
                  </td>
                  <td className="px-5 py-4">
                    <StatusBadge status={Number(c.convRate) >= 15 ? "green" : Number(c.convRate) >= 8 ? "yellow" : "red"} label={`${Number(c.convRate).toFixed(1)}%`} />
                  </td>
                  <td className="px-5 py-4">
                    <StatusBadge status={c.status} label={c.status === "green" ? "Healthy" : c.status === "yellow" ? "Moderate" : "Critical"} />
                  </td>
                  <td className="px-5 py-4">
                    {c.status === "green" ? (
                      <TrendingUp className="h-4 w-4 text-[oklch(0.72_0.16_162)]" />
                    ) : (
                      <TrendingDown className="h-4 w-4 text-[oklch(0.65_0.22_25)]" />
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Country Revenue Chart */}
      <div className="rounded-xl border border-border bg-card p-5">
        <h2 className="text-sm font-semibold mb-4">Revenue vs Spend by Country</h2>
        <ResponsiveContainer width="100%" height={220}>
          <BarChart data={countryData} margin={{ top: 4, right: 4, bottom: 0, left: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="oklch(1 0 0 / 5%)" />
            <XAxis dataKey="country" tick={{ fontSize: 11, fill: "oklch(0.82 0.006 264)" }} tickLine={false} axisLine={false} />
            <YAxis tick={{ fontSize: 10, fill: "oklch(0.58 0.012 264)" }} tickLine={false} axisLine={false} tickFormatter={v => `$${v >= 1000 ? (v/1000).toFixed(0)+'K' : v}`} />
            <Tooltip contentStyle={{ background: "oklch(0.158 0.009 264)", border: "1px solid oklch(1 0 0 / 8%)", borderRadius: "8px", fontSize: "12px" }} />
            <Bar dataKey="revenue" name="Revenue" fill="oklch(0.72 0.16 162)" radius={[4, 4, 0, 0]} />
            <Bar dataKey="spend" name="Spend" fill="oklch(0.62 0.19 258)" radius={[4, 4, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
