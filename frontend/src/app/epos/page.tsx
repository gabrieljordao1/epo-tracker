"use client";

import { useState, useEffect } from "react";
import { getEPOs, getStats, sendFollowup, downloadCSV, batchFollowup } from "@/lib/api";
import { useUser } from "@/lib/user-context";
import {
  AlertCircle,
  Plus,
  Send,
  Download,
  CheckCircle,
  ExternalLink,
  Loader2,
  Mail,
} from "lucide-react";
import type { EPO } from "@/lib/api";
import { AddEPOModal } from "@/components/AddEPOModal";
import { useRouter } from "next/navigation";

export default function EPOsPage() {
  const router = useRouter();
  const { supervisorId, activeUser, isBossView } = useUser();
  const [epos, setEpos] = useState<EPO[]>([]);
  const [filter, setFilter] = useState<
    "all" | "pending" | "confirmed" | "denied" | "discount"
  >("all");
  const [search, setSearch] = useState("");
  const [stats, setStats] = useState({ total: 0 });
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
  const [gmailBannerDismissed, setGmailBannerDismissed] = useState(false);

  const loadData = async () => {
    const [eposData, statsData] = await Promise.all([
      getEPOs(undefined, supervisorId),
      getStats(supervisorId),
    ]);
    setEpos(eposData);
    setStats(statsData);
  };

  // Check if user has Gmail connected
  useEffect(() => {
    const checkGmail = async () => {
      try {
        const resp = await fetch("/api/email/status", {
          headers: { Authorization: `Bearer ${localStorage.getItem("epo_token") || ""}` },
        });
        if (resp.ok) {
          const data = await resp.json();
          setHasGmailConnected(data.active_connections > 0);
        }
      } catch {
        setHasGmailConnected(null);
      }
    };
    checkGmail();
  }, []);

  useEffect(() => {
    loadData();
  }, [supervisorId]);

  const handleFollowup = async (epoId: number) => {
    setFollowingUp(epoId);
    setFollowupResult(null);
    try {
      const result = await sendFollowup(epoId);
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
      const result = await batchFollowup();
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

  const filteredEpos = epos.filter((epo) => {
    if (filter !== "all" && epo.status !== filter) return false;
    if (
      search &&
      !(epo.vendor_name || "").toLowerCase().includes(search.toLowerCase()) &&
      !(epo.description || "").toLowerCase().includes(search.toLowerCase())
    )
      return false;
    return true;
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

  const needsFollowupCount = epos.filter(
    (e) => e.status === "pending" && (e.days_open || 0) >= 4
  ).length;

  return (
    <div className="p-4 md:p-8 space-y-4 md:space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl md:text-3xl font-semibold mb-1">EPOs</h1>
          <p className="text-text2 text-sm">
            {isBossView
              ? "All extra purchase orders"
              : `${activeUser?.full_name} — ${activeUser?.communities.join(
                  ", "
                )}`}
          </p>
        </div>
        <div className="flex gap-2 sm:gap-3">
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

      {/* Sync Status / Gmail Connect Banner */}
      {hasGmailConnected === false && !gmailBannerDismissed ? (
        <div className="card p-4 bg-amber-dim border-amber-bdr flex items-center gap-3">
          <Mail size={18} className="text-amber flex-shrink-0" />
          <div className="flex-1">
            <span className="text-sm text-text1 font-medium">Connect your Gmail to auto-sync EPOs</span>
            <p className="text-xs text-text3 mt-0.5">
              Link your @stancilservices.com email so Onyx captures EPOs you send automatically.
            </p>
          </div>
          <button
            onClick={() => router.push("/integrations")}
            className="btn-primary text-sm px-4 py-2 flex items-center gap-2 flex-shrink-0"
          >
            <Mail size={14} />
            Connect Gmail
          </button>
          <button
            onClick={() => setGmailBannerDismissed(true)}
            className="text-text3 hover:text-text1 text-xs ml-1 flex-shrink-0"
          >
            Later
          </button>
        </div>
      ) : hasGmailConnected ? (
        <div className="card p-4 bg-green-dim border-green-bdr flex items-center gap-3">
          <div className="w-2 h-2 rounded-full bg-green"></div>
          <span className="text-sm text-text2">Email sync active</span>
        </div>
      ) : null}

      {/* Search */}
      <div className="flex gap-4">
        <input
          type="text"
          placeholder="Search builders or description..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="flex-1 px-4 py-2 bg-surface border border-card-border rounded-lg text-text1 placeholder-text3 focus:outline-none focus:border-border-lt"
        />
      </div>

      {/* Desktop Table — hidden on mobile */}
      <div className="card overflow-hidden hidden md:block">
        <table className="w-full">
          <thead className="border-b border-card-border">
            <tr>
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
                className="border-b border-card-border hover:bg-surface/50 transition-colors"
              >
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
                <td
                  className={`px-4 py-4 font-mono text-sm ${getAgeColor(
                    epo.days_open || 0
                  )}`}
                >
                  {epo.days_open || 0}d
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
          <div className="px-6 py-12 text-center">
            <p className="text-text3">No EPOs found</p>
          </div>
        )}
      </div>

      {/* Mobile Cards — hidden on desktop */}
      <div className="md:hidden space-y-3">
        {filteredEpos.map((epo) => (
          <div key={epo.id} className="card p-4 space-y-3">
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
          <div className="py-12 text-center">
            <p className="text-text3">No EPOs found</p>
          </div>
        )}
      </div>

      {/* Add EPO Modal */}
      <AddEPOModal
        open={showAddModal}
        onClose={() => setShowAddModal(false)}
        onCreated={() => loadData()}
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
