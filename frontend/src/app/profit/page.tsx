"use client";

import { useState } from "react";
import {
  type EPOProfitSummary,
  type ProfitOverview,
  type SubPayment,
} from "@/lib/api";
import { useProfitSummary, useCreateSubPayment, useDeleteSubPayment, useUpdateSubPayment } from "@/hooks/useProfit";
import {
  DollarSign,
  TrendingUp,
  TrendingDown,
  Plus,
  Trash2,
  ChevronDown,
  ChevronRight,
  Loader2,
  Search,
} from "lucide-react";
import { useEffect } from "react";
import type { EPO } from "@/lib/api";
import { useLotItems } from "@/hooks/useLotItems";

// Helper: detect if a lot_number is multi-lot (range or comma-separated list)
function isMultiLot(lotNumber: string | null | undefined): boolean {
  if (!lotNumber) return false;
  const s = lotNumber.trim();
  // Range: "1-4", "53-57"
  if (/^\d+\s*[-–]\s*\d+$/.test(s)) return true;
  // Comma list: "21, 22, 23" or "21,22,23"
  if (/\d+\s*,\s*\d+/.test(s)) return true;
  // "and" list: "21 and 22" or "21, 22 and 23"
  if (/\d+\s+and\s+\d+/i.test(s)) return true;
  return false;
}

const TRADES = [
  "Drywaller",
  "Painter",
  "Texture",
  "Cleaner",
  "Labor",
  "Materials",
  "Other",
];

