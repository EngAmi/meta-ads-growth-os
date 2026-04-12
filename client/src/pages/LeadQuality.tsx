import DashboardLayout from "@/components/DashboardLayout";
import { trpc } from "@/lib/trpc";
import { MetricCard } from "@/components/ui/MetricCard";
import { PageHeader } from "@/components/ui/PageHeader";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { Users, ShieldAlert, Clock, Target, Filter, Link2, Upload, CheckCircle2, RefreshCw, ChevronRight } from "lucide-react";
import { useState } from "react";
import { useLocation } from "wouter";
import { PieChart, Pie, Cell, Tooltip, ResponsiveContainer, BarChart, Bar, XAxis, YAxis, CartesianGrid } from "recharts";

function fmt(n: any, decimals = 0) {
  return Number(n || 0).toFixed(decimals);
}

const INTENT_COLORS: Record<string, string> = {
  high: "oklch(0.72 0.16 162)",
  medium: "oklch(0.82 0.17 85)",
  low: "oklch(0.65 0.22 25)",
};

const STATUS_COLORS: Record<string, string> = {
  new: "oklch(0.62 0.19 258)",
  contacted: "oklch(0.68 0.18 305)",
  qualified: "oklch(0.72 0.16 162)",
  unqualified: "oklch(0.65 0.22 25)",
  converted: "oklch(0.72 0.16 162)",
  lost: "oklch(0.5 0.01 264)",
};

