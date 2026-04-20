"use client";

import { useState, useEffect, Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  CheckCircle,
  AlertTriangle,
  Clock,
  XCircle,
  Building2,
  MapPin,
  DollarSign,
  Hash,
  Send,
} from "lucide-react";
import { OnyxLogo } from "@/components/OnyxLogo";
import {
  getVendorEPO,
  vendorConfirmEPO,
  vendorDisputeEPO,
  getVendorHistory,
} from "@/lib/api";
import type { VendorEPO, VendorHistory } from "@/lib/api";

export default function VendorPortalPage() {
  return (
    <Suspense fallback={<div className="min-h-screen bg-[#0a0a0a] flex items-center justify-center"><p className="text-white/50">Loading...</p></div>}>
      <VendorContent />
    </Suspense>
  );
}

function VendorContent() {
  const searchParams = useSearchParams();
  const token = searchParams.get("token") || "";
  const queryClient = useQueryClient();

  const [confirmNumber, setConfirmNumber] = useState("");
  const [disputeNote, setDisputeNote] = useState("");
  const [showConfirm, setShowConfirm] = useState(false);
  const [showDispute, setShowDispute] = useState(false);
  const [actionResult, setActionResult] = useState<{
    type: "success" | "error";
    message: string;
  } | null>(null);

  // React Query hooks for vendor data
  const epoQuery = useQuery({
    queryKey: ["vendorEPO", token],
    queryFn: () => (token ? getVendorEPO(token) : Promise.reject(new Error("No token"))),
    enabled: !!token,
  });

  const historyQuery = useQuery({
    queryKey: ["vendorHistory", token],
    queryFn: () => (token ? getVendorHistory(token) : Promise.reject(new Error("No token"))),
    enabled: !!token,
  });

  // Mutations
  const confirmMutation = useMutation({
    mutationFn: () => vendorConfirmEPO(token, confirmNumber || undefined),
    onSuccess: (result) => {
      setActionResult({ type: "success", message: result.message });
      setShowConfirm(false);
      queryClient.invalidateQueries({ queryKey: ["vendorEPO", token] });
      queryClient.invalidateQueries({ queryKey: ["vendorHistory", token] });
    },
    onError: (err: any) => {
      setActionResult({ type: "error", message: err.message });
    },
  });

  const disputeMutation = useMutation({
    mutationFn: () => vendorDisputeEPO(token, disputeNote || undefined),
    onSuccess: (result) => {
      setActionResult({ type: "success", message: result.message });
      setShowDispute(false);
      queryClient.invalidateQueries({ queryKey: ["vendorEPO", token] });
      queryClient.invalidateQueries({ queryKey: ["vendorHistory", token] });
    },
    onError: (err: any) => {
      setActionResult({ type: "error", message: err.message });
    },
  });

  const data = epoQuery.data || null;
  const history = historyQuery.data || null;
  const loading = epoQuery.isLoading;
  const error = !token
    ? "No access token provided. Please use the link from your email."
    : epoQuery.error?.message || "";

  const handleConfirm = async () => {
    confirmMutation.mutate();
  };

  const handleDispute = async () => {
    disputeMutation.mutate();
  };

  const getStatusBadge = (status: string) => {
    switch (status) {
      case "confirmed":
        return (
          <span className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-emerald-500/15 text-emerald-400 border border-emerald-500/20 text-sm font-medium">
            <CheckCircle size={16} /> Confirmed
          </span>
        );
      case "pending":
        return (
          <span className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-amber-500/15 text-amber-400 border border-amber-500/20 text-sm font-medium">
            <Clock size={16} /> Pending Confirmation
          </span>
        );
      case "denied":
        return (
          <span className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-red-500/15 text-red-400 border border-red-500/20 text-sm font-medium">
            <XCircle size={16} /> Denied
          </span>
        );
      case "discount":
        return (
          <span className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-purple-500/15 text-purple-400 border border-purple-500/20 text-sm font-medium">
            <DollarSign size={16} /> Discount Applied
          </span>
        );
      default:
        return null;
    }
  };

  // ─── Loading / Error States ─────────────────────
  if (loading) {
    return (
      <div className="min-h-screen bg-[#0a0a0a] flex items-center justify-center">
        <div className="text-center">
          <div className="w-12 h-12 border-2 border-emerald-400/30 border-t-emerald-400 rounded-full animate-spin mx-auto mb-4" />
          <p className="text-white/50">Loading EPO details...</p>
        </div>
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="min-h-screen bg-[#0a0a0a] flex items-center justify-center p-6">
        <div className="max-w-md w-full text-center">
          <div className="w-16 h-16 rounded-full bg-red-500/15 border border-red-500/20 flex items-center justify-center mx-auto mb-6">
            <AlertTriangle className="text-red-400" size={28} />
          </div>
          <h1 className="text-xl font-semibold text-white mb-2">
            Unable to Load EPO
          </h1>
          <p className="text-white/50">
            {error || "This link may have expired or is invalid. Please contact the company that sent you this link."}
          </p>
        </div>
      </div>
    );
  }

  const epo = data.epo;

  // ─── Main Render ─────────────────────────────────
  return (
    <div className="min-h-screen bg-[#0a0a0a]">
      {/* Header */}
      <div className="border-b border-white/8 bg-white/[0.03]">
        <div className="max-w-2xl mx-auto px-6 py-6 flex items-center gap-3">
          <OnyxLogo size={28} />
          <div>
            <h1 className="text-lg font-semibold text-white">Onyx</h1>
            <p className="text-xs text-white/40">Builder Portal</p>
          </div>
        </div>
      </div>

      <div className="max-w-2xl mx-auto px-6 py-8 space-y-6">
        {/* Action Result Banner */}
        {actionResult && (
          <div
            className={`p-4 rounded-xl border ${
              actionResult.type === "success"
                ? "bg-emerald-500/10 border-emerald-500/20 text-emerald-400"
                : "bg-red-500/10 border-red-500/20 text-red-400"
            }`}
          >
            <div className="flex items-center gap-3">
              {actionResult.type === "success" ? (
                <CheckCircle size={20} />
              ) : (
                <AlertTriangle size={20} />
              )}
              <p className="text-sm font-medium">{actionResult.message}</p>
            </div>
          </div>
        )}

        {/* Company & Status */}
        <div className="rounded-xl border border-white/8 bg-white/[0.04] p-6">
          <div className="flex items-start justify-between mb-6">
            <div className="flex items-center gap-3">
              <Building2 className="text-white/30" size={20} />
              <div>
                <p className="text-xs text-white/30 uppercase tracking-wider font-medium">From</p>
                <p className="text-white font-semibold">{data.company_name}</p>
              </div>
            </div>
            {getStatusBadge(epo.status)}
          </div>

          <div className="grid grid-cols-2 gap-6">
            <div className="flex items-start gap-3">
              <MapPin className="text-white/20 mt-0.5" size={16} />
              <div>
                <p className="text-xs text-white/30 uppercase tracking-wider font-medium mb-1">Community</p>
                <p className="text-white">{epo.community || "—"}</p>
              </div>
            </div>
            <div className="flex items-start gap-3">
              <Hash className="text-white/20 mt-0.5" size={16} />
              <div>
                <p className="text-xs text-white/30 uppercase tracking-wider font-medium mb-1">Lot Number</p>
                <p className="text-white font-mono">{epo.lot_number || "—"}</p>
              </div>
            </div>
            <div className="flex items-start gap-3">
              <DollarSign className="text-white/20 mt-0.5" size={16} />
              <div>
                <p className="text-xs text-white/30 uppercase tracking-wider font-medium mb-1">Amount</p>
                <p className="text-white font-mono text-lg">
                  ${epo.amount?.toLocaleString(undefined, { minimumFractionDigits: 2 }) || "0.00"}
                </p>
              </div>
            </div>
            <div className="flex items-start gap-3">
              <Clock className="text-white/20 mt-0.5" size={16} />
              <div>
                <p className="text-xs text-white/30 uppercase tracking-wider font-medium mb-1">Days Open</p>
                <p className={`font-mono ${(epo.days_open || 0) >= 7 ? "text-red-400" : (epo.days_open || 0) >= 4 ? "text-amber-400" : "text-white"}`}>
                  {epo.days_open || 0} days
                </p>
              </div>
            </div>
          </div>
        </div>

        {/* Description */}
        <div className="rounded-xl border border-white/8 bg-white/[0.04] p-6">
          <p className="text-xs text-white/30 uppercase tracking-wider font-medium mb-3">Description</p>
          <p className="text-white/80 leading-relaxed">{epo.description || "No description provided"}</p>

          {epo.confirmation_number && (
            <div className="mt-4 pt-4 border-t border-white/8">
              <p className="text-xs text-white/30 uppercase tracking-wider font-medium mb-1">Confirmation #</p>
              <p className="text-emerald-400 font-mono font-semibold">{epo.confirmation_number}</p>
            </div>
          )}
        </div>

        {/* Action Buttons (only for pending) */}
        {data.can_confirm && !showConfirm && !showDispute && (
          <div className="flex gap-3">
            <button
              onClick={() => setShowConfirm(true)}
              className="flex-1 py-3.5 bg-emerald-500 hover:bg-emerald-400 text-white font-semibold rounded-xl transition-colors flex items-center justify-center gap-2"
            >
              <CheckCircle size={18} />
              Confirm EPO
            </button>
            <button
              onClick={() => setShowDispute(true)}
              className="flex-1 py-3.5 border border-white/10 hover:bg-white/5 text-white/70 font-medium rounded-xl transition-colors flex items-center justify-center gap-2"
            >
              <AlertTriangle size={18} />
              Dispute
            </button>
          </div>
        )}

        {/* Confirm Form */}
        {showConfirm && (
          <div className="rounded-xl border border-emerald-500/20 bg-emerald-500/5 p-6 space-y-4">
            <h3 className="font-semibold text-white">Confirm this EPO</h3>
            <div>
              <label className="text-xs text-white/30 uppercase tracking-wider font-medium block mb-2">
                PO / Confirmation Number (optional)
              </label>
              <input
                type="text"
                value={confirmNumber}
                onChange={(e) => setConfirmNumber(e.target.value)}
                placeholder="e.g. PO-4421"
                className="w-full px-4 py-2.5 bg-white/5 border border-white/10 rounded-lg text-white placeholder-white/20 focus:outline-none focus:border-emerald-500/40"
              />
            </div>
            <div className="flex gap-3">
              <button
                onClick={handleConfirm}
                disabled={confirmMutation.isPending}
                className="flex-1 py-3 bg-emerald-500 hover:bg-emerald-400 text-white font-semibold rounded-lg transition-colors disabled:opacity-50"
              >
                {confirmMutation.isPending ? "Confirming..." : "Submit Confirmation"}
              </button>
              <button
                onClick={() => setShowConfirm(false)}
                className="px-6 py-3 border border-white/10 text-white/50 rounded-lg hover:bg-white/5"
              >
                Cancel
              </button>
            </div>
          </div>
        )}

        {/* Dispute Form */}
        {showDispute && (
          <div className="rounded-xl border border-amber-500/20 bg-amber-500/5 p-6 space-y-4">
            <h3 className="font-semibold text-white">Dispute this EPO</h3>
            <div>
              <label className="text-xs text-white/30 uppercase tracking-wider font-medium block mb-2">
                Reason for dispute
              </label>
              <textarea
                value={disputeNote}
                onChange={(e) => setDisputeNote(e.target.value)}
                placeholder="Please describe why you're disputing this EPO..."
                rows={3}
                className="w-full px-4 py-2.5 bg-white/5 border border-white/10 rounded-lg text-white placeholder-white/20 focus:outline-none focus:border-amber-500/40 resize-none"
              />
            </div>
            <div className="flex gap-3">
              <button
                onClick={handleDispute}
                disabled={disputeMutation.isPending}
                className="flex-1 py-3 bg-amber-500 hover:bg-amber-400 text-black font-semibold rounded-lg transition-colors disabled:opacity-50"
              >
                {disputeMutation.isPending ? "Submitting..." : "Submit Dispute"}
              </button>
              <button
                onClick={() => setShowDispute(false)}
                className="px-6 py-3 border border-white/10 text-white/50 rounded-lg hover:bg-white/5"
              >
                Cancel
              </button>
            </div>
          </div>
        )}

        {/* History */}
        {history && history.history.length > 0 && (
          <div className="rounded-xl border border-white/8 bg-white/[0.04] p-6">
            <p className="text-xs text-white/30 uppercase tracking-wider font-medium mb-4">Activity History</p>
            <div className="space-y-3">
              {history.history.map((item, i) => (
                <div key={i} className="flex items-start gap-3">
                  <div className="w-2 h-2 rounded-full bg-white/20 mt-2 flex-shrink-0" />
                  <div>
                    <p className="text-white/80 text-sm capitalize">{item.action}</p>
                    {item.note && <p className="text-white/40 text-xs mt-0.5">{item.note}</p>}
                    {item.timestamp && (
                      <p className="text-white/20 text-xs font-mono mt-1">
                        {new Date(item.timestamp).toLocaleString()}
                      </p>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Footer */}
        <div className="text-center pt-4 pb-8">
          <p className="text-white/20 text-xs">
            Powered by Onyx &middot; Secure builder portal
          </p>
        </div>
      </div>
    </div>
  );
}
