"use client";

import { useState, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Wrench,
  Calendar,
  Clock,
  User,
  MapPin,
  AlertTriangle,
  CheckCircle2,
  PauseCircle,
  XCircle,
  Plus,
  ChevronRight,
  Filter,
  List,
  CalendarDays,
  ArrowLeft,
  ArrowRight,
} from "lucide-react";
import { WorkOrder, WorkOrderSummary, getWorkOrders, getWorkOrderSummary, getWeekSchedule } from "@/lib/api";
import { LoadingSpinner } from "@/components/LoadingSpinner";

const WORK_TYPES = {
  drywall_hang: "Drywall Hang",
  drywall_finish: "Drywall Finish",
  texture: "Texture",
  prime: "Prime",
  paint: "Paint",
  touch_up: "Touch-up",
  punch_work: "Punch Work",
  warranty: "Warranty",
  repair: "Repair",
  inspection: "Inspection",
  other: "Other",
};

const PRIORITIES = {
  low: { label: "Low", color: "bg-blue-500/20 text-blue-300 border-blue-500/30" },
  normal: { label: "Normal", color: "bg-gray-500/20 text-gray-300 border-gray-500/30" },
  high: { label: "High", color: "bg-amber-500/20 text-amber-300 border-amber-500/30" },
  urgent: { label: "Urgent", color: "bg-red-500/20 text-red-300 border-red-500/30" },
};

const STATUSES = {
  open: { label: "Open", color: "bg-blue-500/20 text-blue-300" },
  assigned: { label: "Assigned", color: "bg-purple-500/20 text-purple-300" },
  in_progress: { label: "In Progress", color: "bg-cyan-500/20 text-cyan-300" },
  on_hold: { label: "On Hold", color: "bg-amber-500/20 text-amber-300" },
  completed: { label: "Completed", color: "bg-emerald-500/20 text-emerald-300" },
  cancelled: { label: "Cancelled", color: "bg-gray-500/20 text-gray-300" },
};

