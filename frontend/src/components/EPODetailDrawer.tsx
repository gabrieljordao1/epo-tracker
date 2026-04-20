"use client";

import { useState, useEffect } from "react";
import {
  X,
  Send,
  CheckCircle,
  XCircle,
  Clock,
  DollarSign,
  MapPin,
  Building2,
  Hash,
  FileText,
  Mail,
  AlertCircle,
  Loader2,
  ChevronDown,
  ChevronUp,
  ExternalLink,
  Edit3,
  Save,
  Percent,
  Wand2,
  Layers,
} from "lucide-react";
import type { EPO } from "@/lib/api";
import { updateEPO, sendFollowup } from "@/lib/api";
import { useLotItems, useAutoSplitLotItems } from "@/hooks/useLotItems";

interface EPODetailDrawerProps {
  epo: EPO | null;
  open: boolean;
  onClose: () => void;
  onUpdated: () => void;
}

function isMultiLot(lotNumber: string | null | undefined): boolean {
  if (!lotNumber) return false;
  const s = lotNumber.trim();
  if (/^\d+\s*[-–]\s*\d+$/.test(s)) return true;
  if (/\d+\s*,\s*\d+/.test(s)) return true;
  if (/\d+\s+and\s+\d+/i.test(s)) return true;
  return false;
}

const STATUS_CONFIG = {
  pending: {
    color: "text-amber-400",
    bg: "bg-amber-400/10",
    border: "border-amber-400/30",
    icon: Clock,
    label: "Pending",
  },
  confirmed: {
    color: "text-emerald-400",
    bg: "bg-emerald-400/10",
    border: "border-emerald-400/30",
    icon: CheckCircle,
    label: "Confirmed",
  },
  denied: {
    color: "text-red-400",
    bg: "bg-red-400/10",
    border: "border-red-400/30",
    icon: XCircle,
    label: "Denied",
  },
  discount: {
    color: "text-purple-400",
    bg: "bg-purple-400/10",
    border: "border-purple-400/30",
    icon: Percent,
    label: "Discount",
  },
};

