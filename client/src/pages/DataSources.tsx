import { useState, useRef } from "react";
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

// ─── Meta API Connection Form ─────────────────────────────────────────────────
function MetaConnectionForm({ onSaved }: { onSaved: () => void }) {
  const [name, setName] = useState("My Meta Ads Account");
  const [token, setToken] = useState("");
  const [accountId, setAccountId] = useState("");
  const [syncDays, setSyncDays] = useState("30");
  const [testResult, setTestResult] = useState<{ success: boolean; accountName?: string | null; error?: string | null } | null>(null);
  const [testing, setTesting] = useState(false);

  const testMutation = trpc.dataSources.testConnection.useMutation();
  const saveMutation = trpc.dataSources.saveConnection.useMutation();

  const handleTest = async () => {
    if (!token || !accountId) { toast.error("Enter Access Token and Ad Account ID first"); return; }
    setTesting(true);
    setTestResult(null);
    try {
      const res = await testMutation.mutateAsync({ accessToken: token, adAccountId: accountId });
      setTestResult(res);
      if (res.success) toast.success(`Connected to: ${res.accountName}`);
      else toast.error(res.error || "Connection failed");
    } finally { setTesting(false); }
  };

  const handleSave = async () => {
    if (!name || !token || !accountId) { toast.error("Fill in all required fields"); return; }
    try {
      await saveMutation.mutateAsync({ name, accessToken: token, adAccountId: accountId, syncDays: parseInt(syncDays) });
      toast.success("Connection saved successfully");
      setToken(""); setAccountId(""); setTestResult(null);
      onSaved();
    } catch (e: any) { toast.error(e.message || "Save failed"); }
  };

  return (
    <div className="space-y-6">
      <div className="flex gap-3 p-4 rounded-xl bg-blue-500/5 border border-blue-500/20">
        <Info className="w-5 h-5 text-blue-400 mt-0.5 shrink-0" />
        <div className="text-sm text-slate-300 space-y-1">
          <p className="font-medium text-blue-300">How to get your Meta Access Token</p>
          <ol className="list-decimal list-inside space-y-1 text-slate-400">
            <li>Go to <span className="text-blue-400 font-mono">developers.facebook.com</span> → Your App → Tools → Graph API Explorer</li>
            <li>Select your app, click <strong>Generate Access Token</strong>, grant <code>ads_read</code> permission</li>
            <li>For long-lived token: exchange via <code>oauth/access_token</code> endpoint (60-day expiry)</li>
            <li>Your Ad Account ID is in Meta Ads Manager URL: <code>act_XXXXXXXXXX</code></li>
          </ol>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
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
          <Input type="password" value={token} onChange={e => setToken(e.target.value)}
            placeholder="EAAxxxxxxxxxxxxxxx..."
            className="bg-slate-800/60 border-slate-700 text-white placeholder:text-slate-500 font-mono text-sm" />
        </div>
        <div className="space-y-2 md:col-span-2">
          <Label className="text-slate-300">Ad Account ID <span className="text-red-400">*</span></Label>
          <Input value={accountId} onChange={e => setAccountId(e.target.value)}
            placeholder="act_1234567890 or 1234567890"
            className="bg-slate-800/60 border-slate-700 text-white placeholder:text-slate-500 font-mono" />
        </div>
      </div>

      {testResult && (
        <div className={`flex items-center gap-3 p-3 rounded-lg border ${testResult.success ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-300' : 'bg-red-500/10 border-red-500/30 text-red-300'}`}>
          {testResult.success ? <CheckCircle2 className="w-5 h-5" /> : <XCircle className="w-5 h-5" />}
          <span className="text-sm font-medium">
            {testResult.success ? `✓ Connected to: ${testResult.accountName}` : `✗ ${testResult.error}`}
          </span>
        </div>
      )}

      <div className="flex gap-3">
        <Button variant="outline" onClick={handleTest} disabled={testing}
          className="border-slate-600 text-slate-300 hover:bg-slate-800">
          {testing ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Plug className="w-4 h-4 mr-2" />}
          Test Connection
        </Button>
        <Button onClick={handleSave} disabled={saveMutation.isPending}
          className="bg-violet-600 hover:bg-violet-500 text-white">
          {saveMutation.isPending ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : null}
          Save Connection
        </Button>
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
              <CardContent>
                <MetaConnectionForm onSaved={refetch} />
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
