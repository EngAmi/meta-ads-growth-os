import { useState, useRef, useEffect } from "react";
import DashboardLayout from "@/components/DashboardLayout";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";
import {
  Plug, Upload, RefreshCw, Trash2, CheckCircle2, XCircle,
  AlertCircle, Clock, FileSpreadsheet, CloudUpload, Eye,
  ChevronRight, Loader2, Wifi, WifiOff, Info, MessageCircle,
  Copy, Shield, CheckCheck, ExternalLink
} from "lucide-react";

// ─── Helpers ──────────────────────────────────────────────────────────────────
function ConnStatusBadge({ status }: { status: string }) {
  const map: Record<string, { label: string; color: string; icon: React.ReactNode }> = {
    connected:    { label: "Connected",    color: "text-emerald-400 bg-emerald-400/10 border-emerald-400/30", icon: <Wifi className="w-3 h-3" /> },
    disconnected: { label: "Disconnected", color: "text-slate-400 bg-slate-400/10 border-slate-400/30",   icon: <WifiOff className="w-3 h-3" /> },
    error:        { label: "Error",        color: "text-red-400 bg-red-400/10 border-red-400/30",         icon: <XCircle className="w-3 h-3" /> },
    syncing:      { label: "Syncing…",     color: "text-blue-400 bg-blue-400/10 border-blue-400/30",      icon: <Loader2 className="w-3 h-3 animate-spin" /> },
  };
  const s = map[status] || map.disconnected;
  return (
    <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium border ${s.color}`}>
      {s.icon}{s.label}
    </span>
  );
}

function ImportStatusBadge({ status }: { status: string }) {
  const map: Record<string, { label: string; color: string }> = {
    pending:    { label: "Pending",    color: "text-yellow-400 bg-yellow-400/10 border-yellow-400/30" },
    processing: { label: "Processing", color: "text-blue-400 bg-blue-400/10 border-blue-400/30" },
    completed:  { label: "Completed",  color: "text-emerald-400 bg-emerald-400/10 border-emerald-400/30" },
    failed:     { label: "Failed",     color: "text-red-400 bg-red-400/10 border-red-400/30" },
  };
  const s = map[status] || map.pending;
  return (
    <span className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-medium border ${s.color}`}>
      {s.label}
    </span>
  );
}