export function EPODetailDrawer({
  epo,
  open,
  onClose,
  onUpdated,
}: EPODetailDrawerProps) {
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [followingUp, setFollowingUp] = useState(false);
  const [followupMsg, setFollowupMsg] = useState<string | null>(null);
  const [showStatusMenu, setShowStatusMenu] = useState(false);
  const [editForm, setEditForm] = useState({
    description: "",
    amount: "",
    vendor_name: "",
    community: "",
    lot_number: "",
  });

  useEffect(() => {
    if (epo) {
      setEditForm({
        description: epo.description || "",
        amount: epo.amount != null ? epo.amount.toString() : "",
        vendor_name: epo.vendor_name || "",
        community: epo.community || "",
        lot_number: epo.lot_number || "",
      });
      setEditing(false);
      setFollowupMsg(null);
    }
  }, [epo]);

  // Close on Escape
  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    if (open) window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [open, onClose]);

  const handleSave = async () => {
    if (!epo) return;
    setSaving(true);
    try {
      const updates: Partial<EPO> = {};
      if (editForm.description !== (epo.description || ""))
        updates.description = editForm.description;
      if (editForm.vendor_name !== (epo.vendor_name || ""))
        updates.vendor_name = editForm.vendor_name;
      if (editForm.community !== (epo.community || ""))
        updates.community = editForm.community;
      if (editForm.lot_number !== (epo.lot_number || ""))
        updates.lot_number = editForm.lot_number;
      const newAmount = editForm.amount ? parseFloat(editForm.amount) : null;
      if (newAmount !== epo.amount) updates.amount = newAmount as any;

      if (Object.keys(updates).length > 0) {
        await updateEPO(epo.id, updates);
        onUpdated();
      }
      setEditing(false);
    } catch (err) {
      console.error("Failed to save:", err);
    } finally {
      setSaving(false);
    }
  };

  const handleStatusChange = async (
    newStatus: "pending" | "confirmed" | "denied" | "discount"
  ) => {
    if (!epo) return;
    setShowStatusMenu(false);
    try {
      await updateEPO(epo.id, { status: newStatus } as any);
      onUpdated();
    } catch (err) {
      console.error("Failed to update status:", err);
    }
  };

  const handleFollowup = async () => {
    if (!epo) return;
    setFollowingUp(true);
    setFollowupMsg(null);
    try {
      const result = await sendFollowup(epo.id);
      setFollowupMsg(result.message || "Follow-up sent!");
      setTimeout(() => setFollowupMsg(null), 4000);
    } catch (err: any) {
      setFollowupMsg(err.message || "Failed to send");
      setTimeout(() => setFollowupMsg(null), 4000);
    } finally {
      setFollowingUp(false);
    }
  };

  // CSS transition state
  const [visible, setVisible] = useState(false);
  const [shouldRender, setShouldRender] = useState(false);

  useEffect(() => {
    if (open) {
      setShouldRender(true);
      // Small delay to trigger CSS transition after mount
      requestAnimationFrame(() => {
        requestAnimationFrame(() => setVisible(true));
      });
    } else {
      setVisible(false);
      const timer = setTimeout(() => setShouldRender(false), 300);
      return () => clearTimeout(timer);
    }
  }, [open]);

  if (!epo || !shouldRender) return null;

  const statusConfig = STATUS_CONFIG[epo.status] || STATUS_CONFIG.pending;
  const StatusIcon = statusConfig.icon;
  const createdDate = new Date(epo.created_at);
  const ageColor =
    (epo.days_open || 0) >= 7
      ? "text-red-400"
      : (epo.days_open || 0) >= 4
      ? "text-amber-400"
      : "text-emerald-400";

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 bg-black/60 backdrop-blur-sm z-40"
        style={{
          opacity: visible ? 1 : 0,
          transition: "opacity 0.3s ease",
        }}
        onClick={onClose}
      />

      {/* Drawer */}
      <div
        className="fixed right-0 top-0 h-full w-full max-w-lg bg-[#0a0a0a] border-l border-[#222] z-50 overflow-y-auto"
        style={{
          transform: visible ? "translateX(0)" : "translateX(100%)",
          transition: "transform 0.3s cubic-bezier(0.32, 0.72, 0, 1)",
        }}
      >
            {/* Header */}
            <div className="sticky top-0 bg-[#0a0a0a]/95 backdrop-blur-md border-b border-[#222] px-6 py-4 flex items-center justify-between z-10">
              <div className="flex items-center gap-3">
                <div
                  className={`w-10 h-10 rounded-lg ${statusConfig.bg} ${statusConfig.border} border flex items-center justify-center`}
                >
                  <StatusIcon size={18} className={statusConfig.color} />
                </div>
                <div>
                  <h2 className="text-lg font-semibold text-white">
                    {epo.community || "Unknown"} — Lot{" "}
                    {epo.lot_number || "—"}
                  </h2>
                  <p className="text-sm text-[rgba(255,255,255,0.5)]">
                    EPO #{epo.id}
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                {!editing ? (
                  <button
                    onClick={() => setEditing(true)}
                    className="p-2 hover:bg-[#1a1a1a] rounded-lg transition-colors"
                    title="Edit EPO"
                  >
                    <Edit3 size={16} className="text-[rgba(255,255,255,0.5)]" />
                  </button>
                ) : (
                  <button
                    onClick={handleSave}
                    disabled={saving}
                    className="p-2 hover:bg-emerald-400/10 rounded-lg transition-colors"
                    title="Save changes"
                  >
                    {saving ? (
                      <Loader2
                        size={16}
                        className="text-emerald-400 animate-spin"
                      />
                    ) : (
                      <Save size={16} className="text-emerald-400" />
                    )}
                  </button>
                )}
                <button
                  onClick={onClose}
                  className="p-2 hover:bg-[#1a1a1a] rounded-lg transition-colors"
                >
                  <X size={18} className="text-[rgba(255,255,255,0.5)]" />
                </button>
              </div>
            </div>

            <div className="p-6 space-y-6">
              {/* Status + Quick Actions */}
              <div className="flex items-center gap-3 flex-wrap">
                {/* Status Badge with Dropdown */}
                <div className="relative">
                  <button
                    onClick={() => setShowStatusMenu(!showStatusMenu)}
                    className={`inline-flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium border ${statusConfig.bg} ${statusConfig.border} ${statusConfig.color} hover:opacity-80 transition-opacity`}
                  >
                    <StatusIcon size={14} />
                    {statusConfig.label}
                    <ChevronDown size={12} />
                  </button>

                  {showStatusMenu && (
                    <div
                      className="absolute top-full mt-2 left-0 bg-[#1a1a1a] border border-[#333] rounded-lg shadow-xl z-20 min-w-[160px] overflow-hidden"
                    >
                      {(
                        Object.entries(STATUS_CONFIG) as [
                          string,
                          (typeof STATUS_CONFIG)[keyof typeof STATUS_CONFIG]
                        ][]
                      ).map(([key, config]) => {
                        const Icon = config.icon;
                        return (
                          <button
                            key={key}
                            onClick={() =>
                              handleStatusChange(key as any)
                            }
                            className={`w-full flex items-center gap-2 px-4 py-2.5 text-sm hover:bg-[#222] transition-colors ${
                              key === epo.status
                                ? config.color + " font-medium"
                                : "text-[rgba(255,255,255,0.7)]"
                            }`}
                          >
                            <Icon size={14} />
                            {config.label}
                            {key === epo.status && (
                              <CheckCircle
                                size={12}
                                className="ml-auto text-emerald-400"
                              />
                            )}
                          </button>
                        );
                      })}
                    </div>
                  )}
                </div>

                {/* Follow-up Button */}
                {epo.status === "pending" && (
                  <button
                    onClick={handleFollowup}
                    disabled={followingUp}
                    className="inline-flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium bg-amber-400/10 border border-amber-400/30 text-amber-400 hover:bg-amber-400/20 transition-colors disabled:opacity-50"
                  >
                    {followingUp ? (
                      <Loader2 size={14} className="animate-spin" />
                    ) : (
                      <Send size={14} />
                    )}
                    Send Follow-up
                  </button>
                )}

                {followupMsg && (
                  <span className="text-xs text-emerald-400">
                    {followupMsg}
                  </span>
                )}
              </div>

              {/* Key Details Grid */}
              <div className="grid grid-cols-2 gap-4">
                <DetailField
                  icon={<Building2 size={14} />}
                  label="Builder"
                  value={epo.vendor_name}
                  editing={editing}
                  editValue={editForm.vendor_name}
                  onChange={(v) =>
                    setEditForm({ ...editForm, vendor_name: v })
                  }
                />
                <DetailField
                  icon={<MapPin size={14} />}
                  label="Community"
                  value={epo.community}
                  editing={editing}
                  editValue={editForm.community}
                  onChange={(v) =>
                    setEditForm({ ...editForm, community: v })
                  }
                />
                <DetailField
                  icon={<Hash size={14} />}
                  label="Lot"
                  value={epo.lot_number}
                  editing={editing}
                  editValue={editForm.lot_number}
                  onChange={(v) =>
                    setEditForm({ ...editForm, lot_number: v })
                  }
                />
                <DetailField
                  icon={<DollarSign size={14} />}
                  label="Amount"
                  value={
                    epo.amount != null
                      ? `$${epo.amount.toLocaleString()}`
                      : "—"
                  }
                  editing={editing}
                  editValue={editForm.amount}
                  onChange={(v) =>
                    setEditForm({ ...editForm, amount: v })
                  }
                  inputType="number"
                />
              </div>

              {/* Description */}
              <div className="bg-[#111] rounded-lg p-4 border border-[#222]">
                <div className="flex items-center gap-2 mb-2">
                  <FileText
                    size={14}
                    className="text-[rgba(255,255,255,0.4)]"
                  />
                  <span className="text-xs font-medium text-[rgba(255,255,255,0.4)] uppercase tracking-wider">
                    Description
                  </span>
                </div>
                {editing ? (
                  <textarea
                    value={editForm.description}
                    onChange={(e) =>
                      setEditForm({
                        ...editForm,
                        description: e.target.value,
                      })
                    }
                    rows={3}
                    className="w-full bg-[#0a0a0a] border border-[#333] rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-emerald-500 resize-none"
                  />
                ) : (
                  <p className="text-sm text-[rgba(255,255,255,0.8)] leading-relaxed">
                    {epo.description || "No description provided"}
                  </p>
                )}
              </div>

              {/* Per-Lot Breakdown (only for multi-lot EPOs) */}
              {isMultiLot(epo.lot_number) && (
                <LotBreakdownDrawer epoId={epo.id} totalAmount={epo.amount} />
              )}

              {/* Timeline */}
              <div className="bg-[#111] rounded-lg p-4 border border-[#222]">
                <h3 className="text-sm font-semibold text-white mb-4 flex items-center gap-2">
                  <Clock size={14} className="text-[rgba(255,255,255,0.4)]" />
                  Timeline
                </h3>
                <div className="space-y-4">
                  {/* Created */}
                  <TimelineItem
                    icon={
                      <div className="w-2 h-2 rounded-full bg-emerald-400" />
                    }
                    title="EPO Created"
                    subtitle={
                      epo.synced_from_email
                        ? "Synced from email"
                        : "Manually created"
                    }
                    time={createdDate.toLocaleDateString("en-US", {
                      month: "short",
                      day: "numeric",
                      year: "numeric",
                      hour: "numeric",
                      minute: "2-digit",
                    })}
                  />

                  {/* Age */}
                  <TimelineItem
                    icon={
                      <div
                        className={`w-2 h-2 rounded-full ${
                          (epo.days_open || 0) >= 7
                            ? "bg-red-400"
                            : (epo.days_open || 0) >= 4
                            ? "bg-amber-400"
                            : "bg-emerald-400"
                        }`}
                      />
                    }
                    title={`Open for ${epo.days_open || 0} days`}
                    subtitle={
                      (epo.days_open || 0) >= 7
                        ? "Overdue — needs immediate follow-up"
                        : (epo.days_open || 0) >= 4
                        ? "Follow-up recommended"
                        : "Within normal timeframe"
                    }
                    time="Current"
                    highlight={
                      (epo.days_open || 0) >= 4 ? ageColor : undefined
                    }
                  />

                  {/* Confirmation */}
                  {epo.status === "confirmed" && epo.confirmation_number && (
                    <TimelineItem
                      icon={
                        <div className="w-2 h-2 rounded-full bg-emerald-400" />
                      }
                      title={`Confirmed — ${epo.confirmation_number}`}
                      subtitle="Builder confirmed the EPO"
                      time=""
                    />
                  )}
                </div>
              </div>

              {/* Metadata */}
              <div className="bg-[#111] rounded-lg p-4 border border-[#222]">
                <h3 className="text-sm font-semibold text-white mb-3 flex items-center gap-2">
                  <AlertCircle
                    size={14}
                    className="text-[rgba(255,255,255,0.4)]"
                  />
                  Details
                </h3>
                <div className="grid grid-cols-2 gap-y-3 gap-x-6 text-sm">
                  <div>
                    <span className="text-[rgba(255,255,255,0.4)] text-xs">
                      Vendor Email
                    </span>
                    <p className="text-[rgba(255,255,255,0.8)]">
                      {epo.vendor_email || "—"}
                    </p>
                  </div>
                  <div>
                    <span className="text-[rgba(255,255,255,0.4)] text-xs">
                      Parse Model
                    </span>
                    <p className="text-[rgba(255,255,255,0.8)] capitalize">
                      {epo.parse_model || "manual"}
                    </p>
                  </div>
                  <div>
                    <span className="text-[rgba(255,255,255,0.4)] text-xs">
                      Confidence
                    </span>
                    <div className="flex items-center gap-2">
                      <div className="flex-1 h-1.5 bg-[#222] rounded-full overflow-hidden max-w-[80px]">
                        <div
                          className={`h-full rounded-full ${
                            (epo.confidence_score || 0) >= 0.8
                              ? "bg-emerald-400"
                              : (epo.confidence_score || 0) >= 0.6
                              ? "bg-amber-400"
                              : "bg-red-400"
                          }`}
                          style={{
                            width: `${(epo.confidence_score || 0) * 100}%`,
                          }}
                        />
                      </div>
                      <span className="text-[rgba(255,255,255,0.8)]">
                        {Math.round((epo.confidence_score || 0) * 100)}%
                      </span>
                    </div>
                  </div>
                  <div>
                    <span className="text-[rgba(255,255,255,0.4)] text-xs">
                      Needs Review
                    </span>
                    <p
                      className={
                        epo.needs_review
                          ? "text-amber-400"
                          : "text-emerald-400"
                      }
                    >
                      {epo.needs_review ? "Yes" : "No"}
                    </p>
                  </div>
                  <div>
                    <span className="text-[rgba(255,255,255,0.4)] text-xs">
                      Source
                    </span>
                    <p className="text-[rgba(255,255,255,0.8)]">
                      {epo.synced_from_email ? "Email sync" : "Manual entry"}
                    </p>
                  </div>
                  {epo.confirmation_number && (
                    <div>
                      <span className="text-[rgba(255,255,255,0.4)] text-xs">
                        Confirmation #
                      </span>
                      <p className="text-emerald-400 font-mono">
                        {epo.confirmation_number}
                      </p>
                    </div>
                  )}
                </div>
              </div>
            </div>
      </div>
    </>
  );
}

