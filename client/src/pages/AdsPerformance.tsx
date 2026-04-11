import DashboardLayout from "@/components/DashboardLayout";
import { trpc } from "@/lib/trpc";
import { MetricCard } from "@/components/ui/MetricCard";
import { PageHeader } from "@/components/ui/PageHeader";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { TrendingUp, DollarSign, MousePointer, Users, Globe, Link2, Upload } from "lucide-react";
import { useState } from "react";
import { useLocation } from "wouter";
import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  BarChart, Bar, Legend, LineChart, Line
} from "recharts";

function fmt(n: any, prefix = "", decimals = 0) {
  const v = Number(n || 0);
  if (v >= 1000000) return `${prefix}${(v / 1000000).toFixed(1)}M`;
  if (v >= 1000) return `${prefix}${(v / 1000).toFixed(1)}K`;
  return `${prefix}${v.toFixed(decimals)}`;
}

const CHART_COLORS = ["oklch(0.62 0.19 258)", "oklch(0.72 0.16 162)", "oklch(0.82 0.17 85)", "oklch(0.65 0.22 25)", "oklch(0.68 0.18 305)", "oklch(0.75 0.15 200)"];

type SortKey = "spend" | "leads" | "conversions" | "revenue" | "avgCtr" | "avgCpl";

