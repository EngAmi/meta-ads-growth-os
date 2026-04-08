import { trpc } from "@/lib/trpc";
import { MetricCard } from "@/components/ui/MetricCard";
import { PageHeader } from "@/components/ui/PageHeader";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { Target, DollarSign, Clock, Users, Zap, TrendingUp } from "lucide-react";
import {
  RadarChart, Radar, PolarGrid, PolarAngleAxis, ResponsiveContainer,
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Cell, Legend
} from "recharts";

function fmt(n: any, prefix = "", decimals = 0) {
  const v = Number(n || 0);
  if (v >= 1000000) return `${prefix}${(v / 1000000).toFixed(1)}M`;
  if (v >= 1000) return `${prefix}${(v / 1000).toFixed(1)}K`;
  return `${prefix}${v.toFixed(decimals)}`;
}

const AGENT_COLORS = [
  "oklch(0.62 0.19 258)",
  "oklch(0.72 0.16 162)",
  "oklch(0.82 0.17 85)",
  "oklch(0.65 0.22 25)",
  "oklch(0.68 0.18 305)",
  "oklch(0.75 0.15 200)",
];

export default function SalesPerformance() {
  const { data: agents, isLoading } = trpc.sales.agents.useQuery();
  const { data: teamStats } = trpc.sales.teamStats.useQuery();
  const { data: activityStats } = trpc.sales.activityStats.useQuery();

  const avgConv = Number(teamStats?.avgConversionRate || 0);
  const avgResponse = Number(teamStats?.avgResponseTime || 0);
  const totalRevenue = Number(teamStats?.totalRevenue || 0);
  const totalLeads = Number(teamStats?.totalLeads || 0);

  const convData = (agents || []).map((a: any) => ({
    name: a.name.split(" ")[0],
    convRate: Number(a.conversionRate),
    revenue: Number(a.totalRevenue),
    leads: Number(a.totalLeads),
    responseTime: Number(a.avgResponseTime),
    followUp: Number(a.followUpRate),
  }));

  const radarData = (agents || []).slice(0, 4).map((a: any) => ({
    agent: a.name.split(" ")[0],
    Conversion: Math.min(100, Number(a.conversionRate) * 4),
    "Response Speed": Math.max(0, 100 - (Number(a.avgResponseTime) / 6)),
    "Follow-Up": Number(a.followUpRate),
    Revenue: Math.min(100, (Number(a.totalRevenue) / 1000)),
    Leads: Math.min(100, Number(a.totalLeads) / 3),
  }));

  const actData = (activityStats || []).map((a: any) => ({
    name: a.agentName?.split(" ")[0] || `Agent ${a.agentId}`,
    Calls: Number(a.calls),
    Messages: Number(a.messages),
    "Follow-Ups": Number(a.followUps),
    Closes: Number(a.closes),
  }));

  return (
    <div className="p-6 space-y-6 max-w-[1600px] mx-auto">
      <PageHeader
        title="Sales Performance"
        description="Agent-level metrics, conversion rates, and activity tracking"
        icon={Target}
      />

      {/* Team KPIs */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <MetricCard
          title="Team Avg Conversion"
          value={`${avgConv.toFixed(1)}%`}
          subtitle={`${Number(teamStats?.totalConversions || 0)} total conversions`}
          icon={Target}
          status={avgConv >= 15 ? "green" : avgConv >= 8 ? "yellow" : "red"}
        />
        <MetricCard
          title="Total Revenue"
          value={fmt(totalRevenue, "$")}
          subtitle={`${Number(teamStats?.totalAgents || 0)} active agents`}
          icon={DollarSign}
          status="green"
        />
        <MetricCard
          title="Avg Response Time"
          value={`${(avgResponse / 60).toFixed(1)} min`}
          subtitle="First contact"
          icon={Clock}
          status={avgResponse < 120 ? "green" : avgResponse < 300 ? "yellow" : "red"}
        />
        <MetricCard
          title="Avg Follow-Up Rate"
          value={`${Number(teamStats?.avgFollowUpRate || 0).toFixed(1)}%`}
          subtitle="Benchmark: 90%"
          icon={Zap}
          status={Number(teamStats?.avgFollowUpRate || 0) >= 85 ? "green" : Number(teamStats?.avgFollowUpRate || 0) >= 70 ? "yellow" : "red"}
        />
      </div>

      {/* Charts */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Conversion Rate Comparison */}
        <div className="rounded-xl border border-border bg-card p-5">
          <h2 className="text-sm font-semibold mb-4">Conversion Rate by Agent</h2>
          <ResponsiveContainer width="100%" height={220}>
            <BarChart data={convData} margin={{ top: 4, right: 4, bottom: 0, left: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="oklch(1 0 0 / 5%)" />
              <XAxis dataKey="name" tick={{ fontSize: 11, fill: "oklch(0.82 0.006 264)" }} tickLine={false} axisLine={false} />
              <YAxis tick={{ fontSize: 10, fill: "oklch(0.58 0.012 264)" }} tickLine={false} axisLine={false} tickFormatter={v => `${v}%`} />
              <Tooltip
                contentStyle={{ background: "oklch(0.158 0.009 264)", border: "1px solid oklch(1 0 0 / 8%)", borderRadius: "8px", fontSize: "12px" }}
                formatter={(v: any) => [`${Number(v).toFixed(1)}%`, "Conversion Rate"]}
              />
              <Bar dataKey="convRate" name="Conversion Rate" radius={[6, 6, 0, 0]}>
                {convData.map((d, i) => (
                  <Cell key={i} fill={d.convRate >= 15 ? "oklch(0.72 0.16 162)" : d.convRate >= 8 ? "oklch(0.82 0.17 85)" : "oklch(0.65 0.22 25)"} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>

        {/* Activity Breakdown */}
        <div className="rounded-xl border border-border bg-card p-5">
          <h2 className="text-sm font-semibold mb-4">Activity Breakdown by Agent</h2>
          <ResponsiveContainer width="100%" height={220}>
            <BarChart data={actData} margin={{ top: 4, right: 4, bottom: 0, left: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="oklch(1 0 0 / 5%)" />
              <XAxis dataKey="name" tick={{ fontSize: 11, fill: "oklch(0.82 0.006 264)" }} tickLine={false} axisLine={false} />
              <YAxis tick={{ fontSize: 10, fill: "oklch(0.58 0.012 264)" }} tickLine={false} axisLine={false} />
              <Tooltip contentStyle={{ background: "oklch(0.158 0.009 264)", border: "1px solid oklch(1 0 0 / 8%)", borderRadius: "8px", fontSize: "12px" }} />
              <Legend wrapperStyle={{ fontSize: "11px" }} />
              <Bar dataKey="Calls" stackId="a" fill="oklch(0.62 0.19 258)" radius={[0, 0, 0, 0]} />
              <Bar dataKey="Messages" stackId="a" fill="oklch(0.68 0.18 305)" />
              <Bar dataKey="Follow-Ups" stackId="a" fill="oklch(0.82 0.17 85)" />
              <Bar dataKey="Closes" stackId="a" fill="oklch(0.72 0.16 162)" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* Agent Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
        {(agents || []).map((a: any, i: number) => {
          const cr = Number(a.conversionRate);
          const rt = Number(a.avgResponseTime);
          const fr = Number(a.followUpRate);
          const crStatus = cr >= 15 ? "green" : cr >= 8 ? "yellow" : "red";
          const rtStatus = rt < 120 ? "green" : rt < 300 ? "yellow" : "red";
          const frStatus = fr >= 85 ? "green" : fr >= 70 ? "yellow" : "red";

          return (
            <div key={a.id} className="rounded-xl border border-border bg-card p-5 metric-card-glow">
              <div className="flex items-start justify-between mb-4">
                <div className="flex items-center gap-3">
                  <div
                    className="h-10 w-10 rounded-xl flex items-center justify-center text-sm font-bold text-white shrink-0"
                    style={{ background: AGENT_COLORS[i % AGENT_COLORS.length] }}
                  >
                    {a.name.charAt(0)}
                  </div>
                  <div>
                    <p className="font-semibold text-sm text-foreground">{a.name}</p>
                    <p className="text-xs text-muted-foreground">{a.team}</p>
                  </div>
                </div>
                <StatusBadge status={crStatus} label={`${cr.toFixed(1)}%`} />
              </div>

              <div className="grid grid-cols-2 gap-3 mb-4">
                <div className="bg-muted/30 rounded-lg p-3">
                  <p className="text-xs text-muted-foreground">Revenue</p>
                  <p className="text-base font-bold text-[oklch(0.72_0.16_162)]">{fmt(a.totalRevenue, "$")}</p>
                </div>
                <div className="bg-muted/30 rounded-lg p-3">
                  <p className="text-xs text-muted-foreground">Leads</p>
                  <p className="text-base font-bold text-foreground">{a.totalLeads}</p>
                </div>
              </div>

              <div className="space-y-2.5">
                <div className="flex items-center justify-between">
                  <span className="text-xs text-muted-foreground flex items-center gap-1.5">
                    <Clock className="h-3 w-3" /> Response
                  </span>
                  <StatusBadge status={rtStatus} label={`${(rt / 60).toFixed(1)}m`} size="sm" />
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-xs text-muted-foreground flex items-center gap-1.5">
                    <Zap className="h-3 w-3" /> Follow-Up Rate
                  </span>
                  <StatusBadge status={frStatus} label={`${fr.toFixed(0)}%`} size="sm" />
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-xs text-muted-foreground flex items-center gap-1.5">
                    <TrendingUp className="h-3 w-3" /> Conversions
                  </span>
                  <span className="text-xs font-mono text-foreground">{a.totalConversions} / {a.totalLeads}</span>
                </div>
              </div>

              {/* Conversion bar */}
              <div className="mt-4">
                <div className="flex justify-between text-xs text-muted-foreground mb-1">
                  <span>Conversion Rate</span>
                  <span>{cr.toFixed(1)}%</span>
                </div>
                <div className="h-1.5 rounded-full bg-muted overflow-hidden">
                  <div
                    className="h-full rounded-full transition-all"
                    style={{
                      width: `${Math.min(100, cr * 4)}%`,
                      background: crStatus === "green" ? "oklch(0.72 0.16 162)" : crStatus === "yellow" ? "oklch(0.82 0.17 85)" : "oklch(0.65 0.22 25)"
                    }}
                  />
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