/* ── Sub Components ──────────────────────────────────── */

function LotBreakdownDrawer({ epoId, totalAmount }: { epoId: number; totalAmount: number | null }) {
  const { data: lotItems = [], isLoading } = useLotItems(epoId);
  const autoSplitMutation = useAutoSplitLotItems();

  const handleAutoSplit = async () => {
    await autoSplitMutation.mutateAsync(epoId);
  };

  const totalLotAmount = lotItems.reduce((sum, item) => sum + (item.amount || 0), 0);
  const isBalanced = totalAmount != null && Math.abs(totalLotAmount - totalAmount) < 0.01;

  return (
    <div className="bg-[#111] rounded-lg p-4 border border-[#222]">
      <h3 className="text-sm font-semibold text-white mb-3 flex items-center gap-2">
        <Layers size={14} className="text-[rgba(255,255,255,0.4)]" />
        Per-Lot Breakdown
      </h3>

      {isLoading ? (
        <div className="flex items-center gap-2 text-[rgba(255,255,255,0.4)] text-sm py-2">
          <Loader2 size={14} className="animate-spin" /> Loading…
        </div>
      ) : lotItems.length === 0 ? (
        <div className="text-center py-3">
          <p className="text-[rgba(255,255,255,0.4)] text-sm mb-3">No per-lot breakdown yet</p>
          <button
            onClick={handleAutoSplit}
            disabled={autoSplitMutation.isPending}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium bg-emerald-400/10 border border-emerald-400/30 text-emerald-400 hover:bg-emerald-400/20 transition-colors disabled:opacity-50"
          >
            {autoSplitMutation.isPending ? (
              <Loader2 size={14} className="animate-spin" />
            ) : (
              <Wand2 size={14} />
            )}
            Auto-Split from Lot Range
          </button>
        </div>
      ) : (
        <div className="space-y-2">
          {lotItems.map((item) => (
            <div key={item.id} className="flex items-center justify-between bg-[#0a0a0a] rounded-lg px-3 py-2 border border-[#1a1a1a]">
              <div className="flex items-center gap-2">
                <span className="font-mono text-xs bg-blue-400/15 text-blue-400 px-2 py-0.5 rounded">
                  Lot {item.lot_number}
                </span>
                {item.description && (
                  <span className="text-xs text-[rgba(255,255,255,0.5)] truncate max-w-[150px]">{item.description}</span>
                )}
              </div>
              <span className="font-mono text-sm text-emerald-400">
                {item.amount != null
                  ? `$${item.amount.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
                  : "—"}
              </span>
            </div>
          ))}
          {/* Total row */}
          <div className="flex items-center justify-between pt-2 border-t border-[#222]">
            <span className="text-xs text-[rgba(255,255,255,0.4)]">Lot Items Total</span>
            <span className={`font-mono text-sm font-medium ${isBalanced ? 'text-emerald-400' : 'text-amber-400'}`}>
              ${totalLotAmount.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
              {!isBalanced && totalAmount != null && (
                <span className="text-xs text-amber-400/60 ml-1">
                  (EPO: ${totalAmount.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })})
                </span>
              )}
            </span>
          </div>
        </div>
      )}
    </div>
  );
}

function DetailField({
  icon,
  label,
  value,
  editing,
  editValue,
  onChange,
  inputType = "text",
}: {
  icon: React.ReactNode;
  label: string;
  value: string | null | undefined;
  editing: boolean;
  editValue: string;
  onChange: (v: string) => void;
  inputType?: string;
}) {
  return (
    <div className="bg-[#111] rounded-lg p-3 border border-[#222]">
      <div className="flex items-center gap-1.5 mb-1">
        <span className="text-[rgba(255,255,255,0.4)]">{icon}</span>
        <span className="text-xs font-medium text-[rgba(255,255,255,0.4)] uppercase tracking-wider">
          {label}
        </span>
      </div>
      {editing ? (
        <input
          type={inputType}
          value={editValue}
          onChange={(e) => onChange(e.target.value)}
          className="w-full bg-[#0a0a0a] border border-[#333] rounded px-2 py-1 text-sm text-white focus:outline-none focus:border-emerald-500"
        />
      ) : (
        <p className="text-sm font-medium text-white truncate">
          {value || "—"}
        </p>
      )}
    </div>
  );
}

function TimelineItem({
  icon,
  title,
  subtitle,
  time,
  highlight,
}: {
  icon: React.ReactNode;
  title: string;
  subtitle: string;
  time: string;
  highlight?: string;
}) {
  return (
    <div className="flex gap-3">
      <div className="flex flex-col items-center">
        <div className="mt-1.5">{icon}</div>
        <div className="flex-1 w-px bg-[#222] my-1" />
      </div>
      <div className="flex-1 pb-2">
        <p className={`text-sm font-medium ${highlight || "text-white"}`}>
          {title}
        </p>
        <p className="text-xs text-[rgba(255,255,255,0.4)]">{subtitle}</p>
        {time && (
          <p className="text-xs text-[rgba(255,255,255,0.3)] mt-0.5">
            {time}
          </p>
        )}
      </div>
    </div>
  );
}
