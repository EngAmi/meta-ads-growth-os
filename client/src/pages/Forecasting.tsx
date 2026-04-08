import { trpc } from "@/lib/trpc";
import { PageHeader } from "@/components/ui/PageHeader";
import { MetricCard } from "@/components/ui/MetricCard";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { TrendingUp, DollarSign, Users, Target, Info } from "lucide-react";
import {
  ComposedChart, Area, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  ReferenceLine, Legend, AreaChart
} from "recharts";

function fmt(n: any, prefix = "", decimals = 0) {
  const v = Number(n || 0);
  if (v >= 1000000) return `${prefix}${(v / 1000000).toFixed(1)}M`;
  if (v >= 1000) return `${prefix}${(v / 1000).toFixed(1)}K`;
  return `${prefix}${v.toFixed(decimals)}`;
}

export default function Forecasting() {
  const { data: forecastData, isLoading } = trpc.forecast.revenue.useQuery();

  if (isLoading) {
    return (
      <div className="p-6 space-y-4">
        <div className="h-8 w-48 bg-muted animate-pulse rounded-lg" />
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          {[...Array(4)].map((_, i) => <div key={i} className="h-28 bg-muted animate-pulse rounded-xl" />)}
        </div>
        <div className="h-80 bg-muted animate-pulse rounded-xl" />
      </div>
    );
  }

  const historical = forecastData?.historicalData || [];
  const forecast = forecastData?.forecast || [];
  const monthly = forecastData?.monthlyForecast;

  // Build combined chart data: historical + forecast
  const historicalChart = historical.map((d: any) => ({
    label: new Date(d.date).toLocaleDateString("en", { month: "short", day: "numeric" }),
    actual: Number(d.revenue).toFixed(0),
    spend: Number(d.spend).toFixed(0),
    leads: d.leads,
    type: "historical",
  }));

  const forecastChart = forecast.map((d: any) => {
    const futureDate = new Date();
    futureDate.setDate(futureDate.getDate() + d.day);
    return {
      label: futureDate.toLocaleDateString("en", { month: "short", day: "numeric" }),
      projected: Number(d.projected).toFixed(0),
      low: Number(d.low).toFixed(0),
      high: Number(d.high).toFixed(0),
      confidence: Number(d.confidence).toFixed(0),
      type: "forecast",
    };
  });

  const combinedChart = [...historicalChart, ...forecastChart];

  const avgRevenue = Number(forecastData?.avgRevenue || 0);
  const avgSpend = Number(forecastData?.avgSpend || 0);
  const roas = avgSpend > 0 ? avgRevenue / avgSpend : 0;
  const monthlyRevenue = Number(monthly?.revenue || 0);
  const monthlyLeads = Number(monthly?.leads || 0);

  // Confidence color
  const confColor = (c: number) => c >= 85 ? "oklch(0.72 0.16 162)" : c >= 70 ? "oklch(0.82 0.17 85)" : "oklch(0.65 0.22 25)";

  return (
    <div className="p-6 space-y-6 max-w-[1600px] mx-auto">
      <PageHeader
        title="Revenue Forecasting"
        description="14-day projected metrics with confidence intervals based on historical trends"
        icon={TrendingUp}
      >
        <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-muted/50 border border-border">
          <Info className="h-3.5 w-3.5 text-muted-foreground" />
          <span className="text-xs text-muted-foreground">Linear trend model · 14-day horizon</span>
        </div>
      </PageHeader>

      {/* Monthly Projections */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <MetricCard
          title="Projected Monthly Revenue"
          value={fmt(monthlyRevenue, "$")}
          subtitle="Based on 30-day avg"
          icon={DollarSign}
          status={roas >= 3 ? "green" : roas >= 1.5 ? "yellow" : "red"}
        />
        <MetricCard
          title="Projected Monthly Spend"
          value={fmt(monthly?.spend, "$")}
          subtitle="At current burn rate"
          icon={TrendingUp}
          status="blue"
        />
        <MetricCard
          title="Projected Monthly Leads"
          value={fmt(monthlyLeads)}
          subtitle="Based on daily avg"
          icon={Users}
          status="blue"
        />
        <MetricCard
          title="Projected ROAS"
          value={`${roas.toFixed(2)}x`}
          subtitle="Revenue / Spend ratio"
          icon={Target}
          status={roas >= 3 ? "green" : roas >= 1.5 ? "yellow" : "red"}
        />
      </div>

      {/* Main Forecast Chart */}
      <div className="rounded-xl border border-border bg-card p-5">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-sm font-semibold text-foreground">Revenue Forecast (Historical + 14-Day Projection)</h2>
          <div className="flex items-center gap-4 text-xs text-muted-foreground">
            <div className="flex items-center gap-1.5">
              <div className="h-2 w-4 rounded-full bg-[oklch(0.72_0.16_162)]" />
              <span>Actual</span>
            </div>
            <div className="flex items-center gap-1.5">
              <div className="h-2 w-4 rounded-full bg-[oklch(0.62_0.19_258)]" />
              <span>Projected</span>
            </div>
            <div className="flex items-center gap-1.5">
              <div className="h-2 w-4 rounded-full bg-[oklch(0.62_0.19_258/0.2)]" />
              <span>Confidence Band</span>
            </div>
          </div>
        </div>
        <ResponsiveContainer width="100%" height={280}>
          <ComposedChart data={combinedChart} margin={{ top: 4, right: 4, bottom: 0, left: 0 }}>
            <defs>
              <linearGradient id="fcActG" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="oklch(0.72 0.16 162)" stopOpacity={0.25} />
                <stop offset="95%" stopColor="oklch(0.72 0.16 162)" stopOpacity={0} />
              </linearGradient>
              <linearGradient id="fcBandG" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="oklch(0.62 0.19 258)" stopOpacity={0.15} />
                <stop offset="95%" stopColor="oklch(0.62 0.19 258)" stopOpacity={0.05} />
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="3 3" stroke="oklch(1 0 0 / 5%)" />
            <XAxis dataKey="label" tick={{ fontSize: 10, fill: "oklch(0.58 0.012 264)" }} tickLine={false} axisLine={false} interval={3} />
            <YAxis tick={{ fontSize: 10, fill: "oklch(0.58 0.012 264)" }} tickLine={false} axisLine={false} tickFormatter={v => `$${v}`} />
            <Tooltip
              contentStyle={{ background: "oklch(0.158 0.009 264)", border: "1px solid oklch(1 0 0 / 8%)", borderRadius: "8px", fontSize: "12px" }}
              formatter={(value: any, name: string) => [`$${Number(value).toLocaleString()}`, name]}
            />
            {/* Confidence band */}
            <Area type="monotone" dataKey="high" stroke="none" fill="url(#fcBandG)" name="High Estimate" />
            <Area type="monotone" dataKey="low" stroke="none" fill="oklch(0.158 0.009 264)" name="Low Estimate" />
            {/* Actual revenue */}
            <Area type="monotone" dataKey="actual" stroke="oklch(0.72 0.16 162)" strokeWidth={2} fill="url(#fcActG)" name="Actual Revenue ($)" dot={false} />
            {/* Projected */}
            <Line type="monotone" dataKey="projected" stroke="oklch(0.62 0.19 258)" strokeWidth={2} strokeDasharray="6 3" name="Projected Revenue ($)" dot={false} />
            {/* Today line */}
            <ReferenceLine x={historicalChart[historicalChart.length - 1]?.label} stroke="oklch(0.82 0.17 85)" strokeDasharray="4 4" label={{ value: "Today", position: "top", fontSize: 10, fill: "oklch(0.82 0.17 85)" }} />
          </ComposedChart>
        </ResponsiveContainer>
      </div>

      {/* Forecast Table */}
      <div className="rounded-xl border border-border bg-card overflow-hidden">
        <div className="p-5 border-b border-border">
          <h2 className="text-sm font-semibold text-foreground">14-Day Forecast Breakdown</h2>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border bg-muted/20">
                <th className="text-left px-5 py-3 text-xs font-semibold text-muted-foreground">Day</th>
                <th className="text-left px-5 py-3 text-xs font-semibold text-muted-foreground">Date</th>
                <th className="text-left px-5 py-3 text-xs font-semibold text-muted-foreground">Projected Revenue</th>
                <th className="text-left px-5 py-3 text-xs font-semibold text-muted-foreground">Low Estimate</th>
                <th className="text-left px-5 py-3 text-xs font-semibold text-muted-foreground">High Estimate</th>
                <th className="text-left px-5 py-3 text-xs font-semibold text-muted-foreground">Confidence</th>
              </tr>
            </thead>
            <tbody>
              {forecast.map((d: any) => {
                const futureDate = new Date();
                futureDate.setDate(futureDate.getDate() + d.day);
                const conf = Number(d.confidence);
                return (
                  <tr key={d.day} className="border-b border-border/50 hover:bg-muted/20 transition-colors">
                    <td className="px-5 py-3 text-xs font-mono text-muted-foreground">+{d.day}d</td>
                    <td className="px-5 py-3 text-xs font-medium text-foreground">
                      {futureDate.toLocaleDateString("en", { weekday: "short", month: "short", day: "numeric" })}
                    </td>
                    <td className="px-5 py-3 text-xs font-mono font-semibold text-[oklch(0.72_0.16_162)]">
                      ${Number(d.projected).toLocaleString(undefined, { maximumFractionDigits: 0 })}
                    </td>
                    <td className="px-5 py-3 text-xs font-mono text-muted-foreground">
                      ${Number(d.low).toLocaleString(undefined, { maximumFractionDigits: 0 })}
                    </td>
                    <td className="px-5 py-3 text-xs font-mono text-muted-foreground">
                      ${Number(d.high).toLocaleString(undefined, { maximumFractionDigits: 0 })}
                    </td>
                    <td className="px-5 py-3">
                      <div className="flex items-center gap-2">
                        <div className="w-16 h-1.5 bg-muted rounded-full overflow-hidden">
                          <div
                            className="h-full rounded-full"
                            style={{ width: `${conf}%`, background: confColor(conf) }}
                          />
                        </div>
                        <span className="text-xs font-mono" style={{ color: confColor(conf) }}>
                          {conf.toFixed(0)}%
                        </span>
                      </div>
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
