"use client";

import { useState, useEffect } from "react";
import { createPortal } from "react-dom";
import { X, Plus, Trash2, Loader2, Wand2, Save } from "lucide-react";
import type { EPO, LotItem } from "@/lib/api";
import { useLotItems, useCreateLotItem, useUpdateLotItem, useDeleteLotItem, useAutoSplitLotItems } from "@/hooks/useLotItems";

interface MultiLotModalProps {
  isOpen: boolean;
  onClose: () => void;
  epos: EPO[];
  bundleLabel: string;
}

export function MultiLotModal({ isOpen, onClose, epos, bundleLabel }: MultiLotModalProps) {
  const isSingleMultiLot = epos.length === 1;
  const parentEpo = isSingleMultiLot ? epos[0] : null;

  const { data: lotItems = [], isLoading: loadingItems } = useLotItems(parentEpo?.id ?? null);
  const createMutation = useCreateLotItem();
  const updateMutation = useUpdateLotItem();
  const deleteMutation = useDeleteLotItem();
  const autoSplitMutation = useAutoSplitLotItems();

  const [editingId, setEditingId] = useState<number | null>(null);
  const [editAmount, setEditAmount] = useState("");
  const [editDesc, setEditDesc] = useState("");
  const [addingNew, setAddingNew] = useState(false);
  const [newLot, setNewLot] = useState("");
  const [newAmount, setNewAmount] = useState("");
  const [newDesc, setNewDesc] = useState("");

  const totalBundleAmount = epos.reduce((sum, epo) => sum + (epo.amount || 0), 0);
  const totalLotItemAmount = lotItems.reduce((sum, item) => sum + (item.amount || 0), 0);

  const getStatusColor = (status: string) => {
    switch (status) {
      case "confirmed": return "text-green bg-green-dim border-green-bdr";
      case "pending": return "text-amber bg-amber-dim border-amber-bdr";
      case "denied": return "text-red bg-red-dim border-red-bdr";
      case "discount": return "text-purple bg-purple";
      default: return "text-text2 bg-surface";
    }
  };

  const handleAutoSplit = async () => {
    if (!parentEpo) return;
    await autoSplitMutation.mutateAsync({ epoId: parentEpo.id });
  };

  const handleSaveEdit = async (item: LotItem) => {
    if (!parentEpo) return;
    await updateMutation.mutateAsync({
      itemId: item.id,
      updates: {
        amount: editAmount ? parseFloat(editAmount) : null,
        description: editDesc || null,
      },
      epoId: parentEpo.id,
    });
    setEditingId(null);
  };

  const handleAddLotItem = async () => {
    if (!parentEpo || !newLot.trim()) return;
    await createMutation.mutateAsync({
      epoId: parentEpo.id,
      item: {
        lot_number: newLot.trim(),
        amount: newAmount ? parseFloat(newAmount) : undefined,
        description: newDesc || undefined,
      },
    });
    setAddingNew(false);
    setNewLot("");
    setNewAmount("");
    setNewDesc("");
  };

  const handleDelete = async (item: LotItem) => {
    if (!parentEpo) return;
    await deleteMutation.mutateAsync({ itemId: item.id, epoId: parentEpo.id });
  };

  const [mounted, setMounted] = useState(false);
  const [visible, setVisible] = useState(false);
  useEffect(() => { setMounted(true); }, []);
  useEffect(() => {
    if (isOpen) {
      // Trigger CSS transition on next frame
      requestAnimationFrame(() => requestAnimationFrame(() => setVisible(true)));
    } else {
      setVisible(false);
    }
  }, [isOpen]);

  if (!isOpen) return null;

  const modalContent = (
    <>
      {/* Backdrop */}
      <div
        onClick={onClose}
        className="fixed inset-0 bg-black/60 backdrop-blur-sm z-[9999] transition-opacity duration-200"
        style={{ opacity: visible ? 1 : 0 }}
      />
      {/* Modal */}
      <div
        className="fixed inset-0 z-[9999] flex items-center justify-center p-4 transition-all duration-200"
        style={{
          opacity: visible ? 1 : 0,
          transform: visible ? "scale(1) translateY(0)" : "scale(0.95) translateY(20px)",
        }}
        onClick={(e) => e.stopPropagation()}
      >
            <div className="bg-[#111] border border-[#222] rounded-xl shadow-2xl w-full max-w-2xl max-h-[80vh] flex flex-col">
              {/* Header */}
              <div className="flex items-center justify-between p-6 border-b border-[#222]">
                <div className="flex-1">
                  <h2 className="text-lg font-semibold text-text1">{bundleLabel}</h2>
                  <p className="text-sm text-text3 mt-1">
                    {isSingleMultiLot
                      ? `${lotItems.length} lot breakdown${lotItems.length !== 1 ? "s" : ""}`
                      : `${epos.length} lot${epos.length !== 1 ? "s" : ""}`}
                  </p>
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
                {isSingleMultiLot && parentEpo ? (
                  <div className="p-6 space-y-4">
                    {/* Parent EPO summary */}
                    <div className="bg-surface border border-[#222] rounded-lg p-4">
                      <div className="flex items-center justify-between mb-2">
                        <div className="flex items-center gap-3">
                          <span className={`text-xs px-2 py-1 rounded border ${getStatusColor(parentEpo.status)}`}>
                            {parentEpo.status}
                          </span>
                          <span className="text-sm text-text2">{parentEpo.description}</span>
                        </div>
                        <div className="text-lg font-semibold text-green">
                          ${(parentEpo.amount || 0).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                        </div>
                      </div>
                    </div>

                    {/* Lot items */}
                    {loadingItems ? (
                      <div className="flex items-center justify-center py-8">
                        <Loader2 className="animate-spin text-text3" size={24} />
                      </div>
                    ) : lotItems.length === 0 ? (
                      <div className="text-center py-8">
                        <p className="text-text3 text-sm mb-4">No per-lot breakdown yet</p>
                        <button
                          onClick={handleAutoSplit}
                          disabled={autoSplitMutation.isPending}
                          className="btn-primary text-sm inline-flex items-center gap-2"
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
                          <div key={item.id} className="bg-surface border border-[#222] rounded-lg p-3">
                            {editingId === item.id ? (
                              <div className="space-y-2">
                                <div className="flex gap-2">
                                  <span className="font-mono text-sm text-text2 py-1">Lot {item.lot_number}</span>
                                  <input
                                    type="number"
                                    value={editAmount}
                                    onChange={(e) => setEditAmount(e.target.value)}
                                    placeholder="Amount"
                                    className="flex-1 px-2 py-1 bg-[#111] border border-[#333] rounded text-sm text-text1"
                                    step="0.01"
                                  />
                                </div>
                                <input
                                  type="text"
                                  value={editDesc}
                                  onChange={(e) => setEditDesc(e.target.value)}
                                  placeholder="Description (optional)"
                                  className="w-full px-2 py-1 bg-[#111] border border-[#333] rounded text-sm text-text1"
                                />
                                <div className="flex gap-2 justify-end">
                                  <button onClick={() => setEditingId(null)} className="text-xs text-text3 hover:text-text1 px-2 py-1">Cancel</button>
                                  <button onClick={() => handleSaveEdit(item)} className="text-xs text-green hover:text-green/80 px-2 py-1 flex items-center gap-1">
                                    <Save size={12} /> Save
                                  </button>
                                </div>
                              </div>
                            ) : (
                              <div className="flex items-center justify-between">
                                <div className="flex items-center gap-3 flex-1 cursor-pointer" onClick={() => { setEditingId(item.id); setEditAmount(item.amount?.toString() || ""); setEditDesc(item.description || ""); }}>
                                  <span className="font-mono text-sm bg-blue/15 text-blue px-2 py-0.5 rounded">
                                    Lot {item.lot_number}
                                  </span>
                                  {item.description && (
                                    <span className="text-sm text-text2 truncate max-w-[200px]">{item.description}</span>
                                  )}
                                </div>
                                <div className="flex items-center gap-3">
                                  <span className="font-mono text-sm text-green">
                                    {item.amount != null ? `$${item.amount.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : "—"}
                                  </span>
                                  <button
                                    onClick={(e) => { e.stopPropagation(); handleDelete(item); }}
                                    className="text-text3 hover:text-red transition-colors p-1"
                                  >
                                    <Trash2 size={14} />
                                  </button>
                                </div>
                              </div>
                            )}
                          </div>
                        ))}

                        {/* Add new lot item */}
                        {addingNew ? (
                          <div className="bg-surface border border-[#333] rounded-lg p-3 space-y-2">
                            <div className="flex gap-2">
                              <input
                                type="text"
                                value={newLot}
                                onChange={(e) => setNewLot(e.target.value)}
                                placeholder="Lot #"
                                className="w-20 px-2 py-1 bg-[#111] border border-[#333] rounded text-sm text-text1"
                              />
                              <input
                                type="number"
                                value={newAmount}
                                onChange={(e) => setNewAmount(e.target.value)}
                                placeholder="Amount"
                                className="flex-1 px-2 py-1 bg-[#111] border border-[#333] rounded text-sm text-text1"
                                step="0.01"
                              />
                            </div>
                            <input
                              type="text"
                              value={newDesc}
                              onChange={(e) => setNewDesc(e.target.value)}
                              placeholder="Description (optional)"
                              className="w-full px-2 py-1 bg-[#111] border border-[#333] rounded text-sm text-text1"
                            />
                            <div className="flex gap-2 justify-end">
                              <button onClick={() => setAddingNew(false)} className="text-xs text-text3 hover:text-text1 px-2 py-1">Cancel</button>
                              <button onClick={handleAddLotItem} className="text-xs text-green hover:text-green/80 px-2 py-1 flex items-center gap-1">
                                <Plus size={12} /> Add
                              </button>
                            </div>
                          </div>
                        ) : (
                          <button
                            onClick={() => setAddingNew(true)}
                            className="w-full py-2 border border-dashed border-[#333] rounded-lg text-sm text-text3 hover:text-text1 hover:border-[#444] transition-colors flex items-center justify-center gap-2"
                          >
                            <Plus size={14} />
                            Add Lot
                          </button>
                        )}
                      </div>
                    )}
                  </div>
                ) : (
                  /* Multiple bundled EPOs - original behavior */
                  <div className="p-6 space-y-3">
                    {epos.map((epo) => (
                      <div key={epo.id} className="bg-surface border border-[#222] rounded-lg p-4">
                        <div className="flex items-start justify-between mb-3">
                          <div className="flex-1">
                            <div className="flex items-center gap-3">
                              <span className="text-sm font-mono text-text2">Lot {epo.lot_number || "—"}</span>
                              <span className={`text-xs px-2 py-1 rounded border ${getStatusColor(epo.status)}`}>{epo.status}</span>
                            </div>
                            <p className="text-text1 font-medium mt-2 text-sm">{epo.description}</p>
                          </div>
                          <div className="text-right">
                            <div className="text-lg font-semibold text-green">
                              ${(epo.amount || 0).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
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
                )}
              </div>

              {/* Footer */}
              <div className="border-t border-[#222] p-6 bg-surface/50">
                <div className="flex items-center justify-between">
                  {isSingleMultiLot && lotItems.length > 0 ? (
                    <>
                      <div>
                        <span className="text-text2 text-sm">Lot Items Total:</span>
                        <span className={`ml-2 font-mono ${Math.abs(totalLotItemAmount - (parentEpo?.amount || 0)) < 0.01 ? 'text-green' : 'text-amber'}`}>
                          ${totalLotItemAmount.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                        </span>
                      </div>
                      <div>
                        <span className="text-text2 text-sm">EPO Total:</span>
                        <span className="ml-2 text-2xl font-semibold text-green">
                          ${(parentEpo?.amount || 0).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                        </span>
                      </div>
                    </>
                  ) : (
                    <>
                      <span className="text-text2">Total Amount:</span>
                      <div className="text-2xl font-semibold text-green">
                        ${totalBundleAmount.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                      </div>
                    </>
                  )}
                </div>
              </div>
            </div>
      </div>
    </>
  );

  if (!mounted) return null;
  return createPortal(modalContent, document.body);
}
