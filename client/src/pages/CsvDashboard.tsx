import { useMemo, useState } from "react";
import { trpc } from "@/lib/trpc";
import {
  ResponsiveContainer,
  ComposedChart,
  Line,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
} from "recharts";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  DollarSign,
  Eye,
  MousePointerClick,
  Users,
  TrendingUp,
  BarChart2,
  Target,
  Zap,
} from "lucide-react";
import { useDateRange, PRESET_LABELS } from "@/contexts/DateRangeContext";

// ─── helpers ─────────────────────────────────────────────────────────────────

function fmt(n: number, style: "currency" | "decimal" | "percent" = "decimal", digits = 2) {
  if (style === "currency")
    return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: digits }).format(n);
  if (style === "percent")
    return `${(n * 100).toFixed(2)}%`;
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return n.toFixed(digits);
}

function fmtDay(d: string) {
  const dt = new Date(`${d}T00:00:00Z`);
  return dt.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
}

function toISO(d: Date) {
  return d.toISOString().slice(0, 10);
}

// ─── KPI card ────────────────────────────────────────────────────────────────

interface KpiProps {
  label: string;
  value: string;
  sub?: string;
  icon: React.ReactNode;
  color: string;
}

function KpiCard({ label, value, sub, icon, color }: KpiProps) {
  return (
    <Card className="bg-[#0f1729] border-white/10">
      <CardContent className="p-5 flex items-start gap-4">
        <div className={`rounded-xl p-3 ${color}`}>{icon}</div>
        <div className="min-w-0">
          <p className="text-xs text-white/50 uppercase tracking-wider mb-1">{label}</p>
          <p className="text-2xl font-bold text-white leading-none">{value}</p>
          {sub && <p className="text-xs text-white/40 mt-1">{sub}</p>}
        </div>
      </CardContent>
    </Card>
  );
}

// ─── metric selector options ──────────────────────────────────────────────────

const METRICS = [
  { value: "spend",       label: "Ad Spend",    color: "#6366f1" },
  { value: "impressions", label: "Impressions",  color: "#22d3ee" },
  { value: "clicks",      label: "Clicks",       color: "#f59e0b" },
  { value: "leads",       label: "Leads",        color: "#10b981" },
  { value: "cpl",         label: "CPL",          color: "#f43f5e" },
  { value: "avgCtr",      label: "CTR",          color: "#a78bfa" },
  { value: "avgCpm",      label: "CPM",          color: "#fb923c" },
] as const;

type MetricKey = (typeof METRICS)[number]["value"];

// ─── main component ───────────────────────────────────────────────────────────