function IntentBadge({ level }: { level: string }) {
  const map: Record<string, string> = {
    high:   "text-emerald-400 bg-emerald-400/10 border-emerald-400/30",
    medium: "text-yellow-400 bg-yellow-400/10 border-yellow-400/30",
    low:    "text-red-400 bg-red-400/10 border-red-400/30",
  };
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium border capitalize ${map[level] || map.low}`}>
      {level}
    </span>
  );
}

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  const handleCopy = () => {
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };
  return (
    <button onClick={handleCopy}
      className="ml-2 p-1 rounded text-slate-400 hover:text-white hover:bg-slate-700 transition-colors">
      {copied ? <CheckCheck className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
    </button>
  );
}

// ─── Facebook OAuth Button ───────────────────────────────────────────────────
function FacebookOAuthButton() {
  const handleConnect = () => {
    // Redirect to the backend /start endpoint which builds the Facebook dialog URL
    window.location.href = "/api/meta/oauth/start";
  };

  return (
    <button
      onClick={handleConnect}
      className="w-full flex items-center justify-center gap-3 px-4 py-3 rounded-xl bg-[#1877F2] hover:bg-[#1664d8] active:bg-[#1558c0] text-white font-semibold text-sm transition-colors shadow-lg shadow-blue-500/20"
    >
      {/* Official Facebook logo */}
      <svg viewBox="0 0 24 24" className="w-5 h-5 fill-white shrink-0">
        <path d="M24 12.073c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.99 4.388 10.954 10.125 11.854v-8.385H7.078v-3.47h3.047V9.43c0-3.007 1.792-4.669 4.533-4.669 1.312 0 2.686.235 2.686.235v2.953H15.83c-1.491 0-1.956.925-1.956 1.874v2.25h3.328l-.532 3.47h-2.796v8.385C19.612 23.027 24 18.062 24 12.073z"/>
      </svg>
      Continue with Facebook
    </button>
  );
}

// ─── Meta API Connection Form ─────────────────────────────────────────────────
type AdAccount = { id: string; accountId: string; name: string; status: string; currency: string; timezone: string; businessName: string | null };

function MetaConnectionForm({ onSaved }: { onSaved: () => void }) {
  const [name, setName] = useState("My Meta Ads Account");
  const [token, setToken] = useState("");
  const [syncDays, setSyncDays] = useState("30");
  // Ad account picker state
  const [adAccounts, setAdAccounts] = useState<AdAccount[]>([]);
  const [selectedAccount, setSelectedAccount] = useState<AdAccount | null>(null);
  const [fetchingAccounts, setFetchingAccounts] = useState(false);
  const [userName, setUserName] = useState("");
  const [accountsFetched, setAccountsFetched] = useState(false);
  // Save state
  const [saving, setSaving] = useState(false);

  const fetchAccountsMutation = trpc.dataSources.fetchAdAccounts.useMutation();
  const saveMutation = trpc.dataSources.saveConnection.useMutation();

  const handleFetchAccounts = async () => {
    if (!token.trim()) { toast.error("Enter your Access Token first"); return; }
    setFetchingAccounts(true);
    setAdAccounts([]);
    setSelectedAccount(null);
    setAccountsFetched(false);
    try {
      const res = await fetchAccountsMutation.mutateAsync({ accessToken: token.trim() });
      setAdAccounts(res.accounts);
      setUserName(res.userName);
      setAccountsFetched(true);
      if (res.accounts.length === 0) {
        toast.warning("No ad accounts found for this token. Make sure ads_read permission is granted.");
      } else {
        toast.success(`Found ${res.total} ad account${res.total !== 1 ? 's' : ''}${res.userName ? ` for ${res.userName}` : ''}`);
        // Auto-select if only one account
        if (res.accounts.length === 1) setSelectedAccount(res.accounts[0]);
      }
    } catch (e: any) {
      toast.error(e.message || "Failed to fetch ad accounts");
    } finally { setFetchingAccounts(false); }
  };

  const handleSave = async () => {
    if (!name || !token || !selectedAccount) { toast.error("Select an ad account first"); return; }
    setSaving(true);
    try {
      await saveMutation.mutateAsync({
        name,
        accessToken: token.trim(),
        adAccountId: selectedAccount.accountId,
        syncDays: parseInt(syncDays)
      });
      toast.success(`Connection saved — ${selectedAccount.name}`);
      setToken(""); setAdAccounts([]); setSelectedAccount(null); setAccountsFetched(false); setUserName("");
      onSaved();
    } catch (e: any) { toast.error(e.message || "Save failed"); }
    finally { setSaving(false); }
  };

  return (
    <div className="space-y-6">
      {/* How-to guide */}
      <div className="flex gap-3 p-4 rounded-xl bg-blue-500/5 border border-blue-500/20">
        <Info className="w-5 h-5 text-blue-400 mt-0.5 shrink-0" />
        <div className="text-sm text-slate-300 space-y-1">
          <p className="font-medium text-blue-300">How to get your Meta Access Token</p>
          <ol className="list-decimal list-inside space-y-1 text-slate-400">
            <li>Go to <span className="text-blue-400 font-mono">developers.facebook.com</span> → Your App → Tools → Graph API Explorer</li>
            <li>Select your app, click <strong>Generate Access Token</strong>, grant <code>ads_read</code> permission</li>
            <li>For long-lived token: exchange via <code>oauth/access_token</code> endpoint (60-day expiry)</li>
            <li>Paste the token below, then click <strong>Fetch My Ad Accounts</strong></li>
          </ol>
        </div>
      </div>

      {/* Step 1: Token + basic settings */}
      <div className="space-y-4">
        <div className="flex items-center gap-2 mb-1">
          <span className="w-6 h-6 rounded-full bg-violet-600 text-white text-xs font-bold flex items-center justify-center">1</span>
          <span className="text-sm font-semibold text-slate-200">Enter your Access Token</span>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="space-y-2">
            <Label className="text-slate-300">Connection Name</Label>
            <Input value={name} onChange={e => setName(e.target.value)} placeholder="My Meta Ads Account"
              className="bg-slate-800/60 border-slate-700 text-white placeholder:text-slate-500" />
          </div>
          <div className="space-y-2">
            <Label className="text-slate-300">Sync Period (days)</Label>
            <Select value={syncDays} onValueChange={setSyncDays}>
              <SelectTrigger className="bg-slate-800/60 border-slate-700 text-white">
                <SelectValue />
              </SelectTrigger>
              <SelectContent className="bg-slate-900 border-slate-700">
                {["7","14","30","60","90"].map(d => (
                  <SelectItem key={d} value={d} className="text-slate-200">{d} days</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2 md:col-span-2">
            <Label className="text-slate-300">Access Token <span className="text-red-400">*</span></Label>
            <div className="flex gap-2">
              <Input type="password" value={token} onChange={e => { setToken(e.target.value); setAccountsFetched(false); setAdAccounts([]); setSelectedAccount(null); }}
                placeholder="EAAxxxxxxxxxxxxxxx..."
                className="bg-slate-800/60 border-slate-700 text-white placeholder:text-slate-500 font-mono text-sm flex-1" />
              <Button onClick={handleFetchAccounts} disabled={fetchingAccounts || !token.trim()}
                className="bg-blue-600 hover:bg-blue-500 text-white shrink-0 px-4">
                {fetchingAccounts
                  ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" />Fetching...</>
                  : <><Plug className="w-4 h-4 mr-2" />Fetch My Ad Accounts</>}
              </Button>
            </div>
          </div>
        </div>
      </div>

      {/* Step 2: Ad Account Picker — shown after fetch */}
      {accountsFetched && (
        <div className="space-y-4">
          <div className="flex items-center gap-2 mb-1">
            <span className="w-6 h-6 rounded-full bg-violet-600 text-white text-xs font-bold flex items-center justify-center">2</span>
            <span className="text-sm font-semibold text-slate-200">Select Ad Account to connect</span>
            {userName && <span className="text-xs text-slate-400 ml-1">({userName})</span>}
          </div>

          {adAccounts.length === 0 ? (
            <div className="flex items-center gap-3 p-4 rounded-xl bg-yellow-500/10 border border-yellow-500/30 text-yellow-300">
              <AlertCircle className="w-5 h-5 shrink-0" />
              <span className="text-sm">No ad accounts found. Make sure your token has <code>ads_read</code> permission.</span>
            </div>
          ) : (
            <div className="space-y-2 max-h-72 overflow-y-auto pr-1">
              {adAccounts.map(acc => (
                <button
                  key={acc.id}
                  onClick={() => setSelectedAccount(acc)}
                  className={`w-full flex items-center justify-between p-4 rounded-xl border text-left transition-all ${
                    selectedAccount?.id === acc.id
                      ? 'bg-violet-600/15 border-violet-500/60 ring-1 ring-violet-500/40'
                      : 'bg-slate-800/40 border-slate-700/50 hover:border-slate-600 hover:bg-slate-800/70'
                  }`}
                >
                  <div className="flex items-center gap-3">
                    <div className={`w-4 h-4 rounded-full border-2 flex items-center justify-center shrink-0 ${
                      selectedAccount?.id === acc.id ? 'border-violet-400 bg-violet-400' : 'border-slate-500'
                    }`}>
                      {selectedAccount?.id === acc.id && <div className="w-2 h-2 rounded-full bg-white" />}
                    </div>
                    <div>
                      <p className="text-sm font-medium text-white">{acc.name}</p>
                      <p className="text-xs text-slate-400 font-mono mt-0.5">act_{acc.accountId}
                        {acc.businessName && <span className="text-slate-500"> · {acc.businessName}</span>}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <span className="text-xs text-slate-400">{acc.currency}</span>
                    <span className={`text-xs px-2 py-0.5 rounded-full border font-medium ${
                      acc.status === 'ACTIVE'
                        ? 'text-emerald-400 bg-emerald-400/10 border-emerald-400/30'
                        : 'text-red-400 bg-red-400/10 border-red-400/30'
                    }`}>{acc.status}</span>
                  </div>
                </button>
              ))}
            </div>
          )}

          {selectedAccount && (
            <div className="flex items-center gap-3 p-3 rounded-lg bg-emerald-500/10 border border-emerald-500/30 text-emerald-300">
              <CheckCircle2 className="w-5 h-5 shrink-0" />
              <span className="text-sm font-medium">
                Selected: <strong>{selectedAccount.name}</strong>
                <span className="text-emerald-400/70 font-mono ml-2 text-xs">act_{selectedAccount.accountId}</span>
                <span className="text-emerald-400/60 ml-2 text-xs">{selectedAccount.currency} · {selectedAccount.timezone}</span>
              </span>
            </div>
          )}
        </div>
      )}

      {/* Step 3: Save */}
      {accountsFetched && adAccounts.length > 0 && (
        <div className="space-y-3">
          <div className="flex items-center gap-2 mb-1">
            <span className="w-6 h-6 rounded-full bg-violet-600 text-white text-xs font-bold flex items-center justify-center">3</span>
            <span className="text-sm font-semibold text-slate-200">Save and start syncing</span>
          </div>
          <Button onClick={handleSave} disabled={saving || !selectedAccount}
            className="bg-violet-600 hover:bg-violet-500 text-white w-full sm:w-auto">
            {saving ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" />Saving...</> : <><CheckCircle2 className="w-4 h-4 mr-2" />Save Connection</>}
          </Button>
          {!selectedAccount && <p className="text-xs text-slate-500">Select an ad account above to continue.</p>}
        </div>
      )}
    </div>
  );
}

// ─── Engine Integration Status Badge ────────────────────────────────────────
function EngineStatusBadge({ status }: { status: string }) {
  const map: Record<string, { label: string; color: string; icon: React.ReactNode }> = {
    active:  { label: "Active",   color: "text-emerald-400 bg-emerald-400/10 border-emerald-400/30", icon: <CheckCircle2 className="w-3 h-3" /> },
    expired: { label: "Expired",  color: "text-red-400 bg-red-400/10 border-red-400/30",           icon: <XCircle className="w-3 h-3" /> },
    error:   { label: "Error",    color: "text-red-400 bg-red-400/10 border-red-400/30",           icon: <AlertCircle className="w-3 h-3" /> },
    syncing: { label: "Syncing…", color: "text-blue-400 bg-blue-400/10 border-blue-400/30",        icon: <Loader2 className="w-3 h-3 animate-spin" /> },
  };
  const s = map[status] || { label: status, color: "text-slate-400 bg-slate-400/10 border-slate-400/30", icon: <Info className="w-3 h-3" /> };
  return (
    <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium border ${s.color}`}>
      {s.icon}{s.label}
    </span>
  );
}