export default function WorkOrdersPage() {
  const [mounted, setMounted] = useState(false);
  const [view, setView] = useState<"list" | "schedule">("list");
  const [orders, setOrders] = useState<WorkOrder[]>([]);
  const [summary, setSummary] = useState<WorkOrderSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [filters, setFilters] = useState({
    community: "",
    status: "",
    priority: "",
    work_type: "",
    assigned_to_id: "",
  });
  const [currentWeek, setCurrentWeek] = useState(getWeekStart(new Date()));
  const [weekSchedule, setWeekSchedule] = useState<{ [key: string]: WorkOrder[] }>({});

  useEffect(() => {
    setMounted(true);
  }, []);

  // Fetch work orders
  useEffect(() => {
    const fetchData = async () => {
      try {
        setLoading(true);
        const [ordersData, summaryData] = await Promise.all([
          getWorkOrders({
            community: filters.community || undefined,
            status: filters.status || undefined,
            priority: filters.priority || undefined,
            work_type: filters.work_type || undefined,
          }),
          getWorkOrderSummary(),
        ]);
        setOrders(ordersData.orders || []);
        setSummary(summaryData);
      } catch (error) {
        console.error("Failed to fetch work orders:", error);
      } finally {
        setLoading(false);
      }
    };

    fetchData();
  }, [filters]);

  // Fetch week schedule
  useEffect(() => {
    const fetchSchedule = async () => {
      try {
        const data = await getWeekSchedule(currentWeek);
        setWeekSchedule(data || {});
      } catch (error) {
        console.error("Failed to fetch week schedule:", error);
      }
    };

    if (view === "schedule") {
      fetchSchedule();
    }
  }, [view, currentWeek]);

  if (!mounted || loading) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <LoadingSpinner />
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-auto bg-[#0C1B2A]">
      {/* Header */}
      <div className="sticky top-0 z-30 bg-[#0C1B2A] border-b border-white/10 backdrop-blur-md">
        <div className="px-6 py-6">
          <div className="flex items-center justify-between mb-6">
            <div className="flex items-center gap-3">
              <Wrench size={28} className="text-emerald-400" />
              <div>
                <h1 className="text-3xl font-bold text-white">Work Orders</h1>
                <p className="text-sm text-gray-400 mt-1">Manage and track construction tasks</p>
              </div>
            </div>
            <button
              onClick={() => setShowCreateModal(true)}
              className="flex items-center gap-2 px-4 py-2 bg-emerald-500 hover:bg-emerald-600 text-black font-medium rounded-lg transition-colors"
            >
              <Plus size={18} />
              New Work Order
            </button>
          </div>

          {/* Summary Cards */}
          {summary && (
            <div className="grid grid-cols-2 md:grid-cols-6 gap-3 mb-6">
              <SummaryCard
                label="Open"
                value={summary.open}
                color="bg-blue-500/20 text-blue-300"
              />
              <SummaryCard
                label="Assigned"
                value={summary.assigned}
                color="bg-purple-500/20 text-purple-300"
              />
              <SummaryCard
                label="In Progress"
                value={summary.in_progress}
                color="bg-cyan-500/20 text-cyan-300"
              />
              <SummaryCard
                label="On Hold"
                value={summary.on_hold}
                color="bg-amber-500/20 text-amber-300"
              />
              <SummaryCard
                label="Completed"
                value={summary.completed}
                color="bg-emerald-500/20 text-emerald-300"
              />
              <SummaryCard
                label="Overdue"
                value={summary.overdue}
                color="bg-red-500/20 text-red-300"
              />
            </div>
          )}

          {/* View Toggle & Filters */}
          <div className="flex items-center gap-4 flex-wrap">
            <div className="flex items-center gap-2 bg-white/5 rounded-lg p-1">
              <button
                onClick={() => setView("list")}
                className={`px-3 py-1.5 rounded transition-colors text-sm font-medium ${
                  view === "list"
                    ? "bg-emerald-500/20 text-emerald-300"
                    : "text-gray-400 hover:text-white"
                }`}
              >
                <List size={16} className="inline mr-1.5" />
                List
              </button>
              <button
                onClick={() => setView("schedule")}
                className={`px-3 py-1.5 rounded transition-colors text-sm font-medium ${
                  view === "schedule"
                    ? "bg-emerald-500/20 text-emerald-300"
                    : "text-gray-400 hover:text-white"
                }`}
              >
                <CalendarDays size={16} className="inline mr-1.5" />
                Schedule
              </button>
            </div>

            <div className="flex items-center gap-2 flex-wrap">
              <FilterSelect
                label="Community"
                value={filters.community}
                onChange={(v) => setFilters({ ...filters, community: v })}
                options={["", ...(summary?.by_community.map((c) => c.community) || [])]}
              />
              <FilterSelect
                label="Status"
                value={filters.status}
                onChange={(v) => setFilters({ ...filters, status: v })}
                options={["", "open", "assigned", "in_progress", "on_hold", "completed", "cancelled"]}
              />
              <FilterSelect
                label="Priority"
                value={filters.priority}
                onChange={(v) => setFilters({ ...filters, priority: v })}
                options={["", "low", "normal", "high", "urgent"]}
              />
              <FilterSelect
                label="Type"
                value={filters.work_type}
                onChange={(v) => setFilters({ ...filters, work_type: v })}
                options={["", ...Object.keys(WORK_TYPES)]}
              />
            </div>
          </div>
        </div>
      </div>

      {/* Content */}
      <div className="p-6">
        {view === "list" ? (
          <ListView orders={orders} expandedId={expandedId} setExpandedId={setExpandedId} />
        ) : (
          <ScheduleView
            weekSchedule={weekSchedule}
            currentWeek={currentWeek}
            onPrevWeek={() => setCurrentWeek(addDays(currentWeek, -7))}
            onNextWeek={() => setCurrentWeek(addDays(currentWeek, 7))}
          />
        )}
      </div>

      {/* Create Modal */}
      <CreateWorkOrderModal open={showCreateModal} onClose={() => setShowCreateModal(false)} />
    </div>
  );
}