export default function CsvDashboard() {
  const { dateRange } = useDateRange();

  // Derive ISO strings from the global date range — stable via useMemo
  const range = useMemo(() => ({
    from: toISO(dateRange.from),
    to:   toISO(dateRange.to),
  }), [dateRange.from, dateRange.to]);

  const [primaryMetric,   setPrimaryMetric]   = useState<MetricKey>("spend");
  const [secondaryMetric, setSecondaryMetric] = useState<MetricKey>("leads");

  const { data: summary,   isLoading: loadingSummary   } = trpc.csvDashboard.summary.useQuery(range);
  const { data: trend,     isLoading: loadingTrend     } = trpc.csvDashboard.dailyTrend.useQuery(range);
  const { data: campaigns, isLoading: loadingCampaigns } = trpc.csvDashboard.campaignBreakdown.useQuery(range);

  const primaryColor   = METRICS.find(m => m.value === primaryMetric)?.color   ?? "#6366f1";
  const secondaryColor = METRICS.find(m => m.value === secondaryMetric)?.color ?? "#10b981";

  const rangeLabel = PRESET_LABELS[dateRange.preset] ?? "Custom range";

  return (
    <div className="p-6 space-y-6 min-h-screen bg-[#080f1e] text-white">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-white">CSV Metrics Dashboard</h1>
          <p className="text-sm text-white/50 mt-0.5">
            Showing imported Meta Ads data &mdash;{" "}
            <span className="text-indigo-400 font-medium">{rangeLabel}</span>
            {" "}({range.from} &rarr; {range.to})
          </p>
        </div>
        <p className="text-xs text-white/30 italic">
          Use the date picker in the top bar to change the range
        </p>
      </div>

      {/* KPI cards */}
      {loadingSummary ? (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {Array.from({ length: 8 }).map((_, i) => (
            <Card key={i} className="bg-[#0f1729] border-white/10 animate-pulse h-24" />
          ))}
        </div>
      ) : summary ? (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <KpiCard label="Total Spend"   value={fmt(summary.totalSpend, "currency")}   icon={<DollarSign className="w-5 h-5 text-indigo-300" />}       color="bg-indigo-500/20" />
          <KpiCard label="Impressions"   value={fmt(summary.totalImpressions)}          icon={<Eye className="w-5 h-5 text-cyan-300" />}               color="bg-cyan-500/20" />
          <KpiCard label="Clicks"        value={fmt(summary.totalClicks)}               icon={<MousePointerClick className="w-5 h-5 text-amber-300" />} color="bg-amber-500/20" />
          <KpiCard label="Total Leads"   value={fmt(summary.totalLeads)}                icon={<Users className="w-5 h-5 text-emerald-300" />}           color="bg-emerald-500/20" />
          <KpiCard label="Avg CPL"       value={fmt(summary.avgCpl, "currency")}        icon={<Target className="w-5 h-5 text-rose-300" />}             color="bg-rose-500/20" />
          <KpiCard label="Avg CTR"       value={fmt(summary.avgCtr, "percent")}         icon={<TrendingUp className="w-5 h-5 text-violet-300" />}       color="bg-violet-500/20" />
          <KpiCard label="Avg CPM"       value={fmt(summary.avgCpm, "currency")}        icon={<BarChart2 className="w-5 h-5 text-orange-300" />}        color="bg-orange-500/20" />
          <KpiCard label="Avg CPC"       value={fmt(summary.avgCpc, "currency")}        icon={<Zap className="w-5 h-5 text-pink-300" />}               color="bg-pink-500/20"
            sub={`${summary.rowCount.toLocaleString()} rows imported`}
          />
        </div>
      ) : (
        <div className="text-white/40 text-sm">No data available for this date range. Upload a CSV first.</div>
      )}

      {/* Trend chart */}
      <Card className="bg-[#0f1729] border-white/10">
        <CardHeader className="flex flex-row items-center justify-between pb-2">
          <CardTitle className="text-white text-base font-semibold">Daily Trend</CardTitle>
          <div className="flex gap-2">
            <Select value={primaryMetric} onValueChange={v => setPrimaryMetric(v as MetricKey)}>
              <SelectTrigger className="w-36 h-8 text-xs bg-white/5 border-white/10 text-white">
                <SelectValue />
              </SelectTrigger>
              <SelectContent className="bg-[#0f1729] border-white/10 text-white">
                {METRICS.map(m => (
                  <SelectItem key={m.value} value={m.value} className="text-xs">{m.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={secondaryMetric} onValueChange={v => setSecondaryMetric(v as MetricKey)}>
              <SelectTrigger className="w-36 h-8 text-xs bg-white/5 border-white/10 text-white">
                <SelectValue />
              </SelectTrigger>
              <SelectContent className="bg-[#0f1729] border-white/10 text-white">
                {METRICS.map(m => (
                  <SelectItem key={m.value} value={m.value} className="text-xs">{m.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </CardHeader>
        <CardContent className="pt-0">
          {loadingTrend ? (
            <div className="h-64 animate-pulse bg-white/5 rounded-lg" />
          ) : trend && trend.length > 0 ? (
            <ResponsiveContainer width="100%" height={280}>
              <ComposedChart data={trend} margin={{ top: 8, right: 16, left: 0, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.06)" />
                <XAxis
                  dataKey="day"
                  tickFormatter={fmtDay}
                  tick={{ fill: "rgba(255,255,255,0.4)", fontSize: 11 }}
                  axisLine={false}
                  tickLine={false}
                />
                <YAxis
                  yAxisId="left"
                  tick={{ fill: "rgba(255,255,255,0.4)", fontSize: 11 }}
                  axisLine={false}
                  tickLine={false}
                  tickFormatter={v => fmt(v)}
                />
                <YAxis
                  yAxisId="right"
                  orientation="right"
                  tick={{ fill: "rgba(255,255,255,0.4)", fontSize: 11 }}
                  axisLine={false}
                  tickLine={false}
                  tickFormatter={v => fmt(v)}
                />
                <Tooltip
                  contentStyle={{ background: "#0f1729", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 8, color: "#fff" }}
                  labelFormatter={fmtDay}
                  formatter={(v: number, name: string) => [
                    fmt(v, ["spend","cpl","avgCpm","avgCpc"].includes(name) ? "currency" : "decimal"),
                    name,
                  ]}
                />
                <Legend wrapperStyle={{ color: "rgba(255,255,255,0.5)", fontSize: 12 }} />
                <Bar
                  yAxisId="left"
                  dataKey={primaryMetric}
                  name={METRICS.find(m => m.value === primaryMetric)?.label}
                  fill={primaryColor}
                  opacity={0.8}
                  radius={[3, 3, 0, 0]}
                />
                <Line
                  yAxisId="right"
                  type="monotone"
                  dataKey={secondaryMetric}
                  name={METRICS.find(m => m.value === secondaryMetric)?.label}
                  stroke={secondaryColor}
                  strokeWidth={2}
                  dot={false}
                />
              </ComposedChart>
            </ResponsiveContainer>
          ) : (
            <div className="h-64 flex items-center justify-center text-white/30 text-sm">
              No trend data for this period
            </div>
          )}
        </CardContent>
      </Card>

      {/* Campaign breakdown table */}
      <Card className="bg-[#0f1729] border-white/10">
        <CardHeader className="pb-2">
          <CardTitle className="text-white text-base font-semibold">Campaign Breakdown</CardTitle>
        </CardHeader>
        <CardContent className="pt-0 overflow-x-auto">
          {loadingCampaigns ? (
            <div className="h-32 animate-pulse bg-white/5 rounded-lg" />
          ) : campaigns && campaigns.length > 0 ? (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-white/10 text-white/40 text-xs uppercase tracking-wider">
                  <th className="text-left py-3 pr-4 font-medium">Campaign</th>
                  <th className="text-right py-3 px-3 font-medium">Spend</th>
                  <th className="text-right py-3 px-3 font-medium">Impressions</th>
                  <th className="text-right py-3 px-3 font-medium">Clicks</th>
                  <th className="text-right py-3 px-3 font-medium">Leads</th>
                  <th className="text-right py-3 px-3 font-medium">CPL</th>
                  <th className="text-right py-3 px-3 font-medium">CTR</th>
                  <th className="text-right py-3 pl-3 font-medium">CPM</th>
                </tr>
              </thead>
              <tbody>
                {campaigns.map((c, i) => (
                  <tr
                    key={c.campaignId}
                    className={`border-b border-white/5 hover:bg-white/5 transition-colors ${i % 2 === 0 ? "" : "bg-white/[0.02]"}`}
                  >
                    <td className="py-3 pr-4 text-white font-medium max-w-[220px] truncate" title={c.campaignName}>
                      {c.campaignName}
                    </td>
                    <td className="text-right py-3 px-3 text-emerald-400 font-semibold">{fmt(c.spend, "currency")}</td>
                    <td className="text-right py-3 px-3 text-white/70">{fmt(c.impressions)}</td>
                    <td className="text-right py-3 px-3 text-white/70">{fmt(c.clicks)}</td>
                    <td className="text-right py-3 px-3 text-white/70">{c.leads.toLocaleString()}</td>
                    <td className="text-right py-3 px-3">
                      <Badge
                        variant="outline"
                        className={`text-xs border-0 ${
                          c.cpl > 0 && c.cpl < 10
                            ? "bg-emerald-500/20 text-emerald-300"
                            : c.cpl < 20
                            ? "bg-amber-500/20 text-amber-300"
                            : "bg-rose-500/20 text-rose-300"
                        }`}
                      >
                        {c.cpl > 0 ? fmt(c.cpl, "currency") : "—"}
                      </Badge>
                    </td>
                    <td className="text-right py-3 px-3 text-white/70">{fmt(c.avgCtr, "percent")}</td>
                    <td className="text-right py-3 pl-3 text-white/70">{fmt(c.avgCpm, "currency")}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <div className="py-12 text-center text-white/30 text-sm">
              No campaign data for this period
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
