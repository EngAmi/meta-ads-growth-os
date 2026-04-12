import DashboardLayout from "@/components/DashboardLayout";
import { trpc } from "@/lib/trpc";
import { MetricCard } from "@/components/ui/MetricCard";
import { PageHeader } from "@/components/ui/PageHeader";
import { StatusBadge, SeverityBadge } from "@/components/ui/StatusBadge";
import { LayoutDashboard, DollarSign, Users, Target, TrendingUp, AlertTriangle, Lightbulb, ArrowRight, Zap, Activity, Link2, Upload, ChevronRight, CheckCircle2, RefreshCw } from "lucide-react";
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, PieChart, Pie, Cell, BarChart, Bar } from "recharts";
import { useLocation } from "wouter";
import { useEffect } from "react";
import { toast } from "sonner";

const COLORS = ["oklch(0.62 0.19 258)", "oklch(0.72 0.16 162)", "oklch(0.82 0.17 85)", "oklch(0.65 0.22 25)", "oklch(0.68 0.18 305)"];

function fmt(n: number | string | null | undefined, prefix = "", decimals = 0) {
  const v = Number(n || 0);
  if (v >= 1000000) return `${prefix}${(v / 1000000).toFixed(1)}M`;
  if (v >= 1000) return `${prefix}${(v / 1000).toFixed(1)}K`;
  return `${prefix}${v.toFixed(decimals)}`;
}