function SummaryCard({
  label,
  value,
  color,
}: {
  label: string;
  value: number;
  color: string;
}) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      className={`p-3 rounded-lg border border-white/10 ${color}`}
    >
      <div className="text-xs font-medium opacity-80">{label}</div>
      <div className="text-2xl font-bold mt-1">{value}</div>
    </motion.div>
  );
}

function FilterSelect({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: string[];
}) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="px-3 py-2 rounded-lg bg-white/5 border border-white/10 text-sm text-gray-300 hover:border-white/20 transition-colors focus:outline-none focus:border-emerald-500/50"
    >
      <option value="">{label}</option>
      {options
        .filter((o) => o)
        .map((option) => (
          <option key={option} value={option}>
            {typeof option === "string" && WORK_TYPES[option as keyof typeof WORK_TYPES]
              ? WORK_TYPES[option as keyof typeof WORK_TYPES]
              : option.charAt(0).toUpperCase() + option.slice(1).replace(/_/g, " ")}
          </option>
        ))}
    </select>
  );
}

function ListView({
  orders,
  expandedId,
  setExpandedId,
}: {
  orders: WorkOrder[];
  expandedId: number | null;
  setExpandedId: (id: number | null) => void;
}) {
  return (
    <div className="space-y-3">
      {orders.length === 0 ? (
        <div className="text-center py-12 text-gray-400">
          <Wrench size={48} className="mx-auto mb-4 opacity-50" />
          <p>No work orders found</p>
        </div>
      ) : (
        orders.map((order) => (
          <motion.div
            key={order.id}
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            className="bg-white/5 border border-white/10 rounded-lg overflow-hidden hover:border-white/20 transition-colors"
          >
            {/* Main Row */}
            <button
              onClick={() => setExpandedId(expandedId === order.id ? null : order.id)}
              className="w-full p-4 flex items-center justify-between hover:bg-white/5 transition-colors text-left"
            >
              <div className="flex-1 min-w-0 flex items-center gap-4">
                <div className="flex-1">
                  <h3 className="font-semibold text-white truncate">{order.title}</h3>
                  <div className="flex items-center gap-4 mt-2 text-sm text-gray-400 flex-wrap">
                    <span className="flex items-center gap-1.5">
                      <MapPin size={14} />
                      {order.community}
                      {order.lot_number && ` / Lot ${order.lot_number}`}
                    </span>
                    <span className="px-2 py-1 rounded bg-white/10 text-xs">
                      {WORK_TYPES[order.work_type as keyof typeof WORK_TYPES] || order.work_type}
                    </span>
                  </div>
                </div>
              </div>

              <div className="flex items-center gap-3 ml-4">
                <span className={`px-2 py-1 rounded text-xs font-medium border ${PRIORITIES[order.priority as keyof typeof PRIORITIES].color}`}>
                  {PRIORITIES[order.priority as keyof typeof PRIORITIES].label}
                </span>
                <span className={`px-2 py-1 rounded text-xs font-medium ${STATUSES[order.status as keyof typeof STATUSES].color}`}>
                  {STATUSES[order.status as keyof typeof STATUSES].label}
                </span>
                <motion.div
                  animate={{ rotate: expandedId === order.id ? 90 : 0 }}
                  className="text-gray-400"
                >
                  <ChevronRight size={18} />
                </motion.div>
              </div>
            </button>

            {/* Expanded Details */}
            <AnimatePresence>
              {expandedId === order.id && (
                <motion.div
                  initial={{ opacity: 0, height: 0 }}
                  animate={{ opacity: 1, height: "auto" }}
                  exit={{ opacity: 0, height: 0 }}
                  className="border-t border-white/10 bg-white/2.5 px-4 py-4"
                >
                  <div className="grid md:grid-cols-2 gap-6">
                    <div className="space-y-3">
                      <DetailRow label="Assigned To" value={order.assigned_to_name || "Unassigned"} />
                      <DetailRow label="Created By" value={order.created_by_name || "Unknown"} />
                      <DetailRow label="Scheduled" value={order.scheduled_date ? formatDate(order.scheduled_date) : "Not scheduled"} />
                      <DetailRow label="Due Date" value={order.due_date ? formatDate(order.due_date) : "No due date"} />
                    </div>
                    <div className="space-y-3">
                      <DetailRow label="Est. Hours" value={order.estimated_hours ? `${order.estimated_hours}h` : "-"} />
                      <DetailRow label="Actual Hours" value={order.actual_hours ? `${order.actual_hours}h` : "-"} />
                      <DetailRow label="Crew Size" value={order.crew_size_needed ? `${order.crew_size_needed} people` : "-"} />
                      <DetailRow label="Est. Cost" value={order.estimated_cost ? `$${order.estimated_cost.toLocaleString()}` : "-"} />
                    </div>
                  </div>

                  {order.description && (
                    <div className="mt-4 pt-4 border-t border-white/10">
                      <p className="text-xs text-gray-400 font-medium mb-2">Description</p>
                      <p className="text-sm text-gray-300">{order.description}</p>
                    </div>
                  )}

                  {order.completion_notes && (
                    <div className="mt-4 pt-4 border-t border-white/10">
                      <p className="text-xs text-gray-400 font-medium mb-2">Completion Notes</p>
                      <p className="text-sm text-gray-300">{order.completion_notes}</p>
                    </div>
                  )}

                  <div className="mt-4 pt-4 border-t border-white/10 flex gap-2 flex-wrap">
                    <QuickActionButton icon={<User size={14} />} label="Assign" />
                    <QuickActionButton icon={<Clock size={14} />} label="Start" />
                    <QuickActionButton icon={<CheckCircle2 size={14} />} label="Complete" />
                    <QuickActionButton icon={<PauseCircle size={14} />} label="Hold" />
                    <QuickActionButton icon={<XCircle size={14} />} label="Cancel" variant="danger" />
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </motion.div>
        ))
      )}
    </div>
  );
}

function DetailRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between items-start gap-2">
      <span className="text-xs text-gray-500 font-medium">{label}</span>
      <span className="text-sm text-gray-300 text-right">{value}</span>
    </div>
  );
}

