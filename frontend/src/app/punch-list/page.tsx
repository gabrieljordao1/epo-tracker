"use client";

import { useState, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  AlertTriangle,
  CheckCircle2,
  Clock,
  User,
  MapPin,
  X,
  Plus,
  ChevronDown,
  Hammer,
  List,
  LayoutGrid,
} from "lucide-react";
import {
  getPunchItems,
  getPunchSummary,
  createPunchItem,
  updatePunchItem,
  completePunchItem,
  verifyPunchItem,
  PunchItem,
  PunchSummary,
} from "@/lib/api";

const CATEGORIES = {
  drywall_damage: "Drywall Damage",
  drywall_finish: "Drywall Finish",
  paint_touch_up: "Paint Touch-up",
  paint_color: "Paint Color",
  texture_issue: "Texture Issue",
  nail_pop: "Nail Pop",
  crack: "Crack",
  scuff_mark: "Scuff/Mark",
  missed_area: "Missed Area",
  caulking: "Caulking",
  trim_issue: "Trim Issue",
  ceiling: "Ceiling",
  moisture_damage: "Moisture Damage",
  other: "Other",
};

const CATEGORY_COLORS: Record<string, string> = {
  drywall_damage: "bg-red-dim text-red",
  drywall_finish: "bg-orange-500/20 text-orange-300",
  paint_touch_up: "bg-[rgba(144,191,249,0.12)] text-blue",
  paint_color: "bg-cyan-500/20 text-cyan-300",
  texture_issue: "bg-purple-500/20 text-purple-300",
  nail_pop: "bg-red-600/20 text-red",
  crack: "bg-amber-dim text-amber",
  scuff_mark: "bg-yellow-500/20 text-yellow-300",
  missed_area: "bg-indigo-500/20 text-indigo-300",
  caulking: "bg-pink-500/20 text-pink-300",
  trim_issue: "bg-violet-500/20 text-violet-300",
  ceiling: "bg-sky-500/20 text-sky-300",
  moisture_damage: "bg-teal-500/20 text-teal-300",
  other: "bg-gray-500/20 text-text2",
};

const PRIORITY_COLORS: Record<string, { dot: string; bg: string }> = {
  low: { dot: "bg-green", bg: "bg-green-dim" },
  medium: { dot: "bg-amber", bg: "bg-amber-dim" },
  high: { dot: "bg-amber", bg: "bg-amber-dim" },
  critical: { dot: "bg-red", bg: "bg-red-dim" },
};

