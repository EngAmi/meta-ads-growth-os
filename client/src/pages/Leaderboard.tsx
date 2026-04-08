import { trpc } from "@/lib/trpc";
import { PageHeader } from "@/components/ui/PageHeader";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { Trophy, Medal, Star, TrendingUp, DollarSign, Target, Zap, Crown } from "lucide-react";
import { useState } from "react";

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
  "oklch(0.58 0.16 25)",
  "oklch(0.70 0.14 200)",
];

type AgentSortKey = "totalRevenue" | "conversionRate" | "totalLeads" | "avgResponseTime" | "followUpRate";
type CampaignSortKey = "revenue" | "roas" | "leads" | "conversions" | "spend";

const rankIcon = (i: number) => {
  if (i === 0) return <Crown className="h-4 w-4 text-[oklch(0.82_0.17_85)]" />;
  if (i === 1) return <Medal className="h-4 w-4 text-[oklch(0.75_0.05_264)]" />;
  if (i === 2) return <Star className="h-4 w-4 text-[oklch(0.65_0.14_50)]" />;
  return <span className="text-xs font-bold text-muted-foreground w-4 text-center">{i + 1}</span>;
};

export default function Leaderboard() {
  const { data: agents } = trpc.leaderboard.agents.useQuery();
  const { data: campaigns } = trpc.leaderboard.campaigns.useQuery();
  const [tab, setTab] = useState<"agents" | "campaigns">("agents");
  const [agentSort, setAgentSort] = useState<AgentSortKey>("totalRevenue");
  const [agentDir, setAgentDir] = useState<"asc" | "desc">("desc");
  const [campSort, setCampSort] = useState<CampaignSortKey>("revenue");
  const [campDir, setCampDir] = useState<"asc" | "desc">("desc");

  const handleAgentSort = (k: AgentSortKey) => {
    if (agentSort === k) setAgentDir(d => d === "asc" ? "desc" : "asc");
    else { setAgentSort(k); setAgentDir(k === "avgResponseTime" ? "asc" : "desc"); }
  };

  const handleCampSort = (k: CampaignSortKey) => {
    if (campSort === k) setCampDir(d => d === "asc" ? "desc" : "asc");
    else { setCampSort(k); setCampDir("desc"); }
  };

  const sortedAgents = [...(agents || [])].sort((a: any, b: any) => {
    const av = Number(a[agentSort] || 0), bv = Number(b[agentSort] || 0);
    return agentDir === "desc" ? bv - av : av - bv;
  });

  const sortedCampaigns = [...(campaigns || [])].sort((a: any, b: any) => {
    const av = Number(a[campSort] || 0), bv = Number(b[campSort] || 0);
    return campDir === "desc" ? bv - av : av - bv;
  });

  const AgentSortBtn = ({ k, label }: { k: AgentSortKey; label: string }) => (
    <button onClick={() => handleAgentSort(k)}
      className={`text-xs font-medium px-2 py-1 rounded hover:bg-muted/50 transition-colors ${agentSort === k ? "text-primary" : "text-muted-foreground"}`}>
      {label} {agentSort === k ? (agentDir === "desc" ? "↓" : "↑") : ""}
    </button>
  );

  const CampSortBtn = ({ k, label }: { k: CampaignSortKey; label: string }) => (
    <button onClick={() => handleCampSort(k)}
      className={`text-xs font-medium px-2 py-1 rounded hover:bg-muted/50 transition-colors ${campSort === k ? "text-primary" : "text-muted-foreground"}`}>
      {label} {campSort === k ? (campDir === "desc" ? "↓" : "↑") : ""}
    </button>
  );

  // Top 3 agents for podium
  const top3 = sortedAgents.slice(0, 3);

  return (
    <div className="p-6 space-y-6 max-w-[1600px] mx-auto">
      <PageHeader
        title="Leaderboards"
        description="Agent and campaign performance rankings"
        icon={Trophy}
      />

      {/* Podium (Agents only) */}
      {tab === "agents" && top3.length >= 3 && (
        <div className="rounded-xl border border-border bg-card p-6">
          <h2 className="text-sm font-semibold text-center mb-6 text-foreground">Top Performers</h2>
          <div className="flex items-end justify-center gap-4">
            {/* 2nd place */}
            {top3[1] && (
              <div className="flex flex-col items-center gap-2">
                <div className="h-12 w-12 rounded-xl flex items-center justify-center text-lg font-bold text-white"
                  style={{ background: AGENT_COLORS[1] }}>
                  {(top3[1] as any).name.charAt(0)}
                </div>
                <p className="text-xs font-semibold text-foreground text-center">{(top3[1] as any).name.split(" ")[0]}</p>
                <p className="text-xs text-muted-foreground">{fmt((top3[1] as any).totalRevenue, "$")}</p>
                <div className="w-20 h-16 rounded-t-lg bg-muted/50 border border-border flex items-center justify-center">
                  <Medal className="h-5 w-5 text-[oklch(0.75_0.05_264)]" />
                </div>
              </div>
            )}
            {/* 1st place */}
            {top3[0] && (
              <div className="flex flex-col items-center gap-2">
                <Crown className="h-5 w-5 text-[oklch(0.82_0.17_85)]" />
                <div className="h-14 w-14 rounded-xl flex items-center justify-center text-xl font-bold text-white ring-2 ring-[oklch(0.82_0.17_85)]"
                  style={{ background: AGENT_COLORS[0] }}>
                  {(top3[0] as any).name.charAt(0)}
                </div>
                <p className="text-sm font-bold text-foreground text-center">{(top3[0] as any).name.split(" ")[0]}</p>
                <p className="text-xs text-[oklch(0.72_0.16_162)] font-semibold">{fmt((top3[0] as any).totalRevenue, "$")}</p>
                <div className="w-20 h-24 rounded-t-lg bg-primary/10 border border-primary/30 flex items-center justify-center">
                  <Trophy className="h-6 w-6 text-primary" />
                </div>
              </div>
            )}
            {/* 3rd place */}
            {top3[2] && (
              <div className="flex flex-col items-center gap-2">
                <div className="h-12 w-12 rounded-xl flex items-center justify-center text-lg font-bold text-white"
                  style={{ background: AGENT_COLORS[2] }}>
                  {(top3[2] as any).name.charAt(0)}
                </div>
                <p className="text-xs font-semibold text-foreground text-center">{(top3[2] as any).name.split(" ")[0]}</p>
                <p className="text-xs text-muted-foreground">{fmt((top3[2] as any).totalRevenue, "$")}</p>
                <div className="w-20 h-10 rounded-t-lg bg-muted/30 border border-border flex items-center justify-center">
                  <Star className="h-4 w-4 text-[oklch(0.65_0.14_50)]" />
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Tabs */}
      <div className="rounded-xl border border-border bg-card overflow-hidden">
        <div className="flex border-b border-border">
          {(["agents", "campaigns"] as const).map(t => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={`px-5 py-3 text-sm font-medium capitalize transition-colors ${tab === t ? "text-primary border-b-2 border-primary bg-primary/5" : "text-muted-foreground hover:text-foreground"}`}
            >
              {t === "agents" ? "🏆 Agent Rankings" : "📢 Campaign Rankings"}
            </button>
          ))}
        </div>

        {tab === "agents" && (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border bg-muted/20">
                  <th className="text-left px-5 py-3 text-xs font-semibold text-muted-foreground w-12">Rank</th>
                  <th className="text-left px-5 py-3 text-xs font-semibold text-muted-foreground">Agent</th>
                  <th className="text-left px-5 py-3"><AgentSortBtn k="totalRevenue" label="Revenue" /></th>
                  <th className="text-left px-5 py-3"><AgentSortBtn k="conversionRate" label="Conv. Rate" /></th>
                  <th className="text-left px-5 py-3"><AgentSortBtn k="totalLeads" label="Leads" /></th>
                  <th className="text-left px-5 py-3"><AgentSortBtn k="avgResponseTime" label="Response" /></th>
                  <th className="text-left px-5 py-3"><AgentSortBtn k="followUpRate" label="Follow-Up" /></th>
                  <th className="text-left px-5 py-3 text-xs font-semibold text-muted-foreground">Score</th>
                </tr>
              </thead>
              <tbody>
                {sortedAgents.map((a: any, i: number) => {
                  const cr = Number(a.conversionRate);
                  const rt = Number(a.avgResponseTime);
                  const fr = Number(a.followUpRate);
                  // Composite score
                  const score = Math.min(100, (cr * 3) + (Math.max(0, 100 - rt / 6)) * 0.3 + fr * 0.3);
                  const isTop = i < 3;

                  return (
                    <tr key={a.id} className={`border-b border-border/50 hover:bg-muted/20 transition-colors ${isTop ? "bg-primary/3" : ""}`}>
                      <td className="px-5 py-3">
                        <div className="flex items-center justify-center">{rankIcon(i)}</div>
                      </td>
                      <td className="px-5 py-3">
                        <div className="flex items-center gap-3">
                          <div
                            className="h-8 w-8 rounded-lg flex items-center justify-center text-xs font-bold text-white shrink-0"
                            style={{ background: AGENT_COLORS[i % AGENT_COLORS.length] }}
                          >
                            {a.name.charAt(0)}
                          </div>
                          <div>
                            <p className="text-xs font-semibold text-foreground">{a.name}</p>
                            <p className="text-xs text-muted-foreground">{a.team}</p>
                          </div>
                        </div>
                      </td>
                      <td className="px-5 py-3 text-xs font-mono font-semibold text-[oklch(0.72_0.16_162)]">{fmt(a.totalRevenue, "$")}</td>
                      <td className="px-5 py-3">
                        <StatusBadge status={cr >= 15 ? "green" : cr >= 8 ? "yellow" : "red"} label={`${cr.toFixed(1)}%`} />
                      </td>
                      <td className="px-5 py-3 text-xs font-mono">{Number(a.totalLeads).toLocaleString()}</td>
                      <td className="px-5 py-3">
                        <StatusBadge status={rt < 120 ? "green" : rt < 300 ? "yellow" : "red"} label={`${(rt / 60).toFixed(1)}m`} />
                      </td>
                      <td className="px-5 py-3">
                        <StatusBadge status={fr >= 85 ? "green" : fr >= 70 ? "yellow" : "red"} label={`${fr.toFixed(0)}%`} />
                      </td>
                      <td className="px-5 py-3">
                        <div className="flex items-center gap-2">
                          <div className="w-14 h-1.5 bg-muted rounded-full overflow-hidden">
                            <div
                              className="h-full rounded-full"
                              style={{
                                width: `${Math.min(100, score)}%`,
                                background: score >= 70 ? "oklch(0.72 0.16 162)" : score >= 40 ? "oklch(0.82 0.17 85)" : "oklch(0.65 0.22 25)"
                              }}
                            />
                          </div>
                          <span className="text-xs font-mono text-muted-foreground">{score.toFixed(0)}</span>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        {tab === "campaigns" && (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border bg-muted/20">
                  <th className="text-left px-5 py-3 text-xs font-semibold text-muted-foreground w-12">Rank</th>
                  <th className="text-left px-5 py-3 text-xs font-semibold text-muted-foreground">Campaign</th>
                  <th className="text-left px-5 py-3"><CampSortBtn k="revenue" label="Revenue" /></th>
                  <th className="text-left px-5 py-3"><CampSortBtn k="roas" label="ROAS" /></th>
                  <th className="text-left px-5 py-3"><CampSortBtn k="leads" label="Leads" /></th>
                  <th className="text-left px-5 py-3"><CampSortBtn k="conversions" label="Conv." /></th>
                  <th className="text-left px-5 py-3"><CampSortBtn k="spend" label="Spend" /></th>
                  <th className="text-left px-5 py-3 text-xs font-semibold text-muted-foreground">Status</th>
                </tr>
              </thead>
              <tbody>
                {sortedCampaigns.map((c: any, i: number) => {
                  const roas = Number(c.roas);
                  const isTop = i < 3;
                  return (
                    <tr key={c.id} className={`border-b border-border/50 hover:bg-muted/20 transition-colors ${isTop ? "bg-primary/3" : ""}`}>
                      <td className="px-5 py-3">
                        <div className="flex items-center justify-center">{rankIcon(i)}</div>
                      </td>
                      <td className="px-5 py-3">
                        <div>
                          <p className="text-xs font-semibold text-foreground">{c.name}</p>
                          <p className="text-xs text-muted-foreground">{c.country}</p>
                        </div>
                      </td>
                      <td className="px-5 py-3 text-xs font-mono font-semibold text-[oklch(0.72_0.16_162)]">{fmt(c.revenue, "$")}</td>
                      <td className="px-5 py-3">
                        <StatusBadge status={roas >= 3 ? "green" : roas >= 1.5 ? "yellow" : "red"} label={`${roas.toFixed(1)}x`} />
                      </td>
                      <td className="px-5 py-3 text-xs font-mono">{Number(c.leads).toLocaleString()}</td>
                      <td className="px-5 py-3 text-xs font-mono">{Number(c.conversions).toLocaleString()}</td>
                      <td className="px-5 py-3 text-xs font-mono">{fmt(c.spend, "$")}</td>
                      <td className="px-5 py-3">
                        <StatusBadge status={c.status === "active" ? "green" : "gray"} label={c.status} />
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
