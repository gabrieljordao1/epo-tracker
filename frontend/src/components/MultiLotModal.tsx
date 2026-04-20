"use client";

import { motion, AnimatePresence } from "framer-motion";
import { X } from "lucide-react";
import type { EPO } from "@/lib/api";

interface MultiLotModalProps {
  isOpen: boolean;
  onClose: () => void;
  epos: EPO[];
  bundleLabel: string;
}

export function MultiLotModal({ isOpen, onClose, epos, bundleLabel }: MultiLotModalProps) {
  const totalAmount = epos.reduce((sum, epo) => sum + (epo.amount || 0), 0);

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

  return (
    <AnimatePresence>
      {isOpen && (
        <>
          {/* Backdrop */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
            className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50"
          />

          {/* Modal */}
          <motion.div
            initial={{ opacity: 0, scale: 0.95, y: 20 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: 20 }}
            transition={{ type: "spring", damping: 20, stiffness: 300 }}
            className="fixed inset-0 z-50 flex items-center justify-center p-4"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="bg-[#111] border border-[#222] rounded-xl shadow-2xl w-full max-w-2xl max-h-[80vh] flex flex-col">
              {/* Header */}
              <div className="flex items-center justify-between p-6 border-b border-[#222]">
                <div className="flex-1">
                  <h2 className="text-lg font-semibold text-text1">{bundleLabel}</h2>
                  <p className="text-sm text-text3 mt-1">{epos.length} lot{epos.length !== 1 ? "s" : ""}</p>
                </div>
                <button
                  onClick={onClose}
                  className="p-2 hover:bg-surface rounded-lg transition-colors text-text3 hover:text-text1"
                >
                  <X size={20} />
                </button>
              </div>

              {/* Content */}
              <div className="flex-1 overflow-y-auto">
                <div className="p-6 space-y-3">
                  {epos.map((epo) => (
                    <div
                      key={epo.id}
                      className="bg-surface border border-[#222] rounded-lg p-4"
                    >
                      <div className="flex items-start justify-between mb-3">
                        <div className="flex-1">
                          <div className="flex items-center gap-3">
                            <span className="text-sm font-mono text-text2">
                              Lot {epo.lot_number || "—"}
                            </span>
                            <span className={`text-xs px-2 py-1 rounded border ${getStatusColor(epo.status)}`}>
                              {epo.status}
                            </span>
                          </div>
                          <p className="text-text1 font-medium mt-2 text-sm">
                            {epo.description}
                          </p>
                        </div>
                        <div className="text-right">
                          <div className="text-lg font-semibold text-green">
                            ${(epo.amount || 0).toLocaleString("en-US", {
                              minimumFractionDigits: 2,
                              maximumFractionDigits: 2,
                            })}
                          </div>
                        </div>
                      </div>
                      <div className="text-xs text-text3 space-y-1">
                        <div>Community: {epo.community || "—"}</div>
                        <div>Vendor: {epo.vendor_name || "—"}</div>
                        <div>Created: {new Date(epo.created_at).toLocaleDateString()}</div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {/* Footer */}
              <div className="border-t border-[#222] p-6 bg-surface/50">
                <div className="flex items-center justify-between">
                  <span className="text-text2">Total Amount:</span>
                  <div className="text-2xl font-semibold text-green">
                    ${totalAmount.toLocaleString("en-US", {
                      minimumFractionDigits: 2,
                      maximumFractionDigits: 2,
                    })}
                  </div>
                </div>
              </div>
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}