function PipelineRunStatusBadge({ status }: { status: string }) {
  const map: Record<string, string> = {
    completed: "text-emerald-400 bg-emerald-400/10 border-emerald-400/30",
    partial:   "text-yellow-400 bg-yellow-400/10 border-yellow-400/30",
    failed:    "text-red-400 bg-red-400/10 border-red-400/30",
    running:   "text-blue-400 bg-blue-400/10 border-blue-400/30",
  };
  return (
    <span className={`inline-flex items-center px-2.5 py-1 rounded-full text-xs font-medium border capitalize ${map[status] || "text-slate-400 bg-slate-400/10 border-slate-400/30"}`}>
      {status}
    </span>
  );
}

// ─── Engine Integrations Panel ────────────────────────────────────────────────
function EngineIntegrationsPanel() {
  const { data: integrations = [], refetch: refetchIntegrations } = trpc.engineDataSources.list.useQuery();
  const { data: latestRun, refetch: refetchRun } = trpc.engineDataSources.runStatus.useQuery();

  const engineSync = trpc.engineDataSources.syncNow.useMutation({
    onSuccess: (result) => {
      refetchIntegrations();
      refetchRun();
      toast.success(`Engine sync complete — ${result.stepsCompleted} steps, status: ${result.status}`);
    },
    onError: (err) => toast.error(`Engine sync failed: ${err.message}`),
  });

  return (
    <div className="space-y-4">
      {/* Integrations list */}
      {integrations.length === 0 ? (
        <div className="text-center py-8 text-slate-500">
          <Plug className="w-10 h-10 mx-auto mb-2 opacity-30" />
          <p className="text-sm">No engine integrations yet. Save a connection above to create one.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {integrations.map((intg: any) => (
            <div key={intg.id} className="flex items-center justify-between p-4 rounded-xl bg-slate-800/40 border border-slate-700/50 hover:border-slate-600/50 transition-colors">
              <div className="flex items-center gap-4">
                <div className="w-10 h-10 rounded-lg bg-blue-500/10 border border-blue-500/20 flex items-center justify-center">
                  <svg viewBox="0 0 24 24" className="w-5 h-5 fill-blue-400">
                    <path d="M24 12.073c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.99 4.388 10.954 10.125 11.854v-8.385H7.078v-3.47h3.047V9.43c0-3.007 1.792-4.669 4.533-4.669 1.312 0 2.686.235 2.686.235v2.953H15.83c-1.491 0-1.956.925-1.956 1.874v2.25h3.328l-.532 3.47h-2.796v8.385C19.612 23.027 24 18.062 24 12.073z"/>
                  </svg>
                </div>
                <div>
                  <p className="font-medium text-white capitalize">{intg.provider?.replace('_', ' ')} · <span className="font-mono text-slate-300">act_{String(intg.adAccountId || '').replace('act_', '')}</span></p>
                  {intg.lastSyncAt ? (
                    <p className="text-xs text-slate-400 mt-0.5">
                      Last sync: {new Date(intg.lastSyncAt).toLocaleString()} · {intg.lastSyncRows ?? 0} rows
                    </p>
                  ) : (
                    <p className="text-xs text-slate-500 mt-0.5">Never synced</p>
                  )}
                  {intg.status === 'expired' && (
                    <p className="text-xs text-red-400 mt-0.5">Token expired — reconnect to resume syncing</p>
                  )}
                </div>
              </div>
              <EngineStatusBadge status={intg.status} />
            </div>
          ))}
        </div>
      )}

      {/* Sync Now button */}
      <div className="flex items-center justify-between pt-2">
        <Button
          onClick={() => engineSync.mutate()}
          disabled={engineSync.isPending}
          className="bg-violet-600 hover:bg-violet-500 text-white gap-2"
        >
          {engineSync.isPending
            ? <><Loader2 className="w-4 h-4 animate-spin" />Running pipeline…</>
            : <><RefreshCw className="w-4 h-4" />Sync Now</>}
        </Button>

        {/* Last Pipeline Run status */}
        {latestRun && (
          <div className="flex items-center gap-3 text-xs text-slate-400">
            <Clock className="w-3.5 h-3.5" />
            <span className="font-mono">{String(latestRun.runId).slice(0, 8)}…</span>
            <PipelineRunStatusBadge status={latestRun.status} />
            <span>{latestRun.stepsCompleted ?? 0}/6 steps</span>
            {latestRun.durationMs != null && (
              <span>{(Number(latestRun.durationMs) / 1000).toFixed(1)}s</span>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Saved Connections List ───────────────────────────────────────────────────
function ConnectionsList() {
  const { data: connections = [], refetch } = trpc.dataSources.listConnections.useQuery();
  const syncMutation = trpc.dataSources.syncConnection.useMutation();
  const deleteMutation = trpc.dataSources.deleteConnection.useMutation();
  const [syncingId, setSyncingId] = useState<number | null>(null);

  const handleSync = async (id: number) => {
    setSyncingId(id);
    try {
      const res = await syncMutation.mutateAsync({ connectionId: id });
      if (res.success) toast.success(`Synced ${res.rowsImported} rows from Meta Ads`);
      else toast.error(res.error || "Sync failed");
    } finally { setSyncingId(null); refetch(); }
  };

  const handleDelete = async (id: number) => {
    if (!confirm("Delete this connection?")) return;
    await deleteMutation.mutateAsync({ id });
    toast.success("Connection deleted");
    refetch();
  };

  if (connections.length === 0) {
    return (
      <div className="text-center py-12 text-slate-500">
        <Plug className="w-12 h-12 mx-auto mb-3 opacity-30" />
        <p>No connections yet. Add your first Meta Ads connection above.</p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {connections.map((conn: any) => (
        <div key={conn.id} className="flex items-center justify-between p-4 rounded-xl bg-slate-800/40 border border-slate-700/50 hover:border-slate-600/50 transition-colors">
          <div className="flex items-center gap-4">
            <div className="w-10 h-10 rounded-lg bg-blue-500/10 border border-blue-500/20 flex items-center justify-center">
              <svg viewBox="0 0 24 24" className="w-5 h-5 fill-blue-400">
                <path d="M24 12.073c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.99 4.388 10.954 10.125 11.854v-8.385H7.078v-3.47h3.047V9.43c0-3.007 1.792-4.669 4.533-4.669 1.312 0 2.686.235 2.686.235v2.953H15.83c-1.491 0-1.956.925-1.956 1.874v2.25h3.328l-.532 3.47h-2.796v8.385C19.612 23.027 24 18.062 24 12.073z"/>
              </svg>
            </div>
            <div>
              <p className="font-medium text-white">{conn.name}</p>
              <p className="text-xs text-slate-400 font-mono">act_{conn.adAccountId?.replace('act_', '')} · {conn.syncDays}d sync</p>
              {conn.lastSyncAt && (
                <p className="text-xs text-slate-500 mt-0.5">
                  Last sync: {new Date(conn.lastSyncAt).toLocaleString()} · {conn.lastSyncRows} rows
                </p>
              )}
              {conn.lastError && <p className="text-xs text-red-400 mt-0.5">Error: {conn.lastError}</p>}
            </div>
          </div>
          <div className="flex items-center gap-3">
            <ConnStatusBadge status={conn.status} />
            <Button size="sm" variant="outline" onClick={() => handleSync(conn.id)}
              disabled={syncingId === conn.id}
              className="border-slate-600 text-slate-300 hover:bg-slate-700 h-8">
              {syncingId === conn.id ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />}
              <span className="ml-1.5 text-xs">Sync</span>
            </Button>
            <Button size="sm" variant="ghost" onClick={() => handleDelete(conn.id)}
              className="text-red-400 hover:bg-red-500/10 h-8 w-8 p-0">
              <Trash2 className="w-3.5 h-3.5" />
            </Button>
          </div>
        </div>
      ))}
    </div>
  );
}

// ─── File Upload Tab ──────────────────────────────────────────────────────────
function FileUploadTab() {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [uploadResult, setUploadResult] = useState<any>(null);
  const [importing, setImporting] = useState(false);

  const { data: imports = [], refetch } = trpc.dataSources.listImports.useQuery();
  const processMutation = trpc.dataSources.processImport.useMutation();
  const deleteMutation = trpc.dataSources.deleteImport.useMutation();

  const handleFile = async (file: File) => {
    if (!file) return;
    const ext = file.name.split(".").pop()?.toLowerCase();
    if (!["csv", "xlsx", "xls"].includes(ext || "")) {
      toast.error("Only CSV and Excel files are supported");
      return;
    }
    setUploading(true);
    setUploadResult(null);
    try {
      const formData = new FormData();
      formData.append("file", file);
      const res = await fetch("/api/upload/meta-report", { method: "POST", body: formData });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Upload failed");
      setUploadResult(data);
      toast.success(`Uploaded ${data.totalRows} rows from ${file.name}`);
      refetch();
    } catch (e: any) {
      toast.error(e.message || "Upload failed");
    } finally { setUploading(false); }
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragging(false);
    const file = e.dataTransfer.files[0];
    if (file) handleFile(file);
  };

  const handleImport = async (jobId: number) => {
    setImporting(true);
    try {
      const res = await processMutation.mutateAsync({ jobId });
      if (res.success) toast.success(`Imported ${res.imported} rows (${res.skipped} skipped)`);
      else toast.error(res.error || "Import failed");
      refetch();
    } finally { setImporting(false); }
  };

  const handleDeleteImport = async (id: number) => {
    await deleteMutation.mutateAsync({ id });
    toast.success("Import deleted");
    if (uploadResult?.jobId === id) setUploadResult(null);
    refetch();
  };

  return (
    <div className="space-y-6">
      <div className="flex gap-3 p-4 rounded-xl bg-violet-500/5 border border-violet-500/20">
        <Info className="w-5 h-5 text-violet-400 mt-0.5 shrink-0" />
        <div className="text-sm text-slate-300 space-y-1">
          <p className="font-medium text-violet-300">How to export from Meta Ads Manager</p>
          <ol className="list-decimal list-inside space-y-1 text-slate-400">
            <li>Open <strong>Meta Ads Manager</strong> → select your campaigns</li>
            <li>Click <strong>Export</strong> → <strong>Export Table Data</strong></li>
            <li>Choose <strong>CSV</strong> or <strong>Excel</strong> format, select date range</li>
            <li>Include: Campaign name, Day, Amount spent, Impressions, Clicks, CTR, CPC, CPM, Reach, Leads, Results</li>
            <li>Upload the downloaded file below</li>
          </ol>
        </div>
      </div>

      <div
        onDragOver={e => { e.preventDefault(); setDragging(true); }}
        onDragLeave={() => setDragging(false)}
        onDrop={handleDrop}
        onClick={() => fileInputRef.current?.click()}
        className={`relative cursor-pointer rounded-2xl border-2 border-dashed transition-all duration-200 p-12 text-center
          ${dragging ? 'border-violet-400 bg-violet-500/10' : 'border-slate-700 hover:border-slate-500 bg-slate-800/20 hover:bg-slate-800/40'}`}
      >
        <input ref={fileInputRef} type="file" accept=".csv,.xlsx,.xls" className="hidden"
          onChange={e => { const f = e.target.files?.[0]; if (f) handleFile(f); }} />
        {uploading ? (
          <div className="flex flex-col items-center gap-3">
            <Loader2 className="w-12 h-12 text-violet-400 animate-spin" />
            <p className="text-slate-300 font-medium">Parsing file…</p>
          </div>
        ) : (
          <div className="flex flex-col items-center gap-3">
            <CloudUpload className={`w-12 h-12 ${dragging ? 'text-violet-400' : 'text-slate-500'}`} />
            <div>
              <p className="text-white font-medium">Drop your Meta Ads report here</p>
              <p className="text-slate-400 text-sm mt-1">or click to browse · CSV, XLS, XLSX · max 20 MB</p>
            </div>
          </div>
        )}
      </div>

      {uploadResult && (
        <Card className="bg-slate-800/40 border-slate-700">
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between">
              <CardTitle className="text-base text-white flex items-center gap-2">
                <FileSpreadsheet className="w-5 h-5 text-violet-400" />
                {uploadResult.fileName}
              </CardTitle>
              <Badge variant="outline" className="text-emerald-400 border-emerald-400/30">
                {uploadResult.totalRows} rows detected
              </Badge>
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            <div>
              <p className="text-xs text-slate-400 mb-2 font-medium uppercase tracking-wider">Auto-detected Column Mapping</p>
              <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
                {Object.entries(uploadResult.mapping || {}).map(([key, val]: any) => (
                  <div key={key} className="flex items-center gap-2 text-xs bg-slate-900/50 rounded-lg px-3 py-2">
                    <ChevronRight className="w-3 h-3 text-violet-400 shrink-0" />
                    <span className="text-slate-400">{key}</span>
                    <span className="text-slate-200 font-mono truncate">{val}</span>
                  </div>
                ))}
              </div>
            </div>
            {uploadResult.preview?.length > 0 && (
              <div>
                <p className="text-xs text-slate-400 mb-2 font-medium uppercase tracking-wider flex items-center gap-1">
                  <Eye className="w-3 h-3" /> Data Preview (first 5 rows)
                </p>
                <div className="overflow-x-auto rounded-lg border border-slate-700">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="bg-slate-900/60">
                        {Object.keys(uploadResult.preview[0] || {}).slice(0, 8).map((col: string) => (
                          <th key={col} className="px-3 py-2 text-left text-slate-400 font-medium whitespace-nowrap">{col}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {uploadResult.preview.map((row: any, i: number) => (
                        <tr key={i} className="border-t border-slate-800 hover:bg-slate-800/30">
                          {Object.values(row).slice(0, 8).map((val: any, j: number) => (
                            <td key={j} className="px-3 py-2 text-slate-300 whitespace-nowrap">{String(val)}</td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
            <Button onClick={() => handleImport(uploadResult.jobId)} disabled={importing}
              className="w-full bg-violet-600 hover:bg-violet-500 text-white">
              {importing ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Upload className="w-4 h-4 mr-2" />}
              Import {uploadResult.totalRows} Rows into Growth OS
            </Button>
          </CardContent>
        </Card>
      )}

      <div>
        <h3 className="text-sm font-semibold text-slate-300 mb-3 uppercase tracking-wider">Import History</h3>
        {imports.length === 0 ? (
          <div className="text-center py-8 text-slate-500">
            <FileSpreadsheet className="w-10 h-10 mx-auto mb-2 opacity-30" />
            <p className="text-sm">No imports yet</p>
          </div>
        ) : (
          <div className="space-y-2">
            {imports.map((job: any) => (
              <div key={job.id} className="flex items-center justify-between p-4 rounded-xl bg-slate-800/40 border border-slate-700/50">
                <div className="flex items-center gap-3">
                  <FileSpreadsheet className="w-5 h-5 text-slate-400" />
                  <div>
                    <p className="text-sm font-medium text-white">{job.fileName}</p>
                    <p className="text-xs text-slate-400">
                      {new Date(job.createdAt).toLocaleString()}
                      {job.status === 'completed' ? ` · ${job.importedRows} imported, ${job.skippedRows} skipped` : ''}
                      {job.errorMessage ? ` · Error: ${job.errorMessage}` : ''}
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <ImportStatusBadge status={job.status} />
                  {job.status === 'pending' && (
                    <Button size="sm" variant="outline" onClick={() => handleImport(job.id)} disabled={importing}
                      className="h-7 text-xs border-slate-600 text-slate-300">Import</Button>
                  )}
                  <Button size="sm" variant="ghost" onClick={() => handleDeleteImport(job.id)}
                    className="text-red-400 hover:bg-red-500/10 h-7 w-7 p-0">
                    <Trash2 className="w-3.5 h-3.5" />
                  </Button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ─── WhatsApp Webhook Tab ─────────────────────────────────────────────────────
function WhatsAppTab() {
  const { data: config } = trpc.whatsapp.getConfig.useQuery();
  const { data: recentLeads = [] } = trpc.whatsapp.getRecentLeads.useQuery();
  const deployedDomain = window.location.origin;
  const webhookUrl = `${deployedDomain}/api/webhook/whatsapp`;

  return (
    <div className="space-y-6">
      {/* Status banner */}
      <div className="flex gap-3 p-4 rounded-xl bg-green-500/5 border border-green-500/20">
        <MessageCircle className="w-5 h-5 text-green-400 mt-0.5 shrink-0" />
        <div className="text-sm text-slate-300 space-y-1">
          <p className="font-medium text-green-300">WhatsApp Webhook is Active</p>
          <p className="text-slate-400">
            The webhook endpoint is running and ready to receive messages. Incoming WhatsApp messages are automatically
            scored for lead intent and saved to your leads database in real time.
          </p>
        </div>
      </div>

      {/* Setup steps */}
      <Card className="bg-slate-900/50 border-slate-700/50">
        <CardHeader>
          <CardTitle className="text-white text-base flex items-center gap-2">
            <Shield className="w-5 h-5 text-violet-400" />
            Setup Instructions
          </CardTitle>
          <CardDescription className="text-slate-400">
            Connect your WhatsApp Business account to start capturing leads automatically.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Webhook URL */}
          <div className="space-y-2">
            <Label className="text-slate-300 text-xs uppercase tracking-wider">Callback URL (paste into Meta Developer Console)</Label>
            <div className="flex items-center gap-2 p-3 rounded-lg bg-slate-800/60 border border-slate-700 font-mono text-sm text-emerald-300">
              <span className="flex-1 truncate">{webhookUrl}</span>
              <CopyButton text={webhookUrl} />
            </div>
          </div>

          {/* Verify token */}
          <div className="space-y-2">
            <Label className="text-slate-300 text-xs uppercase tracking-wider">Verify Token</Label>
            <div className="flex items-center gap-2 p-3 rounded-lg bg-slate-800/60 border border-slate-700 font-mono text-sm text-yellow-300">
              <span className="flex-1">{config?.verifyToken || "growth_os_verify_token"}</span>
              <CopyButton text={config?.verifyToken || "growth_os_verify_token"} />
            </div>
            <p className="text-xs text-slate-500">
              You can override this by adding <code className="text-violet-300">WHATSAPP_VERIFY_TOKEN</code> to your environment secrets.
            </p>
          </div>

          {/* Step-by-step */}
          <div className="space-y-2 pt-2">
            <Label className="text-slate-300 text-xs uppercase tracking-wider">Step-by-step Setup</Label>
            <ol className="space-y-2">
              {(config?.instructions || []).map((step: string, i: number) => (
                <li key={i} className="flex gap-3 text-sm text-slate-400">
                  <span className="w-5 h-5 rounded-full bg-violet-600/20 border border-violet-600/40 text-violet-300 text-xs flex items-center justify-center shrink-0 mt-0.5">
                    {i + 1}
                  </span>
                  {step.replace(/^\d+\.\s*/, "")}
                </li>
              ))}
            </ol>
          </div>

          {/* Security note */}
          <div className="flex gap-3 p-3 rounded-lg bg-slate-800/40 border border-slate-700/50">
            <AlertCircle className="w-4 h-4 text-yellow-400 mt-0.5 shrink-0" />
            <p className="text-xs text-slate-400">
              For production security, add <code className="text-violet-300">WHATSAPP_APP_SECRET</code> to your environment secrets.
              This enables signature verification on every incoming webhook request.
              {config?.hasAppSecret
                ? <span className="text-emerald-400 ml-1">✓ App secret is configured.</span>
                : <span className="text-yellow-400 ml-1">⚠ App secret not yet set.</span>}
            </p>
          </div>

          <a href="https://developers.facebook.com/docs/whatsapp/cloud-api/get-started" target="_blank" rel="noopener noreferrer">
            <Button variant="outline" className="border-slate-600 text-slate-300 hover:bg-slate-800 gap-2">
              <ExternalLink className="w-4 h-4" />
              Open Meta WhatsApp Cloud API Docs
            </Button>
          </a>
        </CardContent>
      </Card>

      {/* Lead scoring info */}
      <Card className="bg-slate-900/50 border-slate-700/50">
        <CardHeader>
          <CardTitle className="text-white text-base">Auto Lead Scoring</CardTitle>
          <CardDescription className="text-slate-400">
            Every incoming WhatsApp message is automatically analyzed and scored.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-3 gap-4 mb-4">
            {[
              { label: "High Intent", color: "emerald", desc: "Score ≥ 70", keywords: "price, buy, book, interested" },
              { label: "Medium Intent", color: "yellow", desc: "Score 45–69", keywords: "info, details, tell me, what is" },
              { label: "Low / Fake", color: "red", desc: "Score < 45", keywords: "hi, test, ok, very short messages" },
            ].map(item => (
              <div key={item.label} className={`p-3 rounded-xl bg-${item.color}-500/5 border border-${item.color}-500/20`}>
                <p className={`text-sm font-semibold text-${item.color}-400 mb-1`}>{item.label}</p>
                <p className={`text-xs text-${item.color}-300/70 mb-2`}>{item.desc}</p>
                <p className="text-xs text-slate-500 font-mono">{item.keywords}</p>
              </div>
            ))}
          </div>
          <p className="text-xs text-slate-500">
            Scoring uses keyword matching in Arabic and English, message length analysis, phone number validation, and question detection.
          </p>
        </CardContent>
      </Card>

      {/* Recent WhatsApp leads */}
      <Card className="bg-slate-900/50 border-slate-700/50">
        <CardHeader>
          <CardTitle className="text-white text-base flex items-center gap-2">
            <MessageCircle className="w-5 h-5 text-green-400" />
            Recent WhatsApp Leads
            <Badge variant="outline" className="text-slate-400 border-slate-600 text-xs">{recentLeads.length}</Badge>
          </CardTitle>
        </CardHeader>
        <CardContent>
          {recentLeads.length === 0 ? (
            <div className="text-center py-8 text-slate-500">
              <MessageCircle className="w-10 h-10 mx-auto mb-2 opacity-30" />
              <p className="text-sm">No WhatsApp leads yet. Complete setup above to start capturing.</p>
            </div>
          ) : (
            <div className="space-y-2">
              {recentLeads.map((lead: any) => {
                let info: any = {};
                try { info = typeof lead.contactInfo === 'string' ? JSON.parse(lead.contactInfo) : lead.contactInfo; } catch {}
                return (
                  <div key={lead.id} className="flex items-start justify-between p-3 rounded-xl bg-slate-800/40 border border-slate-700/50">
                    <div className="flex items-start gap-3">
                      <div className="w-8 h-8 rounded-full bg-green-500/10 border border-green-500/20 flex items-center justify-center shrink-0 mt-0.5">
                        <MessageCircle className="w-4 h-4 text-green-400" />
                      </div>
                      <div>
                        <p className="text-sm font-medium text-white">{lead.name || lead.phone}</p>
                        {lead.name && <p className="text-xs text-slate-400 font-mono">{lead.phone}</p>}
                        {info.message_text && (
                          <p className="text-xs text-slate-400 mt-1 max-w-md truncate">"{info.message_text}"</p>
                        )}
                        <p className="text-xs text-slate-500 mt-1">
                          {lead.firstContactAt ? new Date(lead.firstContactAt).toLocaleString() : ""}
                        </p>
                      </div>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <IntentBadge level={lead.intentLevel || "low"} />
                      <span className="text-xs font-mono text-slate-400">{lead.leadScore}</span>
                      {lead.isFake && (
                        <span className="text-xs text-red-400 bg-red-400/10 border border-red-400/20 px-2 py-0.5 rounded-full">Fake</span>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────
export default function DataSources() {
  const { refetch } = trpc.dataSources.listConnections.useQuery();

  // Handle OAuth redirect result query params
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const connected = params.get("meta_connected");
    const error = params.get("meta_error");
    if (connected === "1") {
      toast.success("Meta Ads connected via Facebook — your ad account is now linked.");
      refetch();
      // Clean the URL without a page reload
      window.history.replaceState({}, "", window.location.pathname);
    } else if (error) {
      const msg = decodeURIComponent(error);
      if (msg === "denied") {
        toast.warning("Facebook connection cancelled — no changes were made.");
      } else {
        toast.error(`Facebook connection failed: ${msg}`);
      }
      window.history.replaceState({}, "", window.location.pathname);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <DashboardLayout>
      <div className="p-6 space-y-6 max-w-5xl mx-auto">
        <div>
          <h1 className="text-2xl font-bold text-white">Data Sources</h1>
          <p className="text-slate-400 mt-1">
            Connect Meta Ads API directly, upload exported report files, or configure WhatsApp lead capture.
          </p>
        </div>

        <Tabs defaultValue="api" className="space-y-6">
          <TabsList className="bg-slate-800/60 border border-slate-700 p-1">
            <TabsTrigger value="api" className="data-[state=active]:bg-violet-600 data-[state=active]:text-white text-slate-400 gap-2">
              <Plug className="w-4 h-4" /> Meta Ads API
            </TabsTrigger>
            <TabsTrigger value="upload" className="data-[state=active]:bg-violet-600 data-[state=active]:text-white text-slate-400 gap-2">
              <Upload className="w-4 h-4" /> Upload Report
            </TabsTrigger>
            <TabsTrigger value="whatsapp" className="data-[state=active]:bg-violet-600 data-[state=active]:text-white text-slate-400 gap-2">
              <MessageCircle className="w-4 h-4" /> WhatsApp Leads
            </TabsTrigger>
          </TabsList>

          <TabsContent value="api" className="space-y-6">
            <Card className="bg-slate-900/50 border-slate-700/50">
              <CardHeader>
                <CardTitle className="text-white flex items-center gap-2">
                  <div className="w-8 h-8 rounded-lg bg-blue-500/10 border border-blue-500/20 flex items-center justify-center">
                    <svg viewBox="0 0 24 24" className="w-4 h-4 fill-blue-400">
                      <path d="M24 12.073c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.99 4.388 10.954 10.125 11.854v-8.385H7.078v-3.47h3.047V9.43c0-3.007 1.792-4.669 4.533-4.669 1.312 0 2.686.235 2.686.235v2.953H15.83c-1.491 0-1.956.925-1.956 1.874v2.25h3.328l-.532 3.47h-2.796v8.385C19.612 23.027 24 18.062 24 12.073z"/>
                    </svg>
                  </div>
                  Add Meta Ads Connection
                </CardTitle>
                <CardDescription className="text-slate-400">
                  Connect directly to Meta Graph API using your access token to automatically sync campaign data.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-6">
                {/* Primary: Facebook OAuth button */}
                <div className="space-y-3">
                  <p className="text-xs text-slate-400">
                    The fastest way to connect — log in with Facebook and select your ad account.
                    No token copying required.
                  </p>
                  <FacebookOAuthButton />
                </div>

                {/* Divider */}
                <div className="relative">
                  <div className="absolute inset-0 flex items-center">
                    <div className="w-full border-t border-slate-700" />
                  </div>
                  <div className="relative flex justify-center">
                    <span className="px-3 text-xs text-slate-500 bg-slate-900">or connect manually with a token</span>
                  </div>
                </div>

                {/* Fallback: manual token form */}
                <MetaConnectionForm onSaved={refetch} />
              </CardContent>
            </Card>
            <Card className="bg-slate-900/50 border-slate-700/50">
              <CardHeader>
                <CardTitle className="text-white text-base flex items-center gap-2">
                  <Wifi className="w-4 h-4 text-violet-400" />
                  Engine Integrations
                </CardTitle>
                <CardDescription className="text-slate-400">
                  Active integrations used by the analytics pipeline. Use Sync Now to run a full pipeline cycle.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <EngineIntegrationsPanel />
              </CardContent>
            </Card>
            <Card className="bg-slate-900/50 border-slate-700/50">
              <CardHeader>
                <CardTitle className="text-white text-base">Saved Connections</CardTitle>
              </CardHeader>
              <CardContent>
                <ConnectionsList />
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="upload">
            <Card className="bg-slate-900/50 border-slate-700/50">
              <CardHeader>
                <CardTitle className="text-white flex items-center gap-2">
                  <FileSpreadsheet className="w-5 h-5 text-violet-400" />
                  Upload Meta Ads Report
                </CardTitle>
                <CardDescription className="text-slate-400">
                  Upload a CSV or Excel file exported from Meta Ads Manager. The system auto-detects column mapping.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <FileUploadTab />
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="whatsapp">
            <WhatsAppTab />
          </TabsContent>
        </Tabs>
      </div>
    </DashboardLayout>
  );
}
