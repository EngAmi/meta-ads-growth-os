import { trpc } from "@/lib/trpc";
import { PageHeader } from "@/components/ui/PageHeader";
import { MetricCard } from "@/components/ui/MetricCard";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { BarChart2, TrendingUp, DollarSign, Users, Target, ArrowUpRight, ArrowDownRight } from "lucide-react";
import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  BarChart, Bar, Legend
} from "recharts";

function fmt(n: any, prefix = "", decimals = 0) {
  const v = Number(n || 0);
  if (v >= 1000000) return `${prefix}${(v / 1000000).toFixed(1)}M`;
  if (v >= 1000) return `${prefix}${(v / 1000).toFixed(1)}K`;
  return `${prefix}${v.toFixed(decimals)}`;
}

function pct(a: any, b: any) {
  const av = Number(a || 0), bv = Number(b || 0);
  if (bv === 0) return 0;
  return ((av - bv) / bv) * 100;
}

export default function WeeklyReports() {
  const { data: reports, isLoading } = trpc.weeklyReports.list.useQuery();
  const { data: latest } = trpc.weeklyReports.latest.useQuery();
  const { data: trend } = trpc.weeklyReports.trend.useQuery();

  const trendData = (trend || []).map((d: any) => ({
    date: new Date(d.date).toLocaleDateString("en", { month: "short", day: "numeric" }),
    revenue: Number(d.revenue).toFixed(0),
    spend: Number(d.spend).toFixed(0),
    leads: Number(d.leads),
  }));

  const weeklyData = (reports || []).map((r: any) => ({
    week: `W${new Date(r.weekStart).toLocaleDateString("en", { month: "short", day: "numeric" })}`,
    revenue: Number(r.totalRevenue),
    spend: Number(r.totalSpend),
    leads: Number(r.totalLeads),
    conversions: Number(r.totalConversions),
    roas: Number(r.avgRoas),
  })).reverse();

  const prev = reports?.[1];
  const curr = latest;

  return (
    <div className="p-6 space-y-6 max-w-[1600px] mx-auto">
      <PageHeader
        title="Weekly Performance Reports"
        description="Growth trends, week-over-week comparisons, and strategic insights"
        icon={BarChart2}
      />

      {/* This Week vs Last Week */}
      {curr && (
        <div className="rounded-xl border border-border bg-card p-5">
          <div className="flex items-center justify-between mb-5">
            <h2 className="text-sm font-semibold text-foreground">This Week vs Last Week</h2>
            <StatusBadge
              status={Number(curr.totalRevenue) >= Number(prev?.totalRevenue || 0) ? "green" : "red"}
              label={Number(curr.totalRevenue) >= Number(prev?.totalRevenue || 0) ? "Growing" : "Declining"}
            />
          </div>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            {[
              { label: "Revenue", curr: curr.totalRevenue, prev: prev?.totalRevenue, prefix: "$", icon: DollarSign },
              { label: "Ad Spend", curr: curr.totalSpend, prev: prev?.totalSpend, prefix: "$", icon: TrendingUp },
              { label: "Leads", curr: curr.totalLeads, prev: prev?.totalLeads, prefix: "", icon: Users },
              { label: "Conversions", curr: curr.totalConversions, prev: prev?.totalConversions, prefix: "", icon: Target },
            ].map(item => {
              const change = pct(item.curr, item.prev);
              const isPositive = change >= 0;
              return (
                <div key={item.label} className="rounded-xl border border-border bg-muted/20 p-4">
                  <div className="flex items-center justify-between mb-2">
                    <p className="text-xs text-muted-foreground font-medium uppercase tracking-wide">{item.label}</p>
                    <item.icon className="h-4 w-4 text-muted-foreground" />
                  </div>
                  <p className="text-2xl font-bold text-foreground">{item.prefix}{fmt(item.curr)}</p>
                  <div className="flex items-center gap-1 mt-2">
                    {isPositive
                      ? <ArrowUpRight className="h-3.5 w-3.5 text-[oklch(0.72_0.16_162)]" />
                      : <ArrowDownRight className="h-3.5 w-3.5 text-[oklch(0.65_0.22_25)]" />}
                    <span className={`text-xs font-medium ${isPositive ? "text-[oklch(0.72_0.16_162)]" : "text-[oklch(0.65_0.22_25)]"}`}>
                      {isPositive ? "+" : ""}{change.toFixed(1)}% vs last week
                    </span>
                  </div>
                  <p className="text-xs text-muted-foreground mt-1">
                    Last: {item.prefix}{fmt(item.prev)}
                  </p>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* 28-Day Trend */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className="lg:col-span-2 rounded-xl border border-border bg-card p-5">
          <h2 className="text-sm font-semibold mb-4">28-Day Revenue & Spend Trend</h2>
          <ResponsiveContainer width="100%" height={220}>
            <AreaChart data={trendData}>
              <defs>
                <linearGradient id="wRevG" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="oklch(0.72 0.16 162)" stopOpacity={0.3} />
                  <stop offset="95%" stopColor="oklch(0.72 0.16 162)" stopOpacity={0} />
                </linearGradient>
                <linearGradient id="wSpG" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="oklch(0.62 0.19 258)" stopOpacity={0.2} />
                  <stop offset="95%" stopColor="oklch(0.62 0.19 258)" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="oklch(1 0 0 / 5%)" />
              <XAxis dataKey="date" tick={{ fontSize: 10, fill: "oklch(0.58 0.012 264)" }} tickLine={false} axisLine={false} interval={3} />
              <YAxis tick={{ fontSize: 10, fill: "oklch(0.58 0.012 264)" }} tickLine={false} axisLine={false} tickFormatter={v => `$${v}`} />
              <Tooltip contentStyle={{ background: "oklch(0.158 0.009 264)", border: "1px solid oklch(1 0 0 / 8%)", borderRadius: "8px", fontSize: "12px" }} />
              <Area type="monotone" dataKey="revenue" stroke="oklch(0.72 0.16 162)" strokeWidth={2} fill="url(#wRevG)" name="Revenue ($)" />
              <Area type="monotone" dataKey="spend" stroke="oklch(0.62 0.19 258)" strokeWidth={2} fill="url(#wSpG)" name="Spend ($)" />
            </AreaChart>
          </ResponsiveContainer>
        </div>

        <div className="rounded-xl border border-border bg-card p-5">
          <h2 className="text-sm font-semibold mb-4">Weekly Leads Trend</h2>
          <ResponsiveContainer width="100%" height={220}>
            <AreaChart data={trendData}>
              <defs>
                <linearGradient id="wLeadG" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="oklch(0.68 0.18 305)" stopOpacity={0.3} />
                  <stop offset="95%" stopColor="oklch(0.68 0.18 305)" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="oklch(1 0 0 / 5%)" />
              <XAxis dataKey="date" tick={{ fontSize: 10, fill: "oklch(0.58 0.012 264)" }} tickLine={false} axisLine={false} interval={3} />
              <YAxis tick={{ fontSize: 10, fill: "oklch(0.58 0.012 264)" }} tickLine={false} axisLine={false} />
              <Tooltip contentStyle={{ background: "oklch(0.158 0.009 264)", border: "1px solid oklch(1 0 0 / 8%)", borderRadius: "8px", fontSize: "12px" }} />
              <Area type="monotone" dataKey="leads" stroke="oklch(0.68 0.18 305)" strokeWidth={2} fill="url(#wLeadG)" name="Leads" />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* Weekly Comparison Bar Chart */}
      <div className="rounded-xl border border-border bg-card p-5">
        <h2 className="text-sm font-semibold mb-4">Weekly Revenue vs Spend Comparison</h2>
        <ResponsiveContainer width="100%" height={220}>
          <BarChart data={weeklyData}>
            <CartesianGrid strokeDasharray="3 3" stroke="oklch(1 0 0 / 5%)" />
            <XAxis dataKey="week" tick={{ fontSize: 11, fill: "oklch(0.82 0.006 264)" }} tickLine={false} axisLine={false} />
            <YAxis tick={{ fontSize: 10, fill: "oklch(0.58 0.012 264)" }} tickLine={false} axisLine={false} tickFormatter={v => `$${v >= 1000 ? (v/1000).toFixed(0)+'K' : v}`} />
            <Tooltip contentStyle={{ background: "oklch(0.158 0.009 264)", border: "1px solid oklch(1 0 0 / 8%)", borderRadius: "8px", fontSize: "12px" }} />
            <Legend wrapperStyle={{ fontSize: "11px" }} />
            <Bar dataKey="revenue" name="Revenue" fill="oklch(0.72 0.16 162)" radius={[4, 4, 0, 0]} />
            <Bar dataKey="spend" name="Spend" fill="oklch(0.62 0.19 258)" radius={[4, 4, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </div>

      {/* Weekly Reports Table */}
      <div className="rounded-xl border border-border bg-card overflow-hidden">
        <div className="p-5 border-b border-border">
          <h2 className="text-sm font-semibold text-foreground">Weekly Report History</h2>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border bg-muted/20">
                <th className="text-left px-5 py-3 text-xs font-semibold text-muted-foreground">Week</th>
                <th className="text-left px-5 py-3 text-xs font-semibold text-muted-foreground">Revenue</th>
                <th className="text-left px-5 py-3 text-xs font-semibold text-muted-foreground">Spend</th>
                <th className="text-left px-5 py-3 text-xs font-semibold text-muted-foreground">ROAS</th>
                <th className="text-left px-5 py-3 text-xs font-semibold text-muted-foreground">Leads</th>
                <th className="text-left px-5 py-3 text-xs font-semibold text-muted-foreground">Conversions</th>
                <th className="text-left px-5 py-3 text-xs font-semibold text-muted-foreground">Conv. Rate</th>
                <th className="text-left px-5 py-3 text-xs font-semibold text-muted-foreground">Performance</th>
              </tr>
            </thead>
            <tbody>
              {(reports || []).map((r: any, i: number) => {
                const roas = Number(r.avgRoas || 0);
                const cr = r.totalLeads > 0 ? (Number(r.totalConversions) / Number(r.totalLeads)) * 100 : 0;
                const perf = roas >= 3 && cr >= 10 ? "green" : roas >= 1.5 || cr >= 5 ? "yellow" : "red";
                const weekLabel = `${new Date(r.weekStart).toLocaleDateString("en", { month: "short", day: "numeric" })} – ${new Date(r.weekEnd).toLocaleDateString("en", { month: "short", day: "numeric" })}`;
                return (
                  <tr key={r.id} className="border-b border-border/50 hover:bg-muted/20 transition-colors">
                    <td className="px-5 py-3 text-xs font-medium text-foreground">{weekLabel}</td>
                    <td className="px-5 py-3 text-xs font-mono text-[oklch(0.72_0.16_162)]">${Number(r.totalRevenue).toLocaleString()}</td>
                    <td className="px-5 py-3 text-xs font-mono">${Number(r.totalSpend).toLocaleString()}</td>
                    <td className="px-5 py-3">
                      <StatusBadge status={roas >= 3 ? "green" : roas >= 1.5 ? "yellow" : "red"} label={`${roas.toFixed(1)}x`} />
                    </td>
                    <td className="px-5 py-3 text-xs font-mono">{Number(r.totalLeads).toLocaleString()}</td>
                    <td className="px-5 py-3 text-xs font-mono">{Number(r.totalConversions).toLocaleString()}</td>
                    <td className="px-5 py-3">
                      <StatusBadge status={cr >= 15 ? "green" : cr >= 8 ? "yellow" : "red"} label={`${cr.toFixed(1)}%`} />
                    </td>
                    <td className="px-5 py-3">
                      <StatusBadge status={perf} label={perf === "green" ? "Strong" : perf === "yellow" ? "Moderate" : "Weak"} />
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