export default function Dashboard() {
  const { data: summary, isLoading } = trpc.dashboard.summary.useQuery();
  const { data: funnelHealth } = trpc.dashboard.funnelHealth.useQuery();
  const { data: byCountry } = trpc.dashboard.revenueByCountry.useQuery();
  const { data: byAgent } = trpc.dashboard.revenueByAgent.useQuery();
  const { data: insights } = trpc.ads.insights.useQuery({ days: 14 });
  const { data: connStatus, refetch: refetchConnStatus } = trpc.dataSources.connectionStatus.useQuery();
  const syncNow = trpc.dataSources.syncNow.useMutation({
    onSuccess: (result) => {
      refetchConnStatus();
      toast.success(`Sync complete — ${result.imported} rows imported${result.errors > 0 ? `, ${result.errors} errors` : ''}`);
    },
    onError: (err) => {
      toast.error(`Sync failed: ${err.message}`);
    },
  });
  const [, setLocation] = useLocation();

  useEffect(() => {
    document.title = "Growth OS – Marketing Analytics & Sales Intelligence";
    // Ensure meta description is present for SPAs
    let metaDesc = document.querySelector('meta[name="description"]');
    if (!metaDesc) {
      metaDesc = document.createElement("meta");
      (metaDesc as HTMLMetaElement).name = "description";
      document.head.appendChild(metaDesc);
    }
    (metaDesc as HTMLMetaElement).content =
      "Growth OS is a unified marketing analytics and sales intelligence platform. Track Meta Ads performance, score leads, diagnose your funnel, and get AI-powered growth recommendations.";
  }, []);

  if (isLoading) {
    return (
      <div className="p-6 space-y-4">
        <div className="h-8 w-48 bg-muted animate-pulse rounded-lg" />
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          {[...Array(4)].map((_, i) => <div key={i} className="h-28 bg-muted animate-pulse rounded-xl" />)}
        </div>
      </div>
    );
  }

  const ads = summary?.ads;
  const leads = summary?.leads;
  const roas = ads?.totalSpend && ads.totalSpend > 0 ? (Number(ads.totalRevenue) / Number(ads.totalSpend)) : 0;
  const convRate = leads?.total && leads.total > 0 ? ((Number(leads.converted) / leads.total) * 100) : 0;
  const fakeRate = leads?.total && leads.total > 0 ? ((Number(leads.fake) / leads.total) * 100) : 0;

  const funnelStages = [
    { label: "Ad Spend", value: fmt(ads?.totalSpend, "$"), sub: `${fmt(ads?.totalImpressions)} impressions`, color: "oklch(0.62 0.19 258)" },
    { label: "Leads", value: fmt(ads?.totalLeads), sub: `CPL: $${Number(funnelHealth?.adsToLeads || 0).toFixed(2)}`, color: "oklch(0.68 0.18 305)" },
    { label: "Qualified", value: fmt((leads as any)?.qualified), sub: `${leads?.total ? ((Number((leads as any)?.qualified || 0) / leads.total) * 100).toFixed(0) : 0}% of leads`, color: "oklch(0.82 0.17 85)" },
    { label: "Revenue", value: fmt(ads?.totalRevenue, "$"), sub: `${roas.toFixed(1)}x ROAS`, color: "oklch(0.72 0.16 162)" },
  ];

  const chartData = (insights || []).map((d: any) => ({
    date: new Date(d.date).toLocaleDateString("en", { month: "short", day: "numeric" }),
    revenue: Number(d.revenue).toFixed(0),
    spend: Number(d.spend).toFixed(0),
    leads: d.leads,
  }));

  const countryChartData = (byCountry || []).map((d: any) => ({
    name: d.country,
    revenue: Number(d.revenue),
    spend: Number(d.spend),
  }));

  return (
    <div className="p-6 space-y-6 max-w-[1600px] mx-auto">
      <PageHeader
        title="Executive Dashboard"
        description="Real-time overview of your growth funnel performance"
        icon={LayoutDashboard}
      >
        <div className="flex items-center gap-2 text-xs text-muted-foreground bg-muted/50 px-3 py-1.5 rounded-lg border border-border">
          <Activity className="h-3.5 w-3.5 text-[oklch(0.72_0.16_162)]" />
          <span>Live · Last 30 days</span>
        </div>
      </PageHeader>

      {/* Meta Ads Data Source Banner — shown when not connected, replaced by status chip when connected */}
      {connStatus?.hasActiveConnection ? (
        // ── Connected state: subtle status strip ──────────────────────────────
        <div className="rounded-xl border border-[oklch(0.72_0.16_162)/30] bg-[oklch(0.72_0.16_162)/6] px-4 py-2.5 flex items-center justify-between gap-4">
          <div className="flex items-center gap-2.5">
            <CheckCircle2 className="h-4 w-4 text-[oklch(0.72_0.16_162)] shrink-0" />
            <span className="text-sm font-medium text-foreground">
              Meta Ads connected
              {connStatus.connectionName && (
                <span className="text-muted-foreground font-normal"> · {connStatus.connectionName}</span>
              )}
            </span>
            {connStatus.lastSyncedAt && (
              <span className="flex items-center gap-1 text-xs text-muted-foreground">
                <RefreshCw className="h-3 w-3" />
                Last synced {(() => {
                  const diff = Date.now() - new Date(connStatus.lastSyncedAt).getTime();
                  const mins = Math.floor(diff / 60000);
                  const hrs = Math.floor(mins / 60);
                  const days = Math.floor(hrs / 24);
                  if (days > 0) return `${days}d ago`;
                  if (hrs > 0) return `${hrs}h ago`;
                  if (mins > 0) return `${mins}m ago`;
                  return "just now";
                })()}
              </span>
            )}
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <button
              onClick={() => syncNow.mutate()}
              disabled={syncNow.isPending}
              className="flex items-center gap-1.5 text-xs font-semibold text-[oklch(0.72_0.16_162)] hover:text-foreground bg-[oklch(0.72_0.16_162)/10] hover:bg-[oklch(0.72_0.16_162)/20] border border-[oklch(0.72_0.16_162)/25] px-3 py-1.5 rounded-lg transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
            >
              <RefreshCw className={`h-3.5 w-3.5 ${syncNow.isPending ? 'animate-spin' : ''}`} />
              {syncNow.isPending ? 'Syncing...' : 'Sync Now'}
            </button>
            <button
              onClick={() => setLocation("/data-sources")}
              className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
            >
              Manage <ChevronRight className="h-3 w-3" />
            </button>
          </div>
        </div>
      ) : (
        // ── Not connected state: full CTA banner ─────────────────────────────
        <div className="rounded-xl border border-[oklch(0.62_0.19_258)/30] bg-gradient-to-r from-[oklch(0.62_0.19_258)/8] to-[oklch(0.68_0.18_305)/8] p-4 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="h-9 w-9 rounded-lg bg-[oklch(0.62_0.19_258)/20] flex items-center justify-center shrink-0">
              <Link2 className="h-4 w-4 text-[oklch(0.62_0.19_258)]" />
            </div>
            <div>
              <p className="text-sm font-semibold text-foreground">Connect your Meta Ads data</p>
              <p className="text-xs text-muted-foreground mt-0.5">Link your Meta Ads Manager directly or upload a CSV report to populate real performance data.</p>
            </div>
          </div>
          <div className="flex items-center gap-2 shrink-0 flex-wrap">
            <button
              onClick={() => setLocation("/data-sources?tab=api")}
              className="flex items-center gap-2 px-4 py-2 rounded-lg bg-[oklch(0.62_0.19_258)] text-white text-xs font-semibold hover:bg-[oklch(0.55_0.19_258)] transition-colors"
            >
              <Link2 className="h-3.5 w-3.5" />
              Connect Meta API
            </button>
            <button
              onClick={() => setLocation("/data-sources?tab=upload")}
              className="flex items-center gap-2 px-4 py-2 rounded-lg border border-border bg-card text-foreground text-xs font-semibold hover:bg-muted transition-colors"
            >
              <Upload className="h-3.5 w-3.5" />
              Upload CSV Report
            </button>
            <button
              onClick={() => setLocation("/data-sources")}
              className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
            >
              View all sources <ChevronRight className="h-3 w-3" />
            </button>
          </div>
        </div>
      )}

      {/* KPI Grid */}
      <h2 className="sr-only">Key Performance Indicators</h2>
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <MetricCard
          title="Total Revenue"
          value={fmt(ads?.totalRevenue, "$")}
          subtitle="Last 30 days"
          icon={DollarSign}
          status={roas >= 3 ? "green" : roas >= 1.5 ? "yellow" : "red"}
          trend={8.4}
          trendLabel="vs prev period"
        />
        <MetricCard
          title="ROAS"
          value={`${roas.toFixed(2)}x`}
          subtitle={`$${fmt(ads?.totalSpend)} spent`}
          icon={TrendingUp}
          status={roas >= 3 ? "green" : roas >= 1.5 ? "yellow" : "red"}
          trend={roas >= 3 ? 5.2 : -3.1}
          trendLabel="vs prev period"
        />
        <MetricCard
          title="Total Leads"
          value={fmt(leads?.total)}
          subtitle={`${fakeRate.toFixed(1)}% fake rate`}
          icon={Users}
          status={fakeRate < 5 ? "green" : fakeRate < 10 ? "yellow" : "red"}
          trend={12.1}
          trendLabel="vs prev period"
        />
        <MetricCard
          title="Conversion Rate"
          value={`${convRate.toFixed(1)}%`}
          subtitle={`${fmt(leads?.converted)} converted`}
          icon={Target}
          status={convRate >= 15 ? "green" : convRate >= 8 ? "yellow" : "red"}
          trend={-2.3}
          trendLabel="vs prev period"
        />
      </div>

      {/* Funnel Flow */}
      <div className="rounded-xl border border-border bg-card p-5">
        <div className="flex items-center justify-between mb-5">
          <h2 className="text-sm font-semibold text-foreground" aria-label="Marketing Funnel Flow: Ads to Leads to Qualified to Revenue">Funnel Flow</h2>
          <span className="text-xs text-muted-foreground">Ads → Leads → Qualified → Revenue</span>
        </div>
        <div className="grid grid-cols-4 gap-0 relative">
          {funnelStages.map((stage, i) => (
            <div key={stage.label} className="relative flex flex-col items-center text-center">
              <div className="relative w-full px-2">
                <div
                  className="rounded-lg p-4 border border-border/50"
                  style={{ background: `${stage.color}14` }}
                >
                  <p className="text-xs text-muted-foreground font-medium mb-1">{stage.label}</p>
                  <p className="text-2xl font-bold" style={{ color: stage.color }}>{stage.value}</p>
                  <p className="text-xs text-muted-foreground mt-1">{stage.sub}</p>
                </div>
                {i < funnelStages.length - 1 && (
                  <div className="absolute right-0 top-1/2 -translate-y-1/2 translate-x-1/2 z-10">
                    <ArrowRight className="h-4 w-4 text-muted-foreground/40" />
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Charts Row */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Revenue vs Spend Chart */}
        <div className="lg:col-span-2 rounded-xl border border-border bg-card p-5">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-sm font-semibold text-foreground">Revenue vs Ad Spend – Last 14 Days</h2>
          </div>
          <ResponsiveContainer width="100%" height={200}>
            <AreaChart data={chartData} margin={{ top: 4, right: 4, bottom: 0, left: 0 }}>
              <defs>
                <linearGradient id="revGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="oklch(0.72 0.16 162)" stopOpacity={0.25} />
                  <stop offset="95%" stopColor="oklch(0.72 0.16 162)" stopOpacity={0} />
                </linearGradient>
                <linearGradient id="spendGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="oklch(0.62 0.19 258)" stopOpacity={0.2} />
                  <stop offset="95%" stopColor="oklch(0.62 0.19 258)" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="oklch(1 0 0 / 5%)" />
              <XAxis dataKey="date" tick={{ fontSize: 10, fill: "oklch(0.58 0.012 264)" }} tickLine={false} axisLine={false} />
              <YAxis tick={{ fontSize: 10, fill: "oklch(0.58 0.012 264)" }} tickLine={false} axisLine={false} tickFormatter={v => `$${v}`} />
              <Tooltip
                contentStyle={{ background: "oklch(0.158 0.009 264)", border: "1px solid oklch(1 0 0 / 8%)", borderRadius: "8px", fontSize: "12px" }}
                labelStyle={{ color: "oklch(0.94 0.006 264)" }}
              />
              <Area type="monotone" dataKey="revenue" stroke="oklch(0.72 0.16 162)" strokeWidth={2} fill="url(#revGrad)" name="Revenue" />
              <Area type="monotone" dataKey="spend" stroke="oklch(0.62 0.19 258)" strokeWidth={2} fill="url(#spendGrad)" name="Spend" />
            </AreaChart>
          </ResponsiveContainer>
        </div>

        {/* Revenue by Country */}
        <div className="rounded-xl border border-border bg-card p-5">
          <h2 className="text-sm font-semibold text-foreground mb-4">Revenue by Country</h2>
          <ResponsiveContainer width="100%" height={200}>
            <BarChart data={countryChartData} layout="vertical" margin={{ top: 0, right: 4, bottom: 0, left: 8 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="oklch(1 0 0 / 5%)" horizontal={false} />
              <XAxis type="number" tick={{ fontSize: 10, fill: "oklch(0.58 0.012 264)" }} tickLine={false} axisLine={false} tickFormatter={v => `$${v >= 1000 ? (v/1000).toFixed(0)+'K' : v}`} />
              <YAxis type="category" dataKey="name" tick={{ fontSize: 11, fill: "oklch(0.82 0.006 264)" }} tickLine={false} axisLine={false} width={40} />
              <Tooltip
                contentStyle={{ background: "oklch(0.158 0.009 264)", border: "1px solid oklch(1 0 0 / 8%)", borderRadius: "8px", fontSize: "12px" }}
              />
              <Bar dataKey="revenue" fill="oklch(0.62 0.19 258)" radius={[0, 4, 4, 0]} name="Revenue">
                {countryChartData.map((_, i) => (
                  <Cell key={i} fill={COLORS[i % COLORS.length]} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* Bottom Row: Bottlenecks + Recommendations + Agents */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Top Bottlenecks */}
        <div className="rounded-xl border border-border bg-card p-5">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-sm font-semibold text-foreground flex items-center gap-2">
              <AlertTriangle className="h-4 w-4 text-[oklch(0.65_0.22_25)]" />
              Critical Funnel Issues
            </h2>
            <button onClick={() => setLocation("/funnel")} className="text-xs text-primary hover:underline">View all</button>
          </div>
          <div className="space-y-3">
            {(summary?.topBottlenecks || []).map((b: any) => (
              <div key={b.id} className="flex items-start gap-3 p-3 rounded-lg bg-muted/30 border border-border/50">
                <SeverityBadge severity={b.severity} />
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-medium text-foreground truncate">{b.title}</p>
                  {b.revenueImpact && (
                    <p className="text-xs text-muted-foreground mt-0.5">Impact: ${Number(b.revenueImpact).toLocaleString()}</p>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Top Recommendations */}
        <div className="rounded-xl border border-border bg-card p-5">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-sm font-semibold text-foreground flex items-center gap-2">
              <Lightbulb className="h-4 w-4 text-[oklch(0.82_0.17_85)]" />
              Top AI-Recommended Actions
            </h2>
            <button onClick={() => setLocation("/recommendations")} className="text-xs text-primary hover:underline">View all</button>
          </div>
          <div className="space-y-3">
            {(summary?.topRecommendations || []).map((r: any, i: number) => (
              <div key={r.id} className="flex items-start gap-3 p-3 rounded-lg bg-muted/30 border border-border/50">
                <div className="h-5 w-5 rounded-full bg-primary/20 flex items-center justify-center text-xs font-bold text-primary shrink-0 mt-0.5">{i + 1}</div>
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-medium text-foreground truncate">{r.title}</p>
                  {r.estimatedImpact && (
                    <p className="text-xs text-[oklch(0.72_0.16_162)] mt-0.5">+${Number(r.estimatedImpact).toLocaleString()} potential</p>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Agent Leaderboard */}
        <div className="rounded-xl border border-border bg-card p-5">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-sm font-semibold text-foreground flex items-center gap-2">
              <Zap className="h-4 w-4 text-primary" />
              Sales Agent Performance
            </h2>
            <button onClick={() => setLocation("/leaderboard")} className="text-xs text-primary hover:underline">Full board</button>
          </div>
          <div className="space-y-2">
            {(byAgent || []).slice(0, 5).map((a: any, i: number) => {
              const cr = Number(a.conversionRate);
              const status = cr >= 15 ? "green" : cr >= 8 ? "yellow" : "red";
              return (
                <div key={a.id} className="flex items-center gap-3">
                  <span className="text-xs font-bold text-muted-foreground w-4 shrink-0">{i + 1}</span>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between">
                      <p className="text-xs font-medium text-foreground truncate">{a.name}</p>
                      <StatusBadge status={status} label={`${cr.toFixed(1)}%`} />
                    </div>
                    <div className="mt-1 h-1 rounded-full bg-muted overflow-hidden">
                      <div
                        className="h-full rounded-full"
                        style={{
                          width: `${Math.min(100, cr * 4)}%`,
                          background: status === "green" ? "oklch(0.72 0.16 162)" : status === "yellow" ? "oklch(0.82 0.17 85)" : "oklch(0.65 0.22 25)"
                        }}
                      />
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}