export default function AdsPerformance() {
  const [, setLocation] = useLocation();
  const { data: campaigns, isLoading } = trpc.ads.campaigns.useQuery();
  const { data: insights } = trpc.ads.insights.useQuery({ days: 30 });
  const { data: byCountry } = trpc.ads.byCountry.useQuery();
  const { data: adSets } = trpc.ads.adSets.useQuery();
  const [tab, setTab] = useState<"campaigns" | "adsets" | "country">("campaigns");
  const [sortKey, setSortKey] = useState<SortKey>("spend");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");

  const handleSort = (key: SortKey) => {
    if (sortKey === key) setSortDir(d => d === "asc" ? "desc" : "asc");
    else { setSortKey(key); setSortDir("desc"); }
  };

  const totalSpend = (campaigns || []).reduce((s: number, c: any) => s + Number(c.spend || 0), 0);
  const totalLeads = (campaigns || []).reduce((s: number, c: any) => s + Number(c.leads || 0), 0);
  const totalRevenue = (campaigns || []).reduce((s: number, c: any) => s + Number(c.revenue || 0), 0);
  const avgCtr = campaigns?.length ? (campaigns as any[]).reduce((s: number, c: any) => s + Number(c.avgCtr || 0), 0) / campaigns.length : 0;

  const chartData = (insights || []).map((d: any) => ({
    date: new Date(d.date).toLocaleDateString("en", { month: "short", day: "numeric" }),
    spend: Number(d.spend).toFixed(0),
    leads: d.leads,
    cpl: Number(d.avgCpl).toFixed(2),
    ctr: Number(d.avgCtr).toFixed(3),
    revenue: Number(d.revenue).toFixed(0),
  }));

  const sortedCampaigns = [...(campaigns || [])].sort((a: any, b: any) => {
    const av = Number(a[sortKey] || 0), bv = Number(b[sortKey] || 0);
    return sortDir === "desc" ? bv - av : av - bv;
  });

  const sortedAdSets = [...(adSets || [])].sort((a: any, b: any) => {
    const av = Number(a[sortKey] || 0), bv = Number(b[sortKey] || 0);
    return sortDir === "desc" ? bv - av : av - bv;
  });

  const SortBtn = ({ k, label }: { k: SortKey; label: string }) => (
    <button
      onClick={() => handleSort(k)}
      className={`text-xs font-medium px-2 py-1 rounded hover:bg-muted/50 transition-colors ${sortKey === k ? "text-primary" : "text-muted-foreground"}`}
    >
      {label} {sortKey === k ? (sortDir === "desc" ? "↓" : "↑") : ""}
    </button>
  );

  return (
    <div className="p-6 space-y-6 max-w-[1600px] mx-auto">
      <PageHeader
        title="Ads Performance"
        description="Meta Ads campaigns, ad sets, and creative performance"
        icon={TrendingUp}
      >
        <div className="flex items-center gap-2">
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
        </div>
      </PageHeader>

      {/* KPIs */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <MetricCard title="Total Spend" value={fmt(totalSpend, "$")} icon={DollarSign} status="blue" subtitle="Last 30 days" />
        <MetricCard title="Total Leads" value={fmt(totalLeads)} icon={Users}
          status={totalLeads > 0 ? (totalSpend / totalLeads < 5 ? "green" : totalSpend / totalLeads < 8 ? "yellow" : "red") : "neutral"}
          subtitle={`CPL: $${totalLeads > 0 ? (totalSpend / totalLeads).toFixed(2) : "0"}`}
        />
        <MetricCard title="Total Revenue" value={fmt(totalRevenue, "$")} icon={TrendingUp}
          status={totalSpend > 0 ? (totalRevenue / totalSpend >= 3 ? "green" : totalRevenue / totalSpend >= 1.5 ? "yellow" : "red") : "neutral"}
          subtitle={`ROAS: ${totalSpend > 0 ? (totalRevenue / totalSpend).toFixed(2) : "0"}x`}
        />
        <MetricCard title="Avg CTR" value={`${avgCtr.toFixed(3)}%`} icon={MousePointer}
          status={avgCtr >= 2 ? "green" : avgCtr >= 1 ? "yellow" : "red"}
          subtitle="Click-through rate"
        />
      </div>

      {/* Charts */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="rounded-xl border border-border bg-card p-5">
          <h2 className="text-sm font-semibold mb-4">Spend & Revenue Trend</h2>
          <ResponsiveContainer width="100%" height={200}>
            <AreaChart data={chartData}>
              <defs>
                <linearGradient id="revG" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="oklch(0.72 0.16 162)" stopOpacity={0.3} />
                  <stop offset="95%" stopColor="oklch(0.72 0.16 162)" stopOpacity={0} />
                </linearGradient>
                <linearGradient id="spG" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="oklch(0.62 0.19 258)" stopOpacity={0.2} />
                  <stop offset="95%" stopColor="oklch(0.62 0.19 258)" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="oklch(1 0 0 / 5%)" />
              <XAxis dataKey="date" tick={{ fontSize: 10, fill: "oklch(0.58 0.012 264)" }} tickLine={false} axisLine={false} />
              <YAxis tick={{ fontSize: 10, fill: "oklch(0.58 0.012 264)" }} tickLine={false} axisLine={false} tickFormatter={v => `$${v}`} />
              <Tooltip contentStyle={{ background: "oklch(0.158 0.009 264)", border: "1px solid oklch(1 0 0 / 8%)", borderRadius: "8px", fontSize: "12px" }} />
              <Area type="monotone" dataKey="revenue" stroke="oklch(0.72 0.16 162)" strokeWidth={2} fill="url(#revG)" name="Revenue ($)" />
              <Area type="monotone" dataKey="spend" stroke="oklch(0.62 0.19 258)" strokeWidth={2} fill="url(#spG)" name="Spend ($)" />
            </AreaChart>
          </ResponsiveContainer>
        </div>

        <div className="rounded-xl border border-border bg-card p-5">
          <h2 className="text-sm font-semibold mb-4">Leads & CPL Trend</h2>
          <ResponsiveContainer width="100%" height={200}>
            <LineChart data={chartData}>
              <CartesianGrid strokeDasharray="3 3" stroke="oklch(1 0 0 / 5%)" />
              <XAxis dataKey="date" tick={{ fontSize: 10, fill: "oklch(0.58 0.012 264)" }} tickLine={false} axisLine={false} />
              <YAxis yAxisId="left" tick={{ fontSize: 10, fill: "oklch(0.58 0.012 264)" }} tickLine={false} axisLine={false} />
              <YAxis yAxisId="right" orientation="right" tick={{ fontSize: 10, fill: "oklch(0.58 0.012 264)" }} tickLine={false} axisLine={false} tickFormatter={v => `$${v}`} />
              <Tooltip contentStyle={{ background: "oklch(0.158 0.009 264)", border: "1px solid oklch(1 0 0 / 8%)", borderRadius: "8px", fontSize: "12px" }} />
              <Line yAxisId="left" type="monotone" dataKey="leads" stroke="oklch(0.68 0.18 305)" strokeWidth={2} dot={false} name="Leads" />
              <Line yAxisId="right" type="monotone" dataKey="cpl" stroke="oklch(0.82 0.17 85)" strokeWidth={2} dot={false} name="CPL ($)" />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* Tabs */}
      <div className="rounded-xl border border-border bg-card overflow-hidden">
        <div className="flex border-b border-border">
          {(["campaigns", "adsets", "country"] as const).map(t => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={`px-5 py-3 text-sm font-medium capitalize transition-colors ${tab === t ? "text-primary border-b-2 border-primary bg-primary/5" : "text-muted-foreground hover:text-foreground"}`}
            >
              {t === "adsets" ? "Ad Sets" : t === "country" ? "By Country" : "Campaigns"}
            </button>
          ))}
        </div>

        {tab === "campaigns" && (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border bg-muted/20">
                  <th className="text-left px-4 py-3 text-xs font-semibold text-muted-foreground">Campaign</th>
                  <th className="text-left px-4 py-3"><SortBtn k="spend" label="Spend" /></th>
                  <th className="text-left px-4 py-3"><SortBtn k="leads" label="Leads" /></th>
                  <th className="text-left px-4 py-3"><SortBtn k="avgCpl" label="CPL" /></th>
                  <th className="text-left px-4 py-3"><SortBtn k="avgCtr" label="CTR" /></th>
                  <th className="text-left px-4 py-3"><SortBtn k="conversions" label="Conv." /></th>
                  <th className="text-left px-4 py-3"><SortBtn k="revenue" label="Revenue" /></th>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-muted-foreground">ROAS</th>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-muted-foreground">Status</th>
                </tr>
              </thead>
              <tbody>
                {sortedCampaigns.map((c: any) => {
                  const roas = c.spend > 0 ? Number(c.revenue) / Number(c.spend) : 0;
                  const cplStatus = Number(c.avgCpl) < 5 ? "green" : Number(c.avgCpl) < 8 ? "yellow" : "red";
                  return (
                    <tr key={c.id} className="border-b border-border/50 hover:bg-muted/20 transition-colors">
                      <td className="px-4 py-3">
                        <div>
                          <p className="font-medium text-foreground text-xs">{c.name}</p>
                          <p className="text-xs text-muted-foreground mt-0.5">{c.country}</p>
                        </div>
                      </td>
                      <td className="px-4 py-3 text-xs font-mono">${Number(c.spend).toFixed(0)}</td>
                      <td className="px-4 py-3 text-xs font-mono">{Number(c.leads).toFixed(0)}</td>
                      <td className="px-4 py-3">
                        <StatusBadge status={cplStatus} label={`$${Number(c.avgCpl).toFixed(2)}`} />
                      </td>
                      <td className="px-4 py-3 text-xs font-mono">{Number(c.avgCtr).toFixed(3)}%</td>
                      <td className="px-4 py-3 text-xs font-mono">{Number(c.conversions).toFixed(0)}</td>
                      <td className="px-4 py-3 text-xs font-mono text-[oklch(0.72_0.16_162)]">${Number(c.revenue).toFixed(0)}</td>
                      <td className="px-4 py-3">
                        <StatusBadge status={roas >= 3 ? "green" : roas >= 1.5 ? "yellow" : "red"} label={`${roas.toFixed(1)}x`} />
                      </td>
                      <td className="px-4 py-3">
                        <StatusBadge
                          status={c.status === "active" ? "green" : "gray"}
                          label={c.status}
                        />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        {tab === "adsets" && (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border bg-muted/20">
                  <th className="text-left px-4 py-3 text-xs font-semibold text-muted-foreground">Ad Set</th>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-muted-foreground">Bid Strategy</th>
                  <th className="text-left px-4 py-3"><SortBtn k="spend" label="Spend" /></th>
                  <th className="text-left px-4 py-3"><SortBtn k="leads" label="Leads" /></th>
                  <th className="text-left px-4 py-3"><SortBtn k="avgCpl" label="CPL" /></th>
                  <th className="text-left px-4 py-3"><SortBtn k="avgCtr" label="CTR" /></th>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-muted-foreground">Status</th>
                </tr>
              </thead>
              <tbody>
                {sortedAdSets.map((a: any) => (
                  <tr key={a.id} className="border-b border-border/50 hover:bg-muted/20 transition-colors">
                    <td className="px-4 py-3 text-xs font-medium text-foreground">{a.name}</td>
                    <td className="px-4 py-3 text-xs text-muted-foreground">{a.bidStrategy}</td>
                    <td className="px-4 py-3 text-xs font-mono">${Number(a.spend).toFixed(0)}</td>
                    <td className="px-4 py-3 text-xs font-mono">{Number(a.leads).toFixed(0)}</td>
                    <td className="px-4 py-3">
                      <StatusBadge status={Number(a.avgCpl) < 5 ? "green" : Number(a.avgCpl) < 8 ? "yellow" : "red"} label={`$${Number(a.avgCpl).toFixed(2)}`} />
                    </td>
                    <td className="px-4 py-3 text-xs font-mono">{Number(a.avgCtr).toFixed(3)}%</td>
                    <td className="px-4 py-3">
                      <StatusBadge status={a.status === "active" ? "green" : "gray"} label={a.status} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {tab === "country" && (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border bg-muted/20">
                  <th className="text-left px-4 py-3 text-xs font-semibold text-muted-foreground">Country</th>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-muted-foreground">Spend</th>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-muted-foreground">Leads</th>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-muted-foreground">CPL</th>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-muted-foreground">CTR</th>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-muted-foreground">Conversions</th>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-muted-foreground">Revenue</th>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-muted-foreground">ROAS</th>
                </tr>
              </thead>
              <tbody>
                {(byCountry || []).map((c: any) => {
                  const roas = c.spend > 0 ? Number(c.revenue) / Number(c.spend) : 0;
                  return (
                    <tr key={c.country} className="border-b border-border/50 hover:bg-muted/20 transition-colors">
                      <td className="px-4 py-3 font-medium text-xs flex items-center gap-2">
                        <Globe className="h-3.5 w-3.5 text-muted-foreground" />
                        {c.country}
                      </td>
                      <td className="px-4 py-3 text-xs font-mono">${Number(c.spend).toFixed(0)}</td>
                      <td className="px-4 py-3 text-xs font-mono">{Number(c.leads).toFixed(0)}</td>
                      <td className="px-4 py-3">
                        <StatusBadge status={Number(c.avgCpl) < 5 ? "green" : Number(c.avgCpl) < 8 ? "yellow" : "red"} label={`$${Number(c.avgCpl).toFixed(2)}`} />
                      </td>
                      <td className="px-4 py-3 text-xs font-mono">{Number(c.avgCtr).toFixed(3)}%</td>
                      <td className="px-4 py-3 text-xs font-mono">{Number(c.conversions).toFixed(0)}</td>
                      <td className="px-4 py-3 text-xs font-mono text-[oklch(0.72_0.16_162)]">${Number(c.revenue).toFixed(0)}</td>
                      <td className="px-4 py-3">
                        <StatusBadge status={roas >= 3 ? "green" : roas >= 1.5 ? "yellow" : "red"} label={`${roas.toFixed(1)}x`} />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