function fmt(n: number) {
  return `$${n.toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

/** Inline per-lot breakdown for multi-lot EPOs in the expanded section */
function LotBreakdown({ epoId }: { epoId: number }) {
  const { data: lotItems = [], isLoading } = useLotItems(epoId);

  if (isLoading) {
    return (
      <div className="flex items-center gap-2 text-text3 text-xs py-2">
        <Loader2 size={12} className="animate-spin" /> Loading per-lot breakdown…
      </div>
    );
  }

  if (lotItems.length === 0) {
    return (
      <div className="text-xs text-text3 py-1">
        No per-lot breakdown available yet.
      </div>
    );
  }

  return (
    <div className="space-y-1">
      <div className="text-xs text-text3 font-medium">Per-Lot Revenue</div>
      {lotItems.map((item) => (
        <div key={item.id} className="flex items-center gap-3 bg-surface rounded-md px-3 py-1.5">
          <span className="font-mono text-xs bg-blue/15 text-blue px-2 py-0.5 rounded">
            Lot {item.lot_number}
          </span>
          {item.description && (
            <span className="text-xs text-text2 truncate flex-1">{item.description}</span>
          )}
          <span className="font-mono text-xs text-green ml-auto">
            {item.amount != null ? fmt(item.amount) : "—"}
          </span>
        </div>
      ))}
    </div>
  );
}

export default function ProfitTrackerPage() {
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const [addingTo, setAddingTo] = useState<number | null>(null);
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<"all" | "with-payments" | "no-payments">("all");

  // Form state
  const [subName, setSubName] = useState("");
  const [subTrade, setSubTrade] = useState("Drywaller");
  const [amount, setAmount] = useState("");
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);

  // Fetch data with hooks
  const { data: profitData, isLoading } = useProfitSummary();
  const overview = profitData?.overview || null;
  const epos = profitData?.epos || [];

  // Mutation hooks
  const createMutation = useCreateSubPayment();
  const deleteMutation = useDeleteSubPayment();
  const updateMutation = useUpdateSubPayment();

  const loading = isLoading;

  const resetForm = () => {
    setSubName("");
    setSubTrade("Drywaller");
    setAmount("");
    setNotes("");
  };

  const handleAddPayment = async (epoId: number) => {
    if (!subName.trim() || !amount) {
      alert("Please enter sub name and amount");
      return;
    }
    const amountNum = parseFloat(amount);
    if (isNaN(amountNum) || amountNum <= 0) {
      alert("Please enter a valid amount");
      return;
    }

    setSaving(true);
    try {
      await createMutation.mutateAsync({
        epo_id: epoId,
        sub_name: subName.trim(),
        sub_trade: subTrade,
        amount: amountNum,
        notes: notes.trim() || null,
        paid_date: new Date().toISOString(),
      });
      resetForm();
      setAddingTo(null);
    } catch (err: any) {
      alert(`Failed to add payment: ${err.message}`);
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (paymentId: number) => {
    if (!confirm("Delete this sub payment?")) return;
    try {
      await deleteMutation.mutateAsync(paymentId);
    } catch (err: any) {
      alert(`Failed to delete: ${err.message}`);
    }
  };


  const filteredEpos = epos.filter((e) => {
    const matchesSearch =
      !search.trim() ||
      e.vendor_name.toLowerCase().includes(search.toLowerCase()) ||
      (e.community || "").toLowerCase().includes(search.toLowerCase()) ||
      (e.lot_number || "").toLowerCase().includes(search.toLowerCase()) ||
      (e.description || "").toLowerCase().includes(search.toLowerCase());
    const matchesFilter =
      filter === "all" ||
      (filter === "with-payments" && e.payments.length > 0) ||
      (filter === "no-payments" && e.payments.length === 0);
    return matchesSearch && matchesFilter;
  });

  if (loading) {
    return (
      <div className="min-h-screen bg-[#0a0a0a] p-8 flex items-center justify-center">
        <Loader2 className="animate-spin text-text2" size={32} />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#0a0a0a] p-4 md:p-8 pb-20 md:pb-8 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl md:text-3xl font-semibold text-text1">
            Profit Tracker
          </h1>
          <p className="text-text2 text-sm mt-1">
            Track what you paid subs vs. what the builder paid you
          </p>
        </div>
      </div>

      {/* Overview Cards */}
      {overview && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 md:gap-4">
          <div className="bg-[#111] border border-[#222] rounded-lg p-4">
            <div className="flex items-center gap-2 text-text3 text-xs mb-2">
              <DollarSign size={14} />
              <span>Revenue (EPOs)</span>
            </div>
            <div className="text-xl md:text-2xl font-semibold text-text1">
              {fmt(overview.total_revenue)}
            </div>
            <div className="text-xs text-text3 mt-1">
              {overview.epo_count} EPOs
            </div>
          </div>

          <div className="bg-[#111] border border-[#222] rounded-lg p-4">
            <div className="flex items-center gap-2 text-text3 text-xs mb-2">
              <TrendingDown size={14} />
              <span>Paid to Subs</span>
            </div>
            <div className="text-xl md:text-2xl font-semibold text-amber">
              {fmt(overview.total_paid_subs)}
            </div>
            <div className="text-xs text-text3 mt-1">
              {overview.payment_count} payments
            </div>
          </div>

          <div className="bg-[#111] border border-[#222] rounded-lg p-4">
            <div className="flex items-center gap-2 text-text3 text-xs mb-2">
              <TrendingUp size={14} />
              <span>Net Profit</span>
            </div>
            <div
              className={`text-xl md:text-2xl font-semibold ${
                overview.total_net_profit >= 0 ? "text-green" : "text-red"
              }`}
            >
              {fmt(overview.total_net_profit)}
            </div>
          </div>

          <div className="bg-[#111] border border-[#222] rounded-lg p-4">
            <div className="flex items-center gap-2 text-text3 text-xs mb-2">
              <TrendingUp size={14} />
              <span>Avg Margin</span>
            </div>
            <div className="text-xl md:text-2xl font-semibold text-text1">
              {overview.avg_profit_margin.toFixed(1)}%
            </div>
          </div>
        </div>
      )}

      {/* Filters */}
      <div className="flex items-center gap-3 flex-wrap">
        <div className="flex items-center gap-2 bg-[#111] border border-[#222] rounded-lg px-3 py-2 flex-1 min-w-[200px]">
          <Search size={16} className="text-text3" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by builder, community, lot..."
            className="bg-transparent text-text1 text-sm outline-none flex-1 placeholder:text-text3"
          />
        </div>
        <div className="flex gap-1 bg-[#111] border border-[#222] rounded-lg p-1">
          {(["all", "with-payments", "no-payments"] as const).map((f) => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={`px-3 py-1.5 text-xs rounded-md transition-colors ${
                filter === f
                  ? "bg-surface text-text1"
                  : "text-text2 hover:text-text1"
              }`}
            >
              {f === "all" ? "All" : f === "with-payments" ? "Paid" : "Unpaid"}
            </button>
          ))}
        </div>
      </div>

      {/* EPO list */}
      <div className="space-y-2">
        {filteredEpos.length === 0 && (
          <div className="bg-[#111] border border-[#222] rounded-lg p-12 text-center">
            <p className="text-text2">
              No EPOs match your filters.
            </p>
          </div>
        )}

        {filteredEpos.map((epo) => {
          const expanded = expandedId === epo.epo_id;
          const isAdding = addingTo === epo.epo_id;
          const profit = epo.net_profit;
          const profitColor =
            profit > 0 ? "text-green" : profit < 0 ? "text-red" : "text-text2";

          return (
            <div
              key={epo.epo_id}
              className="bg-[#111] border border-[#222] rounded-lg overflow-hidden"
            >
              {/* Header row */}
              <button
                onClick={() => setExpandedId(expanded ? null : epo.epo_id)}
                className="w-full px-4 py-3 flex items-center gap-3 hover:bg-surface transition-colors text-left"
              >
                {expanded ? (
                  <ChevronDown size={16} className="text-text3 shrink-0" />
                ) : (
                  <ChevronRight size={16} className="text-text3 shrink-0" />
                )}

                <div className="flex-1 min-w-0 grid grid-cols-12 gap-2 items-center">
                  <div className="col-span-12 md:col-span-4 min-w-0">
                    <div className="text-sm font-medium text-text1 truncate">
                      {epo.vendor_name}
                    </div>
                    <div className="text-xs text-text3 truncate">
                      {epo.community || "—"} · Lot {epo.lot_number || "—"}
                    </div>
                  </div>

                  <div className="col-span-4 md:col-span-2 text-sm">
                    <div className="text-text3 text-xs">EPO</div>
                    <div className="text-text1 font-medium">
                      {fmt(epo.epo_amount)}
                    </div>
                  </div>

                  <div className="col-span-4 md:col-span-2 text-sm">
                    <div className="text-text3 text-xs">Paid</div>
                    <div className="text-amber font-medium">
                      {fmt(epo.total_paid_subs)}
                    </div>
                  </div>

                  <div className="col-span-4 md:col-span-2 text-sm">
                    <div className="text-text3 text-xs">Profit</div>
                    <div className={`${profitColor} font-semibold`}>
                      {fmt(profit)}
                    </div>
                  </div>

                  <div className="hidden md:block md:col-span-2 text-sm text-right">
                    <div className="text-text3 text-xs">Margin</div>
                    <div className={`${profitColor} font-medium`}>
                      {epo.epo_amount > 0
                        ? `${epo.profit_margin.toFixed(1)}%`
                        : "—"}
                    </div>
                  </div>
                </div>
              </button>

              {/* Expanded section */}
              {expanded && (
                <div className="border-t border-[#222] p-4 space-y-3 bg-[#0d0d0d]">
                  {epo.description && (
                    <div className="text-sm text-text2">
                      <span className="text-text3 text-xs">Description: </span>
                      {epo.description}
                    </div>
                  )}

                  {/* Per-lot breakdown for multi-lot EPOs */}
                  {isMultiLot(epo.lot_number) && (
                    <LotBreakdown epoId={epo.epo_id} />
                  )}

                  {/* Existing payments */}
                  {epo.payments.length > 0 && (
                    <div className="space-y-2">
                      <div className="text-xs text-text3 font-medium">
                        Sub Payments ({epo.payments.length})
                      </div>
                      {epo.payments.map((p: any) => (
                        <div
                          key={p.id}
                          className="flex items-center gap-3 bg-surface rounded-md px-3 py-2"
                        >
                          <div className="flex-1 min-w-0">
                            <div className="text-sm text-text1">
                              {p.sub_name}{" "}
                              <span className="text-text3 text-xs">
                                ({p.sub_trade})
                              </span>
                            </div>
                            {p.notes && (
                              <div className="text-xs text-text3 mt-0.5">
                                {p.notes}
                              </div>
                            )}
                          </div>
                          <div className="text-sm font-medium text-amber">
                            {fmt(p.amount)}
                          </div>
                          <button
                            onClick={() => handleDelete(p.id)}
                            className="text-text3 hover:text-red transition-colors"
                          >
                            <Trash2 size={14} />
                          </button>
                        </div>
                      ))}
                    </div>
                  )}

                  {/* Add payment form */}
                  {isAdding ? (
                    <div className="bg-surface rounded-md p-3 space-y-2">
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                        <input
                          type="text"
                          value={subName}
                          onChange={(e) => setSubName(e.target.value)}
                          placeholder="Sub name (e.g., Joe's Drywall)"
                          className="bg-[#0a0a0a] border border-[#222] rounded px-3 py-2 text-sm text-text1 outline-none focus:border-green placeholder:text-text3"
                        />
                        <select
                          value={subTrade}
                          onChange={(e) => setSubTrade(e.target.value)}
                          className="bg-[#0a0a0a] border border-[#222] rounded px-3 py-2 text-sm text-text1 outline-none focus:border-green"
                        >
                          {TRADES.map((t) => (
                            <option key={t} value={t}>
                              {t}
                            </option>
                          ))}
                        </select>
                      </div>
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                        <input
                          type="number"
                          step="0.01"
                          value={amount}
                          onChange={(e) => setAmount(e.target.value)}
                          placeholder="Amount paid ($)"
                          className="bg-[#0a0a0a] border border-[#222] rounded px-3 py-2 text-sm text-text1 outline-none focus:border-green placeholder:text-text3"
                        />
                        <input
                          type="text"
                          value={notes}
                          onChange={(e) => setNotes(e.target.value)}
                          placeholder="Notes (optional)"
                          className="bg-[#0a0a0a] border border-[#222] rounded px-3 py-2 text-sm text-text1 outline-none focus:border-green placeholder:text-text3"
                        />
                      </div>
                      <div className="flex gap-2">
                        <button
                          onClick={() => handleAddPayment(epo.epo_id)}
                          disabled={saving}
                          className="btn-primary flex items-center gap-2 text-sm"
                        >
                          {saving ? (
                            <Loader2 size={14} className="animate-spin" />
                          ) : (
                            <Plus size={14} />
                          )}
                          Save Payment
                        </button>
                        <button
                          onClick={() => {
                            setAddingTo(null);
                            resetForm();
                          }}
                          className="btn-secondary text-sm"
                        >
                          Cancel
                        </button>
                      </div>
                    </div>
                  ) : (
                    <button
                      onClick={() => setAddingTo(epo.epo_id)}
                      className="flex items-center gap-2 text-sm text-green hover:text-text1 transition-colors"
                    >
                      <Plus size={16} />
                      Add Sub Payment
                    </button>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>

    </div>
  );
}
