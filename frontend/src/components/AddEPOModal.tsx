"use client";

import { useState } from "react";
import { X, Loader2, Plus } from "lucide-react";
import { createEPO } from "@/lib/api";

interface AddEPOModalProps {
  open: boolean;
  onClose: () => void;
  onCreated: () => void;
}

export function AddEPOModal({ open, onClose, onCreated }: AddEPOModalProps) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const [vendorName, setVendorName] = useState("");
  const [vendorEmail, setVendorEmail] = useState("");
  const [community, setCommunity] = useState("");
  const [lotNumber, setLotNumber] = useState("");
  const [description, setDescription] = useState("");
  const [amount, setAmount] = useState("");

  if (!open) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      await createEPO({
        vendor_name: vendorName,
        vendor_email: vendorEmail,
        community,
        lot_number: lotNumber,
        description,
        amount: parseFloat(amount) || 0,
        status: "pending",
      });
      // Reset form
      setVendorName("");
      setVendorEmail("");
      setCommunity("");
      setLotNumber("");
      setDescription("");
      setAmount("");
      onCreated();
      onClose();
    } catch (err: any) {
      setError(err.message || "Failed to create EPO. Make sure you're signed in.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/60 backdrop-blur-sm"
        onClick={onClose}
      />

      {/* Modal */}
      <div className="relative w-full max-w-lg mx-4 bg-[#141414] border border-white/8 rounded-2xl shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-white/8">
          <h2 className="text-lg font-semibold text-white">Add New EPO</h2>
          <button
            onClick={onClose}
            className="text-white/30 hover:text-white/60 transition-colors"
          >
            <X size={20} />
          </button>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} className="px-6 py-5 space-y-4">
          {error && (
            <div className="p-3 rounded-lg bg-red-500/10 border border-red-500/20 text-red-400 text-sm">
              {error}
            </div>
          )}

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="text-xs text-white/30 uppercase tracking-wider font-medium block mb-1.5">
                Builder Name *
              </label>
              <input
                type="text"
                value={vendorName}
                onChange={(e) => setVendorName(e.target.value)}
                placeholder="Meritage Homes"
                required
                className="w-full px-3 py-2.5 bg-white/5 border border-white/10 rounded-lg text-white placeholder-white/20 focus:outline-none focus:border-emerald-500/40 text-sm"
              />
            </div>
            <div>
              <label className="text-xs text-white/30 uppercase tracking-wider font-medium block mb-1.5">
                Builder Email *
              </label>
              <input
                type="email"
                value={vendorEmail}
                onChange={(e) => setVendorEmail(e.target.value)}
                placeholder="contact@meritagehomes.com"
                required
                className="w-full px-3 py-2.5 bg-white/5 border border-white/10 rounded-lg text-white placeholder-white/20 focus:outline-none focus:border-emerald-500/40 text-sm"
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="text-xs text-white/30 uppercase tracking-wider font-medium block mb-1.5">
                Community *
              </label>
              <input
                type="text"
                value={community}
                onChange={(e) => setCommunity(e.target.value)}
                placeholder="Mallard Park"
                required
                className="w-full px-3 py-2.5 bg-white/5 border border-white/10 rounded-lg text-white placeholder-white/20 focus:outline-none focus:border-emerald-500/40 text-sm"
              />
            </div>
            <div>
              <label className="text-xs text-white/30 uppercase tracking-wider font-medium block mb-1.5">
                Lot Number *
              </label>
              <input
                type="text"
                value={lotNumber}
                onChange={(e) => setLotNumber(e.target.value)}
                placeholder="142"
                required
                className="w-full px-3 py-2.5 bg-white/5 border border-white/10 rounded-lg text-white placeholder-white/20 focus:outline-none focus:border-emerald-500/40 text-sm"
              />
            </div>
          </div>

          <div>
            <label className="text-xs text-white/30 uppercase tracking-wider font-medium block mb-1.5">
              Description *
            </label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Touch-up paint after drywall repair, master bedroom ceiling"
              required
              rows={2}
              className="w-full px-3 py-2.5 bg-white/5 border border-white/10 rounded-lg text-white placeholder-white/20 focus:outline-none focus:border-emerald-500/40 text-sm resize-none"
            />
          </div>

          <div>
            <label className="text-xs text-white/30 uppercase tracking-wider font-medium block mb-1.5">
              Amount ($) *
            </label>
            <input
              type="number"
              step="0.01"
              min="0"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              placeholder="285.00"
              required
              className="w-full px-3 py-2.5 bg-white/5 border border-white/10 rounded-lg text-white placeholder-white/20 focus:outline-none focus:border-emerald-500/40 text-sm font-mono"
            />
          </div>

          {/* Actions */}
          <div className="flex gap-3 pt-2">
            <button
              type="submit"
              disabled={loading}
              className="flex-1 py-3 bg-emerald-500 hover:bg-emerald-400 text-white font-semibold rounded-xl transition-colors flex items-center justify-center gap-2 disabled:opacity-50 text-sm"
            >
              {loading ? (
                <Loader2 size={16} className="animate-spin" />
              ) : (
                <>
                  <Plus size={16} />
                  Create EPO
                </>
              )}
            </button>
            <button
              type="button"
              onClick={onClose}
              className="px-6 py-3 border border-white/10 text-white/50 rounded-xl hover:bg-white/5 text-sm"
            >
              Cancel
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