function QuickActionButton({
  icon,
  label,
  variant = "default",
}: {
  icon: React.ReactNode;
  label: string;
  variant?: "default" | "danger";
}) {
  return (
    <button
      className={`flex items-center gap-1.5 px-3 py-1.5 rounded text-xs font-medium transition-colors ${
        variant === "danger"
          ? "bg-red-500/20 text-red-300 hover:bg-red-500/30"
          : "bg-emerald-500/20 text-emerald-300 hover:bg-emerald-500/30"
      }`}
    >
      {icon}
      {label}
    </button>
  );
}

function ScheduleView({
  weekSchedule,
  currentWeek,
  onPrevWeek,
  onNextWeek,
}: {
  weekSchedule: { [key: string]: WorkOrder[] };
  currentWeek: string;
  onPrevWeek: () => void;
  onNextWeek: () => void;
}) {
  const days = generateWeekDays(currentWeek);
  const today = new Date().toISOString().split("T")[0];

  return (
    <div>
      {/* Week Navigation */}
      <div className="flex items-center justify-between mb-6">
        <button
          onClick={onPrevWeek}
          className="p-2 hover:bg-white/10 rounded-lg transition-colors text-gray-400"
        >
          <ArrowLeft size={20} />
        </button>
        <div className="text-center">
          <p className="text-sm text-gray-400">
            {formatDate(days[0])} - {formatDate(days[6])}
          </p>
        </div>
        <button
          onClick={onNextWeek}
          className="p-2 hover:bg-white/10 rounded-lg transition-colors text-gray-400"
        >
          <ArrowRight size={20} />
        </button>
      </div>

      {/* Week Grid */}
      <div className="grid grid-cols-1 md:grid-cols-7 gap-4">
        {days.map((day, idx) => {
          const dayOrders = weekSchedule[day] || [];
          const isToday = day === today;
          const dayName = new Date(day + "T00:00:00").toLocaleDateString("en-US", { weekday: "short" });

          return (
            <motion.div
              key={day}
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: idx * 0.05 }}
              className={`rounded-lg border-2 p-4 min-h-[400px] flex flex-col ${
                isToday
                  ? "border-emerald-500/50 bg-emerald-500/10"
                  : "border-white/10 bg-white/5"
              }`}
            >
              <div className="mb-4">
                <p className="text-xs text-gray-500 font-medium uppercase">{dayName}</p>
                <p className={`text-lg font-bold ${isToday ? "text-emerald-300" : "text-white"}`}>
                  {new Date(day + "T00:00:00").getDate()}
                </p>
              </div>

              <div className="flex-1 space-y-2">
                {dayOrders.length === 0 ? (
                  <div className="text-center text-gray-500 text-xs py-8">No orders scheduled</div>
                ) : (
                  dayOrders.map((order) => (
                    <motion.div
                      key={order.id}
                      initial={{ opacity: 0, scale: 0.9 }}
                      animate={{ opacity: 1, scale: 1 }}
                      className={`p-2 rounded text-xs border ${
                        order.priority === "urgent"
                          ? "bg-red-500/20 text-red-200 border-red-500/30"
                          : order.priority === "high"
                            ? "bg-amber-500/20 text-amber-200 border-amber-500/30"
                            : order.priority === "normal"
                              ? "bg-purple-500/20 text-purple-200 border-purple-500/30"
                              : "bg-blue-500/20 text-blue-200 border-blue-500/30"
                      }`}
                    >
                      <p className="font-medium truncate">{order.title}</p>
                      <p className="text-[10px] opacity-75 mt-0.5">{order.community}</p>
                    </motion.div>
                  ))
                )}
              </div>
            </motion.div>
          );
        })}
      </div>
    </div>
  );
}

function CreateWorkOrderModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [formData, setFormData] = useState({
    title: "",
    description: "",
    community: "",
    lot_number: "",
    work_type: "drywall_hang",
    priority: "normal",
    scheduled_date: "",
    due_date: "",
    estimated_hours: "",
    crew_size_needed: "",
    estimated_cost: "",
    builder_name: "",
    builder_contact: "",
  });

  return (
    <AnimatePresence>
      {open && (
        <>
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
            className="fixed inset-0 bg-black/60 backdrop-blur-sm z-40"
          />
          <motion.div
            initial={{ opacity: 0, x: 400 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: 400 }}
            className="fixed right-0 top-0 h-full w-full max-w-md bg-[#0C1B2A] border-l border-white/10 z-50 overflow-y-auto"
          >
            <div className="p-6">
              <div className="flex items-center justify-between mb-6">
                <h2 className="text-2xl font-bold text-white">New Work Order</h2>
                <button
                  onClick={onClose}
                  className="text-gray-400 hover:text-white transition-colors"
                >
                  <XCircle size={24} />
                </button>
              </div>

              <form className="space-y-4">
                <FormField
                  label="Title"
                  value={formData.title}
                  onChange={(v) => setFormData({ ...formData, title: v })}
                  placeholder="Enter work order title"
                />

                <FormField
                  label="Description"
                  value={formData.description}
                  onChange={(v) => setFormData({ ...formData, description: v })}
                  placeholder="Add details..."
                  type="textarea"
                />

                <div className="grid grid-cols-2 gap-4">
                  <FormField
                    label="Community"
                    value={formData.community}
                    onChange={(v) => setFormData({ ...formData, community: v })}
                    placeholder="Community name"
                  />
                  <FormField
                    label="Lot Number"
                    value={formData.lot_number}
                    onChange={(v) => setFormData({ ...formData, lot_number: v })}
                    placeholder="Lot #"
                  />
                </div>

                <FormSelect
                  label="Work Type"
                  value={formData.work_type}
                  onChange={(v) => setFormData({ ...formData, work_type: v })}
                  options={Object.entries(WORK_TYPES).map(([key, label]) => ({
                    value: key,
                    label,
                  }))}
                />

                <FormSelect
                  label="Priority"
                  value={formData.priority}
                  onChange={(v) => setFormData({ ...formData, priority: v })}
                  options={[
                    { value: "low", label: "Low" },
                    { value: "normal", label: "Normal" },
                    { value: "high", label: "High" },
                    { value: "urgent", label: "Urgent" },
                  ]}
                />

                <div className="grid grid-cols-2 gap-4">
                  <FormField
                    label="Scheduled Date"
                    value={formData.scheduled_date}
                    onChange={(v) => setFormData({ ...formData, scheduled_date: v })}
                    type="date"
                  />
                  <FormField
                    label="Due Date"
                    value={formData.due_date}
                    onChange={(v) => setFormData({ ...formData, due_date: v })}
                    type="date"
                  />
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <FormField
                    label="Est. Hours"
                    value={formData.estimated_hours}
                    onChange={(v) => setFormData({ ...formData, estimated_hours: v })}
                    type="number"
                    placeholder="Hours"
                  />
                  <FormField
                    label="Crew Size"
                    value={formData.crew_size_needed}
                    onChange={(v) => setFormData({ ...formData, crew_size_needed: v })}
                    type="number"
                    placeholder="People"
                  />
                </div>

                <FormField
                  label="Est. Cost"
                  value={formData.estimated_cost}
                  onChange={(v) => setFormData({ ...formData, estimated_cost: v })}
                  type="number"
                  placeholder="$0.00"
                />

                <div className="grid grid-cols-2 gap-4">
                  <FormField
                    label="Builder Name"
                    value={formData.builder_name}
                    onChange={(v) => setFormData({ ...formData, builder_name: v })}
                    placeholder="Builder"
                  />
                  <FormField
                    label="Builder Contact"
                    value={formData.builder_contact}
                    onChange={(v) => setFormData({ ...formData, builder_contact: v })}
                    placeholder="Email/Phone"
                  />
                </div>

                <div className="flex gap-3 pt-4">
                  <button
                    type="button"
                    onClick={onClose}
                    className="flex-1 px-4 py-2 rounded-lg border border-white/20 text-white hover:bg-white/5 transition-colors"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    className="flex-1 px-4 py-2 rounded-lg bg-emerald-500 hover:bg-emerald-600 text-black font-medium transition-colors"
                  >
                    Create
                  </button>
                </div>
              </form>
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}

function FormField({
  label,
  value,
  onChange,
  placeholder,
  type = "text",
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  type?: string;
}) {
  return (
    <div>
      <label className="block text-xs font-medium text-gray-300 mb-2">{label}</label>
      {type === "textarea" ? (
        <textarea
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          className="w-full px-3 py-2 rounded-lg bg-white/5 border border-white/10 text-white placeholder-gray-500 focus:outline-none focus:border-emerald-500/50 transition-colors"
          rows={3}
        />
      ) : (
        <input
          type={type}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          className="w-full px-3 py-2 rounded-lg bg-white/5 border border-white/10 text-white placeholder-gray-500 focus:outline-none focus:border-emerald-500/50 transition-colors"
        />
      )}
    </div>
  );
}

function FormSelect({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: { value: string; label: string }[];
}) {
  return (
    <div>
      <label className="block text-xs font-medium text-gray-300 mb-2">{label}</label>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full px-3 py-2 rounded-lg bg-white/5 border border-white/10 text-white focus:outline-none focus:border-emerald-500/50 transition-colors"
      >
        {options.map((opt) => (
          <option key={opt.value} value={opt.value}>
            {opt.label}
          </option>
        ))}
      </select>
    </div>
  );
}

// Utility functions
function getWeekStart(date: Date): string {
  const d = new Date(date);
  const day = d.getDay();
  const diff = d.getDate() - day + (day === 0 ? -6 : 1);
  return new Date(d.setDate(diff)).toISOString().split("T")[0];
}

function addDays(dateStr: string, days: number): string {
  const date = new Date(dateStr + "T00:00:00");
  date.setDate(date.getDate() + days);
  return date.toISOString().split("T")[0];
}

function generateWeekDays(weekStart: string): string[] {
  const days = [];
  for (let i = 0; i < 7; i++) {
    days.push(addDays(weekStart, i));
  }
  return days;
}

function formatDate(dateStr: string): string {
  return new Date(dateStr + "T00:00:00").toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
  });
}