export default function LeadQuality() {
  const [, setLocation] = useLocation();
  const { data: connStatus } = trpc.dataSources.connectionStatus.useQuery();
  const { data: stats } = trpc.leads.stats.useQuery();
  const { data: byCountry } = trpc.leads.byCountry.useQuery();
  const { data: byCampaign } = trpc.leads.byCampaign.useQuery();
  const [statusFilter, setStatusFilter] = useState("");
  const [intentFilter, setIntentFilter] = useState("");
  const [countryFilter, setCountryFilter] = useState("");
  const { data: leadsData } = trpc.leads.list.useQuery({
    limit: 50,
    status: statusFilter || undefined,
    intent: intentFilter || undefined,
    country: countryFilter || undefined,
  });

  const total = Number(stats?.total || 0);
  const converted = Number(stats?.converted || 0);
  const fake = Number(stats?.fake || 0);
  const highIntent = Number(stats?.highIntent || 0);
  const avgResponseMin = (Number(stats?.avgResponseTime || 0) / 60).toFixed(1);

  const intentData = [
    { name: "High Intent", value: Number(stats?.highIntent || 0), color: INTENT_COLORS.high },
    { name: "Medium Intent", value: Number(stats?.mediumIntent || 0), color: INTENT_COLORS.medium },
    { name: "Low Intent", value: Number(stats?.lowIntent || 0), color: INTENT_COLORS.low },
  ];

  const statusData = [
    { name: "New", value: total - Number(stats?.converted || 0) - Number(stats?.qualified || 0) - Number(stats?.unqualified || 0) },
    { name: "Qualified", value: Number((stats as any)?.qualified || 0) },
    { name: "Converted", value: converted },
    { name: "Unqualified", value: Number((stats as any)?.unqualified || 0) },
  ].filter(d => d.value > 0);

  const countryChartData = (byCountry || []).map((c: any) => ({
    country: c.country,
    total: Number(c.total),
    converted: Number(c.converted),
    fake: Number(c.fake),
    avgScore: Number(c.avgScore).toFixed(0),
    convRate: c.total > 0 ? ((Number(c.converted) / Number(c.total)) * 100).toFixed(1) : 0,
  }));

  const intentStatus = (intent: string) => intent === "high" ? "green" : intent === "medium" ? "yellow" : "red";
  const responseStatus = (seconds: number) => seconds < 120 ? "green" : seconds < 300 ? "yellow" : "red";

  return (
    <div className="p-6 space-y-6 max-w-[1600px] mx-auto">
      <PageHeader
        title="Lead Quality Engine"
        description="Lead scoring, intent classification, fake detection, and response time analysis"
        icon={Users}
      >
        <div className="flex items-center gap-2">
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

      {/* KPIs */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <MetricCard
          title="Total Leads"
          value={total.toLocaleString()}
          subtitle={`${converted} converted`}
          icon={Users}
          status={total > 0 ? "blue" : "neutral"}
        />
        <MetricCard
          title="High Intent"
          value={`${total > 0 ? ((highIntent / total) * 100).toFixed(1) : 0}%`}
          subtitle={`${highIntent} leads`}
          icon={Target}
          status={highIntent / total > 0.3 ? "green" : highIntent / total > 0.15 ? "yellow" : "red"}
        />
        <MetricCard
          title="Fake Lead Rate"
          value={`${total > 0 ? ((fake / total) * 100).toFixed(1) : 0}%`}
          subtitle={`${fake} flagged`}
          icon={ShieldAlert}
          status={fake / total < 0.03 ? "green" : fake / total < 0.08 ? "yellow" : "red"}
        />
        <MetricCard
          title="Avg Response Time"
          value={`${avgResponseMin} min`}
          subtitle="First contact"
          icon={Clock}
          status={Number(avgResponseMin) < 2 ? "green" : Number(avgResponseMin) < 5 ? "yellow" : "red"}
        />
      </div>

      {/* Charts Row */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Intent Distribution */}
        <div className="rounded-xl border border-border bg-card p-5">
          <h2 className="text-sm font-semibold mb-4">Intent Distribution</h2>
          <ResponsiveContainer width="100%" height={180}>
            <PieChart>
              <Pie data={intentData} cx="50%" cy="50%" innerRadius={50} outerRadius={75} paddingAngle={3} dataKey="value">
                {intentData.map((entry, i) => <Cell key={i} fill={entry.color} />)}
              </Pie>
              <Tooltip contentStyle={{ background: "oklch(0.158 0.009 264)", border: "1px solid oklch(1 0 0 / 8%)", borderRadius: "8px", fontSize: "12px" }} />
            </PieChart>
          </ResponsiveContainer>
          <div className="flex justify-center gap-4 mt-2">
            {intentData.map(d => (
              <div key={d.name} className="flex items-center gap-1.5">
                <div className="h-2 w-2 rounded-full" style={{ background: d.color }} />
                <span className="text-xs text-muted-foreground">{d.name}: <span className="text-foreground font-medium">{d.value}</span></span>
              </div>
            ))}
          </div>
        </div>

        {/* Country Performance */}
        <div className="lg:col-span-2 rounded-xl border border-border bg-card p-5">
          <h2 className="text-sm font-semibold mb-4">Lead Quality by Country</h2>
          <ResponsiveContainer width="100%" height={180}>
            <BarChart data={countryChartData}>
              <CartesianGrid strokeDasharray="3 3" stroke="oklch(1 0 0 / 5%)" />
              <XAxis dataKey="country" tick={{ fontSize: 11, fill: "oklch(0.82 0.006 264)" }} tickLine={false} axisLine={false} />
              <YAxis tick={{ fontSize: 10, fill: "oklch(0.58 0.012 264)" }} tickLine={false} axisLine={false} />
              <Tooltip contentStyle={{ background: "oklch(0.158 0.009 264)", border: "1px solid oklch(1 0 0 / 8%)", borderRadius: "8px", fontSize: "12px" }} />
              <Bar dataKey="total" fill="oklch(0.62 0.19 258)" name="Total Leads" radius={[4, 4, 0, 0]} />
              <Bar dataKey="converted" fill="oklch(0.72 0.16 162)" name="Converted" radius={[4, 4, 0, 0]} />
              <Bar dataKey="fake" fill="oklch(0.65 0.22 25)" name="Fake" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* Campaign Lead Quality */}
      <div className="rounded-xl border border-border bg-card p-5">
        <h2 className="text-sm font-semibold mb-4">Lead Quality by Campaign</h2>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border bg-muted/20">
                <th className="text-left px-4 py-3 text-xs font-semibold text-muted-foreground">Campaign</th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-muted-foreground">Total Leads</th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-muted-foreground">Converted</th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-muted-foreground">Conv. Rate</th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-muted-foreground">Fake Leads</th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-muted-foreground">Avg Score</th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-muted-foreground">Quality</th>
              </tr>
            </thead>
            <tbody>
              {(byCampaign || []).map((c: any) => {
                const cr = Number(c.conversionRate);
                const fakeR = c.total > 0 ? (Number(c.fake) / Number(c.total)) * 100 : 0;
                const quality = cr >= 15 && fakeR < 5 ? "green" : cr >= 8 || fakeR < 10 ? "yellow" : "red";
                return (
                  <tr key={c.campaignId} className="border-b border-border/50 hover:bg-muted/20 transition-colors">
                    <td className="px-4 py-3 text-xs font-medium text-foreground">{c.name || `Campaign ${c.campaignId}`}</td>
                    <td className="px-4 py-3 text-xs font-mono">{Number(c.total).toLocaleString()}</td>
                    <td className="px-4 py-3 text-xs font-mono">{Number(c.converted).toLocaleString()}</td>
                    <td className="px-4 py-3">
                      <StatusBadge status={cr >= 15 ? "green" : cr >= 8 ? "yellow" : "red"} label={`${cr.toFixed(1)}%`} />
                    </td>
                    <td className="px-4 py-3">
                      <StatusBadge status={fakeR < 3 ? "green" : fakeR < 8 ? "yellow" : "red"} label={`${fakeR.toFixed(1)}%`} />
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        <div className="flex-1 h-1.5 bg-muted rounded-full overflow-hidden">
                          <div className="h-full rounded-full bg-primary" style={{ width: `${Number(c.avgScore)}%` }} />
                        </div>
                        <span className="text-xs font-mono text-muted-foreground w-6">{Number(c.avgScore).toFixed(0)}</span>
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <StatusBadge status={quality} label={quality === "green" ? "High" : quality === "yellow" ? "Medium" : "Low"} />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* Lead Table with Filters */}
      <div className="rounded-xl border border-border bg-card overflow-hidden">
        <div className="flex items-center gap-3 p-4 border-b border-border flex-wrap">
          <Filter className="h-4 w-4 text-muted-foreground shrink-0" />
          <span className="text-sm font-medium text-foreground">Filter Leads</span>
          <select
            value={statusFilter}
            onChange={e => setStatusFilter(e.target.value)}
            className="text-xs bg-muted border border-border rounded-lg px-3 py-1.5 text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
          >
            <option value="">All Statuses</option>
            {["new", "contacted", "qualified", "unqualified", "converted", "lost"].map(s => (
              <option key={s} value={s}>{s.charAt(0).toUpperCase() + s.slice(1)}</option>
            ))}
          </select>
          <select
            value={intentFilter}
            onChange={e => setIntentFilter(e.target.value)}
            className="text-xs bg-muted border border-border rounded-lg px-3 py-1.5 text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
          >
            <option value="">All Intent Levels</option>
            {["high", "medium", "low"].map(i => (
              <option key={i} value={i}>{i.charAt(0).toUpperCase() + i.slice(1)} Intent</option>
            ))}
          </select>
          <select
            value={countryFilter}
            onChange={e => setCountryFilter(e.target.value)}
            className="text-xs bg-muted border border-border rounded-lg px-3 py-1.5 text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
          >
            <option value="">All Countries</option>
            {["Egypt", "UAE", "KSA", "Qatar"].map(c => (
              <option key={c} value={c}>{c}</option>
            ))}
          </select>
          <span className="text-xs text-muted-foreground ml-auto">{leadsData?.total || 0} leads</span>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border bg-muted/20">
                <th className="text-left px-4 py-3 text-xs font-semibold text-muted-foreground">Lead</th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-muted-foreground">Country</th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-muted-foreground">Status</th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-muted-foreground">Intent</th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-muted-foreground">Score</th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-muted-foreground">Response</th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-muted-foreground">Fake</th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-muted-foreground">Date</th>
              </tr>
            </thead>
            <tbody>
              {(leadsData?.data || []).map((l: any) => {
                const rtMin = l.responseTimeSeconds ? (l.responseTimeSeconds / 60).toFixed(1) : null;
                return (
                  <tr key={l.id} className={`border-b border-border/50 hover:bg-muted/20 transition-colors ${l.isFake ? "opacity-60" : ""}`}>
                    <td className="px-4 py-3 text-xs font-medium text-foreground">{l.name}</td>
                    <td className="px-4 py-3 text-xs text-muted-foreground">{l.country}</td>
                    <td className="px-4 py-3">
                      <StatusBadge
                        status={l.status === "converted" ? "green" : l.status === "qualified" ? "blue" : l.status === "unqualified" || l.status === "lost" ? "red" : "gray"}
                        label={l.status}
                      />
                    </td>
                    <td className="px-4 py-3">
                      <StatusBadge status={intentStatus(l.intentLevel || "low")} label={l.intentLevel || "low"} />
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        <div className="w-12 h-1.5 bg-muted rounded-full overflow-hidden">
                          <div className="h-full rounded-full" style={{
                            width: `${l.leadScore}%`,
                            background: l.leadScore >= 70 ? "oklch(0.72 0.16 162)" : l.leadScore >= 40 ? "oklch(0.82 0.17 85)" : "oklch(0.65 0.22 25)"
                          }} />
                        </div>
                        <span className="text-xs font-mono text-muted-foreground">{l.leadScore}</span>
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      {rtMin ? (
                        <StatusBadge status={responseStatus(l.responseTimeSeconds)} label={`${rtMin}m`} />
                      ) : <span className="text-xs text-muted-foreground">—</span>}
                    </td>
                    <td className="px-4 py-3">
                      {l.isFake ? (
                        <StatusBadge status="red" label="Fake" />
                      ) : (
                        <StatusBadge status="green" label="Real" />
                      )}
                    </td>
                    <td className="px-4 py-3 text-xs text-muted-foreground">
                      {new Date(l.createdAt).toLocaleDateString("en", { month: "short", day: "numeric" })}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