export default function PunchListPage() {
  const [mounted, setMounted] = useState(false);
  const [viewMode, setViewMode] = useState<"kanban" | "list">("kanban");
  const [items, setItems] = useState<PunchItem[]>([]);
  const [summary, setSummary] = useState<PunchSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [modalMode, setModalMode] = useState<"create" | "edit">("create");
  const [selectedItem, setSelectedItem] = useState<PunchItem | null>(null);

  const [filters, setFilters] = useState({
    community: "",
    status: "",
    priority: "",
    category: "",
  });

  const [formData, setFormData] = useState<Partial<PunchItem>>({
    community: "",
    lot_number: "",
    location: "",
    title: "",
    description: "",
    category: "other",
    priority: "medium",
    reported_by: "",
    builder_name: "",
    due_date: "",
    resolution_notes: "",
  });

  useEffect(() => {
    setMounted(true);
    loadData();
  }, []);

  const loadData = async () => {
    setLoading(true);
    try {
      const [itemsRes, summaryRes] = await Promise.all([
        getPunchItems({
          community: filters.community || undefined,
          status: filters.status || undefined,
          priority: filters.priority || undefined,
          category: filters.category || undefined,
        }),
        getPunchSummary(),
      ]);
      setItems(itemsRes.items);
      setSummary(summaryRes);
    } catch (err) {
      console.error("Failed to load punch list:", err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (mounted) loadData();
  }, [filters]);

  const handleCreateItem = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await createPunchItem(formData);
      setFormData({
        community: "",
        lot_number: "",
        location: "",
        title: "",
        description: "",
        category: "other",
        priority: "medium",
        reported_by: "",
        builder_name: "",
        due_date: "",
        resolution_notes: "",
      });
      setShowModal(false);
      loadData();
    } catch (err) {
      console.error("Failed to create punch item:", err);
    }
  };

  const handleCompleteItem = async (itemId: number) => {
    try {
      await completePunchItem(itemId, {
        resolution_notes: "Completed",
      });
      loadData();
    } catch (err) {
      console.error("Failed to complete item:", err);
    }
  };

  const handleVerifyItem = async (itemId: number, approved: boolean) => {
    try {
      await verifyPunchItem(itemId, approved);
      loadData();
    } catch (err) {
      console.error("Failed to verify item:", err);
    }
  };

  if (!mounted) return null;

  const statuses = ["open", "in_progress", "completed", "verified"];
  const statusColors: Record<string, string> = {
    open: "border-red-bdr bg-red-dim",
    in_progress: "border-amber-bdr bg-amber-dim",
    completed: "border-[rgba(144,191,249,0.25)] bg-[rgba(144,191,249,0.12)]",
    verified: "border-green-bdr bg-green-dim",
  };

  const statusLabels: Record<string, string> = {
    open: "Open",
    in_progress: "In Progress",
    completed: "Completed",
    verified: "Verified",
  };

  const groupedByStatus = statuses.reduce(
    (acc, status) => ({
      ...acc,
      [status]: items.filter((item) => item.status === status),
    }),
    {} as Record<string, PunchItem[]>
  );

  return (
    <div className="min-h-screen text-text1">
      {/* Header */}
      <div className="border-b border-[#222] bg-surface sticky top-0 z-20">
        <div className="max-w-7xl mx-auto px-6 py-6">
          <div className="flex items-center justify-between mb-6">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-green-dim rounded-lg">
                <Hammer size={24} className="text-green" />
              </div>
              <div>
                <h1 className="text-3xl font-bold">Punch List</h1>
                <p className="text-sm text-text2 mt-1">Manage deficiencies & closeout items</p>
              </div>
            </div>
            <motion.button
              whileHover={{ scale: 1.05 }}
              whileTap={{ scale: 0.95 }}
              onClick={() => {
                setModalMode("create");
                setSelectedItem(null);
                setFormData({
                  community: "",
                  lot_number: "",
                  location: "",
                  title: "",
                  description: "",
                  category: "other",
                  priority: "medium",
                  reported_by: "",
                  builder_name: "",
                  due_date: "",
                  resolution_notes: "",
                });
                setShowModal(true);
              }}
              className="flex items-center gap-2 px-4 py-2.5 bg-green hover:bg-green text-text1 rounded-lg font-medium transition-colors"
            >
              <Plus size={18} />
              New Item
            </motion.button>
          </div>

          {/* Summary Cards */}
          {summary && (
            <div className="grid grid-cols-2 md:grid-cols-6 gap-3 mb-6">
              <motion.div
                whileHover={{ y: -4 }}
                className="p-4 rounded-lg bg-[#111] border border-[#222]"
              >
                <p className="text-xs text-text2 mb-1">Open</p>
                <p className={`text-2xl font-bold ${summary.open > 0 ? "text-red" : "text-text2"}`}>
                  {summary.open}
                </p>
              </motion.div>

              <motion.div
                whileHover={{ y: -4 }}
                className="p-4 rounded-lg bg-[#111] border border-[#222]"
              >
                <p className="text-xs text-text2 mb-1">In Progress</p>
                <p className="text-2xl font-bold text-amber">{summary.in_progress}</p>
              </motion.div>

              <motion.div
                whileHover={{ y: -4 }}
                className="p-4 rounded-lg bg-[#111] border border-[#222]"
              >
                <p className="text-xs text-text2 mb-1">Completed</p>
                <p className="text-2xl font-bold text-blue">{summary.completed}</p>
              </motion.div>

              <motion.div
                whileHover={{ y: -4 }}
                className="p-4 rounded-lg bg-[#111] border border-[#222]"
              >
                <p className="text-xs text-text2 mb-1">Verified</p>
                <p className="text-2xl font-bold text-green">{summary.verified}</p>
              </motion.div>

              <motion.div
                whileHover={{ y: -4 }}
                className="p-4 rounded-lg bg-[#111] border border-[#222]"
              >
                <p className="text-xs text-text2 mb-1">Overdue</p>
                <p className={`text-2xl font-bold ${summary.overdue > 0 ? "text-red" : "text-text2"}`}>
                  {summary.overdue}
                </p>
              </motion.div>

              <motion.div
                whileHover={{ y: -4 }}
                className="p-4 rounded-lg bg-[#111] border border-[#222]"
              >
                <p className="text-xs text-text2 mb-1">Avg Resolution</p>
                <p className="text-2xl font-bold text-text2">
                  {summary.avg_resolution_days ? Math.round(summary.avg_resolution_days) : "-"}d
                </p>
              </motion.div>
            </div>
          )}

          {/* Filters */}
          <div className="flex flex-wrap gap-3">
            <select
              value={filters.community}
              onChange={(e) => setFilters({ ...filters, community: e.target.value })}
              className="px-3 py-2 bg-[#111] border border-[#222] rounded-lg text-sm text-text1 hover:bg-[#1a1a1a] transition-colors"
            >
              <option value="">All Communities</option>
              {summary?.by_community.map((c) => (
                <option key={c.community} value={c.community}>
                  {c.community}
                </option>
              ))}
            </select>

            <select
              value={filters.status}
              onChange={(e) => setFilters({ ...filters, status: e.target.value })}
              className="px-3 py-2 bg-[#111] border border-[#222] rounded-lg text-sm text-text1 hover:bg-[#1a1a1a] transition-colors"
            >
              <option value="">All Statuses</option>
              <option value="open">Open</option>
              <option value="in_progress">In Progress</option>
              <option value="completed">Completed</option>
              <option value="verified">Verified</option>
            </select>

            <select
              value={filters.priority}
              onChange={(e) => setFilters({ ...filters, priority: e.target.value })}
              className="px-3 py-2 bg-[#111] border border-[#222] rounded-lg text-sm text-text1 hover:bg-[#1a1a1a] transition-colors"
            >
              <option value="">All Priorities</option>
              <option value="low">Low</option>
              <option value="medium">Medium</option>
              <option value="high">High</option>
              <option value="critical">Critical</option>
            </select>

            <select
              value={filters.category}
              onChange={(e) => setFilters({ ...filters, category: e.target.value })}
              className="px-3 py-2 bg-[#111] border border-[#222] rounded-lg text-sm text-text1 hover:bg-[#1a1a1a] transition-colors"
            >
              <option value="">All Categories</option>
              {Object.entries(CATEGORIES).map(([key, label]) => (
                <option key={key} value={key}>
                  {label}
                </option>
              ))}
            </select>

            {/* View Toggle */}
            <div className="ml-auto flex gap-2">
              <motion.button
                whileHover={{ scale: 1.05 }}
                whileTap={{ scale: 0.95 }}
                onClick={() => setViewMode("kanban")}
                className={`p-2 rounded-lg transition-colors ${
                  viewMode === "kanban"
                    ? "bg-green-dim text-green"
                    : "text-text2 hover:text-text1"
                }`}
              >
                <LayoutGrid size={20} />
              </motion.button>
              <motion.button
                whileHover={{ scale: 1.05 }}
                whileTap={{ scale: 0.95 }}
                onClick={() => setViewMode("list")}
                className={`p-2 rounded-lg transition-colors ${
                  viewMode === "list"
                    ? "bg-green-dim text-green"
                    : "text-text2 hover:text-text1"
                }`}
              >
                <List size={20} />
              </motion.button>
            </div>
          </div>
        </div>
      </div>

      {/* Content */}
      <div className="max-w-7xl mx-auto px-6 py-8">
        {loading ? (
          <div className="flex items-center justify-center h-64">
            <div className="animate-spin rounded-full h-12 w-12 border border-[#222] border-t-green"></div>
          </div>
        ) : viewMode === "kanban" ? (
          // Kanban View
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
            {statuses.map((status) => (
              <motion.div
                key={status}
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                className={`rounded-lg p-4 min-h-[600px] border-2 ${statusColors[status]}`}
              >
                <div className="flex items-center justify-between mb-4">
                  <h3 className="font-semibold text-text1 flex items-center gap-2">
                    {statusLabels[status]}
                    <span className="px-2 py-0.5 rounded-full bg-white/10 text-xs text-text2">
                      {groupedByStatus[status].length}
                    </span>
                  </h3>
                </div>

                <div className="space-y-3">
                  {groupedByStatus[status].map((item) => (
                    <motion.div
                      key={item.id}
                      whileHover={{ y: -2 }}
                      className="p-3 rounded-lg bg-[#111] border border-[#222] hover:border-[#222] cursor-pointer transition-colors group"
                    >
                      <div className="flex items-start gap-2 mb-2">
                        <div className={`w-2 h-2 rounded-full mt-1 ${PRIORITY_COLORS[item.priority].dot}`}></div>
                        <div className="flex-1">
                          <h4 className="text-sm font-medium text-text1 group-hover:text-green transition-colors">
                            {item.title}
                          </h4>
                          <p className="text-xs text-text2 mt-0.5">
                            {item.community} • Lot {item.lot_number}
                          </p>
                        </div>
                      </div>

                      <div className="flex flex-wrap gap-1 mb-2">
                        <span
                          className={`text-[10px] px-2 py-1 rounded font-medium ${
                            CATEGORY_COLORS[item.category as keyof typeof CATEGORY_COLORS] ||
                            CATEGORY_COLORS.other
                          }`}
                        >
                          {CATEGORIES[item.category as keyof typeof CATEGORIES] || item.category}
                        </span>
                      </div>

                      {item.location && (
                        <p className="text-xs text-text2 mb-2 flex items-center gap-1">
                          <MapPin size={12} />
                          {item.location}
                        </p>
                      )}

                      {item.assigned_to_name && (
                        <p className="text-xs text-text2 mb-2 flex items-center gap-1">
                          <User size={12} />
                          {item.assigned_to_name}
                        </p>
                      )}

                      {item.due_date && (
                        <p className="text-xs text-text2 flex items-center gap-1">
                          <Clock size={12} />
                          {new Date(item.due_date).toLocaleDateString()}
                        </p>
                      )}

                      {/* Quick Actions */}
                      <div className="flex gap-2 mt-3 opacity-0 group-hover:opacity-100 transition-opacity">
                        {status === "open" && (
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              updatePunchItem(item.id, { status: "in_progress" }).then(() => loadData());
                            }}
                            className="text-xs px-2 py-1 rounded bg-amber-dim text-amber hover:bg-amber-dim transition-colors"
                          >
                            Start
                          </button>
                        )}
                        {status === "in_progress" && (
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              handleCompleteItem(item.id);
                            }}
                            className="text-xs px-2 py-1 rounded bg-[rgba(144,191,249,0.12)] text-blue hover:bg-[rgba(144,191,249,0.12)] transition-colors"
                          >
                            Complete
                          </button>
                        )}
                        {status === "completed" && (
                          <>
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                handleVerifyItem(item.id, true);
                              }}
                              className="text-xs px-2 py-1 rounded bg-green-dim text-green hover:bg-green/30 transition-colors"
                            >
                              Verify
                            </button>
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                handleVerifyItem(item.id, false);
                              }}
                              className="text-xs px-2 py-1 rounded bg-red-dim text-red hover:bg-red-dim transition-colors"
                            >
                              Reject
                            </button>
                          </>
                        )}
                      </div>
                    </motion.div>
                  ))}
                </div>
              </motion.div>
            ))}
          </div>
        ) : (
          // List View
          <div className="overflow-x-auto rounded-lg border border-[#222]">
            <table className="w-full text-sm">
              <thead className="bg-[#111] border-b border-[#222]">
                <tr>
                  <th className="px-6 py-3 text-left font-semibold">Title</th>
                  <th className="px-6 py-3 text-left font-semibold">Community</th>
                  <th className="px-6 py-3 text-left font-semibold">Category</th>
                  <th className="px-6 py-3 text-left font-semibold">Priority</th>
                  <th className="px-6 py-3 text-left font-semibold">Status</th>
                  <th className="px-6 py-3 text-left font-semibold">Assigned To</th>
                  <th className="px-6 py-3 text-left font-semibold">Due Date</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/10">
                {items.map((item) => (
                  <motion.tr
                    key={item.id}
                    whileHover={{ backgroundColor: "rgba(255,255,255,0.02)" }}
                    className="hover:bg-white/[0.02] transition-colors"
                  >
                    <td className="px-6 py-4">{item.title}</td>
                    <td className="px-6 py-4 text-text2">{item.community}</td>
                    <td className="px-6 py-4">
                      <span
                        className={`text-[11px] px-2.5 py-1 rounded-full font-medium ${
                          CATEGORY_COLORS[item.category as keyof typeof CATEGORY_COLORS] || CATEGORY_COLORS.other
                        }`}
                      >
                        {CATEGORIES[item.category as keyof typeof CATEGORIES] || item.category}
                      </span>
                    </td>
                    <td className="px-6 py-4">
                      <div className={`flex items-center gap-2 w-fit px-2 py-1 rounded ${PRIORITY_COLORS[item.priority].bg}`}>
                        <div className={`w-2 h-2 rounded-full ${PRIORITY_COLORS[item.priority].dot}`}></div>
                        <span className="text-xs font-medium capitalize">{item.priority}</span>
                      </div>
                    </td>
                    <td className="px-6 py-4">
                      <span className="text-xs px-2.5 py-1 rounded-full bg-white/10 text-text1 capitalize">
                        {item.status.replace("_", " ")}
                      </span>
                    </td>
                    <td className="px-6 py-4 text-text2">{item.assigned_to_name || "-"}</td>
                    <td className="px-6 py-4 text-text2">
                      {item.due_date ? new Date(item.due_date).toLocaleDateString() : "-"}
                    </td>
                  </motion.tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Create/Edit Modal */}
      <AnimatePresence>
        {showModal && (
          <>
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setShowModal(false)}
              className="fixed inset-0 z-50 bg-black/50"
            />
            <motion.div
              initial={{ x: 400, opacity: 0 }}
              animate={{ x: 0, opacity: 1 }}
              exit={{ x: 400, opacity: 0 }}
              className="fixed inset-y-0 right-0 z-50 w-full max-w-md bg-[#0a0a0a] border-l border-[#222] overflow-y-auto"
            >
              <div className="sticky top-0 z-10 bg-[#0a0a0a]/95 backdrop-blur border-b border-[#222] px-6 py-4 flex items-center justify-between">
                <h2 className="text-lg font-semibold">
                  {modalMode === "create" ? "New Punch Item" : "Edit Item"}
                </h2>
                <button
                  onClick={() => setShowModal(false)}
                  className="text-text2 hover:text-text1 transition-colors"
                >
                  <X size={20} />
                </button>
              </div>

              <form onSubmit={handleCreateItem} className="p-6 space-y-4">
                <div>
                  <label className="block text-sm font-medium mb-1">Community</label>
                  <input
                    type="text"
                    value={formData.community || ""}
                    onChange={(e) => setFormData({ ...formData, community: e.target.value })}
                    className="w-full px-3 py-2 rounded-lg bg-[#111] border border-[#222] text-text1 placeholder-text3 focus:border-green outline-none transition-colors"
                    placeholder="Community name"
                    required
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium mb-1">Lot Number</label>
                  <input
                    type="text"
                    value={formData.lot_number || ""}
                    onChange={(e) => setFormData({ ...formData, lot_number: e.target.value })}
                    className="w-full px-3 py-2 rounded-lg bg-[#111] border border-[#222] text-text1 placeholder-text3 focus:border-green outline-none transition-colors"
                    placeholder="Lot number"
                    required
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium mb-1">Location</label>
                  <input
                    type="text"
                    value={formData.location || ""}
                    onChange={(e) => setFormData({ ...formData, location: e.target.value })}
                    className="w-full px-3 py-2 rounded-lg bg-[#111] border border-[#222] text-text1 placeholder-text3 focus:border-green outline-none transition-colors"
                    placeholder="Location (optional)"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium mb-1">Title</label>
                  <input
                    type="text"
                    value={formData.title || ""}
                    onChange={(e) => setFormData({ ...formData, title: e.target.value })}
                    className="w-full px-3 py-2 rounded-lg bg-[#111] border border-[#222] text-text1 placeholder-text3 focus:border-green outline-none transition-colors"
                    placeholder="Item title"
                    required
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium mb-1">Description</label>
                  <textarea
                    value={formData.description || ""}
                    onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                    className="w-full px-3 py-2 rounded-lg bg-[#111] border border-[#222] text-text1 placeholder-text3 focus:border-green outline-none transition-colors resize-none"
                    placeholder="Description"
                    rows={3}
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium mb-1">Category</label>
                  <select
                    value={formData.category || "other"}
                    onChange={(e) => setFormData({ ...formData, category: e.target.value })}
                    className="w-full px-3 py-2 rounded-lg bg-[#111] border border-[#222] text-text1 focus:border-green outline-none transition-colors"
                    required
                  >
                    {Object.entries(CATEGORIES).map(([key, label]) => (
                      <option key={key} value={key}>
                        {label}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-sm font-medium mb-1">Priority</label>
                  <select
                    value={formData.priority || "medium"}
                    onChange={(e) => setFormData({ ...formData, priority: e.target.value as any })}
                    className="w-full px-3 py-2 rounded-lg bg-[#111] border border-[#222] text-text1 focus:border-green outline-none transition-colors"
                    required
                  >
                    <option value="low">Low</option>
                    <option value="medium">Medium</option>
                    <option value="high">High</option>
                    <option value="critical">Critical</option>
                  </select>
                </div>

                <div>
                  <label className="block text-sm font-medium mb-1">Reported By</label>
                  <input
                    type="text"
                    value={formData.reported_by || ""}
                    onChange={(e) => setFormData({ ...formData, reported_by: e.target.value })}
                    className="w-full px-3 py-2 rounded-lg bg-[#111] border border-[#222] text-text1 placeholder-text3 focus:border-green outline-none transition-colors"
                    placeholder="Reporter name"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium mb-1">Builder Name</label>
                  <input
                    type="text"
                    value={formData.builder_name || ""}
                    onChange={(e) => setFormData({ ...formData, builder_name: e.target.value })}
                    className="w-full px-3 py-2 rounded-lg bg-[#111] border border-[#222] text-text1 placeholder-text3 focus:border-green outline-none transition-colors"
                    placeholder="Builder name"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium mb-1">Due Date</label>
                  <input
                    type="date"
                    value={formData.due_date || ""}
                    onChange={(e) => setFormData({ ...formData, due_date: e.target.value })}
                    className="w-full px-3 py-2 rounded-lg bg-[#111] border border-[#222] text-text1 focus:border-green outline-none transition-colors"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium mb-1">Notes</label>
                  <textarea
                    value={formData.resolution_notes || ""}
                    onChange={(e) => setFormData({ ...formData, resolution_notes: e.target.value })}
                    className="w-full px-3 py-2 rounded-lg bg-[#111] border border-[#222] text-text1 placeholder-text3 focus:border-green outline-none transition-colors resize-none"
                    placeholder="Notes"
                    rows={2}
                  />
                </div>

                <button
                  type="submit"
                  className="w-full py-2.5 bg-green hover:bg-green text-text1 font-medium rounded-lg transition-colors mt-6"
                >
                  {modalMode === "create" ? "Create Item" : "Save Changes"}
                </button>
              </form>
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </div>
  );
}
