"use client";

import { useState, useEffect } from "react";
import { downloadCSV } from "@/lib/api";
import { useUser } from "@/lib/user-context";
import { useEPOs, useStats, useSendFollowup, useBatchFollowup, useBackfillEPOAmounts, useSyncRecentGmail, useUpdateEPO } from "@/hooks/useEPOs";
import {
  AlertCircle,
  Plus,
  Send,
  Download,
  CheckCircle,
  ExternalLink,
  Loader2,
  Mail,
  Inbox,
  Flame,
  Clock,
  Filter,
  DollarSign,
} from "lucide-react";
import type { EPO } from "@/lib/api";
import { AddEPOModal } from "@/components/AddEPOModal";
import { EPODetailDrawer } from "@/components/EPODetailDrawer";
import { useRouter } from "next/navigation";


export default function EPOsPage() {
  const router = useRouter();
  const { supervisorId, activeUser, isBossView } = useUser();
  const [filter, setFilter] = useState<
    "all" | "pending" | "confirmed" | "denied" | "discount"
  >("all");
  const [search, setSearch] = useState("");
  const [followingUp, setFollowingUp] = useState<number | null>(null);
  const [followupResult, setFollowupResult] = useState<{
    id: number;
    msg: string;
    ok: boolean;
  } | null>(null);
  const [exporting, setExporting] = useState(false);
  const [batchSending, setBatchSending] = useState(false);
  const [batchResult, setBatchResult] = useState<string | null>(null);
  const [showAddModal, setShowAddModal] = useState(false);
  const [hasGmailConnected, setHasGmailConnected] = useState<boolean | null>(null);
  const [needsReconnect, setNeedsReconnect] = useState<boolean>(false);
  const [selectedEPO, setSelectedEPO] = useState<EPO | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const [bulkUpdating, setBulkUpdating] = useState(false);
  const [communityFilter, setCommunityFilter] = useState<string>("all");
  const [sortField, setSortField] = useState<"date" | "amount" | "age" | "community">("community");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");
  const [backfilling, setBackfilling] = useState(false);
  const [backfillResult, setBackfillResult] = useState<string | null>(null);
  const [syncing, setSyncing] = useState(false);

  // Fetch data with hooks
  const { data: epos = [], isLoading: loading, refetch: refetchEPOs } = useEPOs({ supervisorId });
  const { data: stats = { total: 0 } } = useStats(supervisorId);

  // Mutation hooks
  const sendFollowupMutation = useSendFollowup();
  const batchFollowupMutation = useBatchFollowup();
  const backfillMutation = useBackfillEPOAmounts();
  const syncMutation = useSyncRecentGmail();
  const updateMutation = useUpdateEPO();

  // Check if user has Gmail connected
  const checkGmail = async () => {
    try {
      const resp = await fetch("/api/email/status", {
        headers: { Authorization: `Bearer ${localStorage.getItem("epo_token") || ""}` },
      });
      if (resp.ok) {
        const data = await resp.json();
        setHasGmailConnected(data.active_connections > 0);
        setNeedsReconnect(!!data.needs_reconnect);
      }
    } catch {
      setHasGmailConnected(null);
    }
  };

  // Check if user has Gmail connected
  useEffect(() => {
    checkGmail();
  }, []);

  const handleSyncRecent = async () => {
    if (!confirm("Pull the last 14 days of emails from Gmail and process any missed EPOs? This may take 1-3 minutes.")) return;
    setSyncing(true);
    setBackfillResult(null);
    try {
      const result = await syncMutation.mutateAsync(14);
      setBackfillResult(
        `Synced: ${result.new_epos_created} new EPOs, ${result.replies_processed} replies, ` +
        `${result.skipped_already_ingested} already had (fetched ${result.total_fetched} total)`
      );
      refetchEPOs();
    } catch (err: any) {
      setBackfillResult(`Sync error: ${err.message || "Failed"}`);
    } finally {
      setSyncing(false);
    }
  };

  const handleBackfillAmounts = async () => {
    if (!confirm("Re-scan all EPOs with missing amounts? This reads stored emails + re-fetches from Gmail. Takes 1-3 minutes.")) return;
    setBackfilling(true);
    setBackfillResult(null);
    try {
      const result = await backfillMutation.mutateAsync();
      setBackfillResult(
        `Recovered ${result.updated_total} of ${result.total_checked} EPOs ` +
        `(regex: ${result.updated_regex}, AI: ${result.updated_ai}, Gmail refetch: ${result.updated_gmail_refetch})`
      );
      refetchEPOs();
    } catch (err: any) {
      setBackfillResult(`Error: ${err.message || "Failed"}`);
    } finally {
      setBackfilling(false);
    }
  };

  // Listen for command palette "new EPO" event
  useEffect(() => {
    const handler = () => setShowAddModal(true);
    window.addEventListener("open-add-epo", handler);
    return () => window.removeEventListener("open-add-epo", handler);
  }, []);

  const handleFollowup = async (epoId: number) => {
    setFollowingUp(epoId);
    setFollowupResult(null);
    try {
      const result = await sendFollowupMutation.mutateAsync(epoId);
      setFollowupResult({
        id: epoId,
        msg: result.message || "Follow-up sent",
        ok: result.success,
      });
      setTimeout(() => setFollowupResult(null), 4000);
    } catch (err: any) {
      setFollowupResult({
        id: epoId,
        msg: err.message || "Failed",
        ok: false,
      });
      setTimeout(() => setFollowupResult(null), 4000);
    } finally {
      setFollowingUp(null);
    }
  };

  const handleBatchFollowup = async () => {
    setBatchSending(true);
    setBatchResult(null);
    try {
      const result = await batchFollowupMutation.mutateAsync();
      setBatchResult(result.message || `Sent ${result.sent} follow-ups`);
      setTimeout(() => setBatchResult(null), 5000);
    } catch (err: any) {
      setBatchResult(err.message || "Batch follow-up failed");
      setTimeout(() => setBatchResult(null), 5000);
    } finally {
      setBatchSending(false);
    }
  };

  const handleExport = async () => {
    setExporting(true);
    try {
      await downloadCSV({
        status: filter !== "all" ? filter : undefined,
      });
    } catch {
      // Export failed
    } finally {
      setExporting(false);
    }
  };

  const toggleSelect = (id: number) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleSelectAll = () => {
    if (selectedIds.size === filteredEpos.length) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(filteredEpos.map((e) => e.id)));
    }
  };

  const handleBulkStatus = async (newStatus: string) => {
    setBulkUpdating(true);
    try {
      await Promise.all(
        Array.from(selectedIds).map((id) =>
          updateMutation.mutateAsync({ id, updates: { status: newStatus } as any })
        )
      );
      setSelectedIds(new Set());
      refetchEPOs();
    } catch (err) {
      console.error("Bulk update failed:", err);
    } finally {
      setBulkUpdating(false);
    }
  };

  // Get unique communities for filter dropdown
  const communities = Array.from(new Set(epos.map((e) => e.community).filter(Boolean))).sort();

  const filteredEpos = epos
    .filter((epo) => {
      if (filter !== "all" && epo.status !== filter) return false;
      if (communityFilter !== "all" && epo.community !== communityFilter) return false;
      if (
        search &&
        !(epo.vendor_name || "").toLowerCase().includes(search.toLowerCase()) &&
        !(epo.description || "").toLowerCase().includes(search.toLowerCase()) &&
        !(epo.community || "").toLowerCase().includes(search.toLowerCase()) &&
        !(epo.lot_number || "").toLowerCase().includes(search.toLowerCase())
      )
        return false;
      return true;
    })
    .sort((a, b) => {
      const dir = sortDir === "asc" ? 1 : -1;
      if (sortField === "amount") return ((a.amount || 0) - (b.amount || 0)) * dir;
      if (sortField === "age") return ((a.days_open || 0) - (b.days_open || 0)) * dir;
      if (sortField === "community") {
        // Primary: community alpha, Secondary: lot number numeric
        const ca = (a.community || "zzz").toLowerCase();
        const cb = (b.community || "zzz").toLowerCase();
        if (ca !== cb) return ca.localeCompare(cb) * dir;
        const la = parseInt(a.lot_number || "999") || 999;
        const lb = parseInt(b.lot_number || "999") || 999;
        if (la !== lb) return (la - lb) * dir;
        // Same numeric prefix — compare full string for "2b" vs "2c"
        return (a.lot_number || "").localeCompare(b.lot_number || "") * dir;
      }
      // date
      return (new Date(a.created_at).getTime() - new Date(b.created_at).getTime()) * dir;
    });

  const counts = {
    all: epos.length,
    pending: epos.filter((e) => e.status === "pending").length,
    confirmed: epos.filter((e) => e.status === "confirmed").length,
    denied: epos.filter((e) => e.status === "denied").length,
    discount: epos.filter((e) => e.status === "discount").length,
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case "confirmed":
        return "text-green bg-green-dim border-green-bdr";
      case "pending":
        return "text-amber bg-amber-dim border-amber-bdr";
      case "denied":
        return "text-red bg-red-dim border-red-bdr";
      case "discount":
        return "text-purple bg-purple";
      default:
        return "text-text2 bg-surface";
    }
  };

  const getAgeColor = (age: number) => {
    if (age >= 7) return "text-red";
    if (age >= 4) return "text-amber";
    return "text-text2";
  };

  const getUrgencyBadge = (epo: EPO) => {
    if (epo.status !== "pending") return null;
    const age = epo.days_open || 0;
    if (age >= 7) return { label: "Overdue", color: "bg-red/15 text-red border-red/30", icon: Flame };
    if (age >= 4) return { label: "Follow up", color: "bg-amber/15 text-amber border-amber/30", icon: Clock };
    return null;
  };

  const needsFollowupCount = epos.filter(
    (e) => e.status === "pending" && (e.days_open || 0) >= 4
  ).length;

  const handleEPOClick = (epo: EPO) => {
    // Always open the drawer — works for single-lot and multi-lot EPOs alike
    setSelectedEPO(epo);
    setDrawerOpen(true);
  };

  return (
    <div className="p-4 md:p-8 space-y-4 md:space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl md:text-3xl font-semibold mb-1">EPOs</h1>
          <p className="text-text2 text-sm">
            {isBossView
              ? "All extra purchase orders"
              : `${activeUser?.full_name} — ${(activeUser?.communities ?? []).join(
                  ", "
                )}`}
          </p>
        </div>
        <div className="flex gap-2 sm:gap-3">
          <button
            onClick={handleSyncRecent}
            disabled={syncing}
            className="btn-secondary flex items-center gap-2 text-sm"
            title="Pull last 14 days of emails from Gmail"
          >
            <DollarSign size={16} />
            <span className="hidden sm:inline">{syncing ? "Syncing..." : "Sync Recent"}</span>
          </button>
          <button
            onClick={handleBackfillAmounts}
            disabled={backfilling}
            className="btn-secondary flex items-center gap-2 text-sm"
            title="Re-scan stored emails to recover missing EPO amounts"
          >
            <DollarSign size={16} />
            <span className="hidden sm:inline">{backfilling ? "Scanning..." : "Recover Amounts"}</span>
          </button>
          <button
            onClick={handleExport}
            disabled={exporting}
            className="btn-secondary flex items-center gap-2 text-sm"
          >
            <Download size={16} />
            <span className="hidden sm:inline">{exporting ? "Exporting..." : "Export CSV"}</span>
          </button>
          <button
            onClick={() => setShowAddModal(true)}
            className="btn-primary flex items-center gap-2 text-sm"
          >
            <Plus size={18} />
            Add EPO
          </button>
        </div>
      </div>

      {backfillResult && (
        <div className="rounded-lg border border-green-bdr bg-green-dim p-3 text-sm text-green whitespace-pre-wrap break-all font-mono max-h-60 overflow-y-auto">
          {backfillResult}
        </div>
      )}

      {/* Filter Tabs */}
      <div className="flex gap-2 md:gap-4 border-b border-card-border pb-4 overflow-x-auto">
        {(
          ["all", "pending", "confirmed", "denied", "discount"] as const
        ).map((tab) => (
          <button
            key={tab}
            onClick={() => setFilter(tab)}
            className={`px-3 py-2 text-sm font-medium transition-colors relative ${
              filter === tab
                ? "text-text1"
                : "text-text2 hover:text-text1"
            }`}
          >
            {tab.charAt(0).toUpperCase() + tab.slice(1)}
            <span className="ml-2 font-mono text-xs bg-surface px-2 py-1 rounded">
              {counts[tab]}
            </span>
            {filter === tab && (
              <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-green"></div>
            )}
          </button>
        ))}
      </div>

      {/* Sync Status Banner — shows company-level Gmail connection */}
      {needsReconnect ? (
        <div className="card p-4 bg-red-dim border-red-bdr flex items-center gap-3">
          <AlertCircle size={18} className="text-red flex-shrink-0" />
          <span className="text-sm text-text1">
            Your Gmail connection has expired and can't read new emails.{" "}
            <button onClick={() => router.push("/integrations")} className="text-emerald-400 underline font-semibold">
              Reconnect Gmail
            </button>{" "}
            to resume automatic EPO ingestion and backfill.
          </span>
        </div>
      ) : hasGmailConnected === false ? (
        <div className="card p-4 bg-amber-dim border-amber-bdr flex items-center gap-3">
          <Mail size={18} className="text-amber flex-shrink-0" />
          <span className="text-sm text-text1">
            No email connected yet. Ask your manager to set up Gmail integration in{" "}
            <button onClick={() => router.push("/integrations")} className="text-emerald-400 underline">
              Integrations
            </button>.
          </span>
        </div>
      ) : hasGmailConnected ? (
        <div className="card p-4 bg-green-dim border-green-bdr flex items-center gap-3">
          <div className="w-2 h-2 rounded-full bg-green"></div>
          <span className="text-sm text-text2">Email sync active</span>
        </div>
      ) : null}

      {/* Search + Community Filter */}
      <div className="flex gap-3 flex-wrap">
        <input
          type="text"
          placeholder="Search builder, community, lot, or description..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="flex-1 min-w-[200px] px-4 py-2 bg-surface border border-card-border rounded-lg text-text1 placeholder-text3 focus:outline-none focus:border-border-lt"
        />
        <div className="relative">
          <select
            value={communityFilter}
            onChange={(e) => setCommunityFilter(e.target.value)}
            className="appearance-none px-4 py-2 pr-8 bg-surface border border-card-border rounded-lg text-text2 text-sm focus:outline-none focus:border-border-lt cursor-pointer"
          >
            <option value="all">All Communities</option>
            {communities.map((c) => (
              <option key={c} value={c}>{c}</option>
            ))}
          </select>
          <Filter size={14} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-text3 pointer-events-none" />
        </div>
        <select
          value={sortField}
          onChange={(e) => {
            const v = e.target.value as typeof sortField;
            setSortField(v);
            setSortDir(v === "community" ? "asc" : "desc");
          }}
          className="appearance-none px-4 py-2 pr-8 bg-surface border border-card-border rounded-lg text-text2 text-sm focus:outline-none focus:border-border-lt cursor-pointer"
        >
          <option value="community">Sort: Community &amp; Lot</option>
          <option value="date">Sort: Newest First</option>
          <option value="amount">Sort: Amount</option>
          <option value="age">Sort: Days Open</option>
        </select>
      </div>

      {/* Bulk Action Bar */}
      {selectedIds.size > 0 && (
        <div className="card p-3 bg-blue/5 border-blue/20 flex items-center gap-3 flex-wrap">
          <span className="text-sm text-text1 font-medium">
            {selectedIds.size} selected
          </span>
          <div className="flex gap-2">
            <button
              onClick={() => handleBulkStatus("confirmed")}
              disabled={bulkUpdating}
              className="px-3 py-1.5 text-xs font-medium rounded-lg bg-emerald-400/10 text-emerald-400 border border-emerald-400/30 hover:bg-emerald-400/20 transition-colors"
            >
              <CheckCircle size={12} className="inline mr-1" />
              Confirm
            </button>
            <button
              onClick={() => handleBulkStatus("denied")}
              disabled={bulkUpdating}
              className="px-3 py-1.5 text-xs font-medium rounded-lg bg-red-400/10 text-red-400 border border-red-400/30 hover:bg-red-400/20 transition-colors"
            >
              Deny
            </button>
            <button
              onClick={() => handleBulkStatus("discount")}
              disabled={bulkUpdating}
              className="px-3 py-1.5 text-xs font-medium rounded-lg bg-purple-400/10 text-purple-400 border border-purple-400/30 hover:bg-purple-400/20 transition-colors"
            >
              Discount
            </button>
          </div>
          <button
            onClick={() => setSelectedIds(new Set())}
            className="ml-auto text-xs text-text3 hover:text-text1 transition-colors"
          >
            Clear selection
          </button>
        </div>
      )}

      {/* Desktop Table — hidden on mobile */}
      {loading ? (
        <div className="card overflow-hidden hidden md:block">
          <div className="p-6 space-y-4">
            {[1, 2, 3, 4, 5].map((i) => (
              <div key={i} className="flex gap-6 animate-pulse">
                <div className="h-4 bg-surface rounded w-28"></div>
                <div className="h-4 bg-surface rounded w-24"></div>
                <div className="h-4 bg-surface rounded w-12"></div>
                <div className="h-4 bg-surface rounded flex-1"></div>
                <div className="h-4 bg-surface rounded w-16"></div>
                <div className="h-4 bg-surface rounded w-20"></div>
              </div>
            ))}
          </div>
        </div>
      ) : (
      <div className="card overflow-hidden hidden md:block">
        <table className="w-full">
          <thead className="border-b border-card-border">
            <tr>
              <th className="px-3 py-4 w-10">
                <input
                  type="checkbox"
                  checked={selectedIds.size === filteredEpos.length && filteredEpos.length > 0}
                  onChange={toggleSelectAll}
                  className="w-4 h-4 rounded border-card-border bg-surface accent-emerald-500"
                />
              </th>
              <th className="px-6 py-4 text-left label">Builder</th>
              <th className="px-6 py-4 text-left label">Community</th>
              <th className="px-6 py-4 text-left label">Lot</th>
              <th className="px-4 py-4 text-left label">Description</th>
              <th className="px-4 py-4 text-left label">Amount</th>
              <th className="px-4 py-4 text-left label">Status</th>
              <th className="px-4 py-4 text-left label">Age</th>
              <th className="px-4 py-4 text-left label">Actions</th>
            </tr>
          </thead>
          <tbody>
            {filteredEpos.map((epo) => (
              <tr
                key={epo.id}
                className="border-b border-card-border hover:bg-surface/50 transition-colors cursor-pointer"
                onClick={() => handleEPOClick(epo)}
              >
                <td className="px-3 py-4" onClick={(e) => e.stopPropagation()}>
                  <input
                    type="checkbox"
                    checked={selectedIds.has(epo.id)}
                    onChange={() => toggleSelect(epo.id)}
                    className="w-4 h-4 rounded border-card-border bg-surface accent-emerald-500"
                  />
                </td>
                <td className="px-6 py-4 text-text1">{epo.vendor_name}</td>
                <td className="px-6 py-4 text-text1">{epo.community}</td>
                <td className="px-6 py-4">
                  <span className="font-mono bg-blue/15 text-blue px-2 py-1 rounded text-sm">
                    {epo.lot_number}
                  </span>
                </td>
                <td className="px-4 py-4 text-text2 text-sm max-w-[200px] truncate">
                  {epo.description}
                </td>
                <td className="px-4 py-4 font-mono">
                  {epo.amount != null ? `$${epo.amount.toLocaleString()}` : "—"}
                </td>
                <td className="px-4 py-4">
                  <span
                    className={`inline-flex items-center gap-2 px-3 py-1 rounded-lg text-xs font-medium border ${getStatusColor(
                      epo.status
                    )}`}
                  >
                    <div className="w-1.5 h-1.5 rounded-full bg-current"></div>
                    {epo.status.charAt(0).toUpperCase() + epo.status.slice(1)}
                  </span>
                </td>
                <td className="px-4 py-4">
                  <div className="flex items-center gap-2">
                    <span className={`font-mono text-sm ${getAgeColor(epo.days_open || 0)}`}>
                      {epo.days_open || 0}d
                    </span>
                    {(() => {
                      const badge = getUrgencyBadge(epo);
                      if (!badge) return null;
                      const Icon = badge.icon;
                      return (
                        <span className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium border ${badge.color}`}>
                          <Icon size={10} />
                          {badge.label}
                        </span>
                      );
                    })()}
                  </div>
                </td>
                <td className="px-4 py-4">
                  <div className="flex items-center gap-2">
                    {epo.status === "pending" &&
                      (epo.days_open || 0) >= 4 && (
                        <button
                          onClick={() => handleFollowup(epo.id)}
                          disabled={followingUp === epo.id}
                          className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-amber bg-amber-dim border border-amber-bdr rounded-lg hover:bg-amber/20 transition-colors disabled:opacity-50"
                          title="Send follow-up email to builder"
                        >
                          {followingUp === epo.id ? (
                            <Loader2 size={12} className="animate-spin" />
                          ) : (
                            <Send size={12} />
                          )}
                          Follow up
                        </button>
                      )}
                    {followupResult?.id === epo.id && (
                      <span
                        className={`text-xs ${
                          followupResult.ok ? "text-green" : "text-red"
                        }`}
                      >
                        {followupResult.ok ? (
                          <CheckCircle size={14} />
                        ) : (
                          followupResult.msg
                        )}
                      </span>
                    )}
                    {epo.status === "confirmed" &&
                      epo.confirmation_number && (
                        <span className="text-xs text-green font-mono">
                          {epo.confirmation_number}
                        </span>
                      )}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {filteredEpos.length === 0 && (
          <div className="px-6 py-16 text-center">
            <div className="w-16 h-16 mx-auto mb-4 rounded-full bg-surface flex items-center justify-center">
              <Inbox size={24} className="text-text3" />
            </div>
            <p className="text-text1 font-medium mb-1">No EPOs found</p>
            <p className="text-text3 text-sm mb-4">
              {filter !== "all"
                ? `No ${filter} EPOs match your search.`
                : search
                ? "Try a different search term."
                : "EPOs will appear here as emails come in, or add one manually."}
            </p>
            {epos.length === 0 && (
              <button
                onClick={() => setShowAddModal(true)}
                className="btn-primary text-sm inline-flex items-center gap-2"
              >
                <Plus size={16} />
                Add Your First EPO
              </button>
            )}
          </div>
        )}
      </div>
      )}

      {/* Mobile Cards — hidden on desktop */}
      {loading ? (
        <div className="md:hidden space-y-3">
          {[1, 2, 3].map((i) => (
            <div key={i} className="card p-4 animate-pulse space-y-3">
              <div className="flex justify-between">
                <div className="h-4 bg-surface rounded w-32"></div>
                <div className="h-6 bg-surface rounded w-20"></div>
              </div>
              <div className="flex gap-3">
                <div className="h-4 bg-surface rounded w-16"></div>
                <div className="h-4 bg-surface rounded w-16"></div>
              </div>
              <div className="h-4 bg-surface rounded w-full"></div>
            </div>
          ))}
        </div>
      ) : (
      <div className="md:hidden space-y-3">
        {filteredEpos.map((epo) => (
          <div key={epo.id} className="card p-4 space-y-3 cursor-pointer" onClick={() => handleEPOClick(epo)}>
            {/* Top row: builder + status */}
            <div className="flex items-start justify-between">
              <div>
                <p className="text-text1 font-medium">{epo.vendor_name || "Unknown"}</p>
                <p className="text-text3 text-sm">{epo.community || "—"}</p>
              </div>
              <span
                className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-medium border ${getStatusColor(
                  epo.status
                )}`}
              >
                <div className="w-1.5 h-1.5 rounded-full bg-current"></div>
                {epo.status.charAt(0).toUpperCase() + epo.status.slice(1)}
              </span>
            </div>

            {/* Details row */}
            <div className="flex items-center gap-3 text-sm">
              <span className="font-mono bg-blue/15 text-blue px-2 py-0.5 rounded text-xs">
                Lot {epo.lot_number || "—"}
              </span>
              <span className="font-mono text-text1">
                {epo.amount != null ? `$${epo.amount.toLocaleString()}` : "—"}
              </span>
              <span className={`font-mono text-xs ${getAgeColor(epo.days_open || 0)}`}>
                {epo.days_open || 0}d ago
              </span>
            </div>

            {/* Description */}
            {epo.description && (
              <p className="text-text2 text-sm line-clamp-2">{epo.description}</p>
            )}

            {/* Actions */}
            {epo.status === "pending" && (epo.days_open || 0) >= 4 && (
              <button
                onClick={() => handleFollowup(epo.id)}
                disabled={followingUp === epo.id}
                className="w-full inline-flex items-center justify-center gap-1.5 px-3 py-2 text-xs font-medium text-amber bg-amber-dim border border-amber-bdr rounded-lg hover:bg-amber/20 transition-colors disabled:opacity-50"
              >
                {followingUp === epo.id ? (
                  <Loader2 size={12} className="animate-spin" />
                ) : (
                  <Send size={12} />
                )}
                Follow up
              </button>
            )}
            {followupResult?.id === epo.id && (
              <span className={`text-xs ${followupResult.ok ? "text-green" : "text-red"}`}>
                {followupResult.ok ? "Sent!" : followupResult.msg}
              </span>
            )}
          </div>
        ))}
        {filteredEpos.length === 0 && (
          <div className="py-16 text-center">
            <div className="w-16 h-16 mx-auto mb-4 rounded-full bg-surface flex items-center justify-center">
              <Inbox size={24} className="text-text3" />
            </div>
            <p className="text-text1 font-medium mb-1">No EPOs found</p>
            <p className="text-text3 text-sm mb-4">
              {filter !== "all"
                ? `No ${filter} EPOs.`
                : "EPOs will appear here as emails arrive."}
            </p>
            {epos.length === 0 && (
              <button
                onClick={() => setShowAddModal(true)}
                className="btn-primary text-sm inline-flex items-center gap-2"
              >
                <Plus size={16} />
                Add EPO
              </button>
            )}
          </div>
        )}
      </div>
      )}

      {/* Add EPO Modal */}
      <AddEPOModal
        open={showAddModal}
        onClose={() => setShowAddModal(false)}
        onCreated={() => refetchEPOs()}
      />

      {/* EPO Detail Drawer */}
      <EPODetailDrawer
        epo={selectedEPO}
        open={drawerOpen}
        onClose={() => { setDrawerOpen(false); setSelectedEPO(null); }}
        onUpdated={() => { refetchEPOs(); }}
      />


      {/* Follow-up Alert with Batch Action */}
      {needsFollowupCount > 0 && (
        <div className="card p-4 md:p-6 border-amber-bdr bg-amber-dim">
          <div className="flex flex-col sm:flex-row items-start gap-4 sm:justify-between">
            <div className="flex items-start gap-3">
              <AlertCircle
                className="text-amber flex-shrink-0 mt-0.5"
                size={20}
              />
              <div>
                <h3 className="font-semibold text-text1 mb-2">
                  Action Required
                </h3>
                <p className="text-text2 text-sm mb-1">
                  You have {needsFollowupCount} pending EPOs that need
                  follow-up (4+ days without confirmation).
                </p>
                {batchResult && (
                  <p className="text-sm text-amber mt-1">{batchResult}</p>
                )}
              </div>
            </div>
            <button
              onClick={handleBatchFollowup}
              disabled={batchSending}
              className="btn-primary text-sm flex items-center gap-2 flex-shrink-0"
            >
              <Send size={14} />
              {batchSending ? "Sending..." : "Follow Up All"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
