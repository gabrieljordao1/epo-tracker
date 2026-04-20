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
import { WorkOrder, WorkOrderSummary } from "@/lib/api";
import { LoadingSpinner } from "@/components/LoadingSpinner";
import {
  useGetWorkOrders,
  useGetWorkOrderSummary,
  useGetWeekSchedule,
} from "@/hooks/useWorkOrders";

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
  low: { label: "Low", color: "bg-[rgba(144,191,249,0.12)] text-blue border-[rgba(144,191,249,0.3)]" },
  normal: { label: "Normal", color: "bg-[#1a1a1a] text-text2 border-[#222]" },
  high: { label: "High", color: "bg-amber-dim text-amber border-amber-bdr" },
  urgent: { label: "Urgent", color: "bg-red-dim text-red border-red-bdr" },
};

const STATUSES = {
  open: { label: "Open", color: "bg-[rgba(144,191,249,0.12)] text-blue" },
  assigned: { label: "Assigned", color: "bg-[rgba(192,160,255,0.12)] text-purple" },
  in_progress: { label: "In Progress", color: "bg-[rgba(144,191,249,0.12)] text-blue" },
  on_hold: { label: "On Hold", color: "bg-amber-dim text-amber" },
  completed: { label: "Completed", color: "bg-green-dim text-green" },
  cancelled: { label: "Cancelled", color: "bg-[#1a1a1a] text-text2" },
};

export default function WorkOrdersPage() {
  const [mounted, setMounted] = useState(false);
  const [view, setView] = useState<"list" | "schedule">("list");
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

  useEffect(() => {
    setMounted(true);
  }, []);

  // React Query hooks
  const workOrdersQuery = useGetWorkOrders({
    community: filters.community || undefined,
    status: filters.status || undefined,
    priority: filters.priority || undefined,
    work_type: filters.work_type || undefined,
  });

  const summaryQuery = useGetWorkOrderSummary();

  const scheduleQuery = useGetWeekSchedule(view === "schedule" ? currentWeek : undefined);

  const orders = workOrdersQuery.data?.orders || [];
  const summary = summaryQuery.data || null;
  const weekSchedule = scheduleQuery.data || {};
  const loading = workOrdersQuery.isLoading || summaryQuery.isLoading;

  if (!mounted || loading) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <LoadingSpinner />
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-auto">
      {/* Header */}
      <div className="sticky top-0 z-30 border-b border-[#222] backdrop-blur-md">
        <div className="px-6 py-6">
          <div className="flex items-center justify-between mb-6">
            <div className="flex items-center gap-3">
              <Wrench size={28} className="text-green" />
              <div>
                <h1 className="text-3xl font-bold text-text1">Work Orders</h1>
                <p className="text-sm text-text2 mt-1">Manage and track construction tasks</p>
              </div>
            </div>
            <button
              onClick={() => setShowCreateModal(true)}
              className="flex items-center gap-2 px-4 py-2 bg-green hover:bg-green text-black font-medium rounded-lg transition-colors"
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
                color="bg-[rgba(144,191,249,0.12)] text-blue"
              />
              <SummaryCard
                label="Assigned"
                value={summary.assigned}
                color="bg-[rgba(192,160,255,0.12)] text-purple"
              />
              <SummaryCard
                label="In Progress"
                value={summary.in_progress}
                color="bg-[rgba(144,191,249,0.12)] text-blue"
              />
              <SummaryCard
                label="On Hold"
                value={summary.on_hold}
                color="bg-amber-dim text-amber"
              />
              <SummaryCard
                label="Completed"
                value={summary.completed}
                color="bg-green-dim text-green"
              />
              <SummaryCard
                label="Overdue"
                value={summary.overdue}
                color="bg-red-dim text-red"
              />
            </div>
          )}

          {/* View Toggle & Filters */}
          <div className="flex items-center gap-4 flex-wrap">
            <div className="flex items-center gap-2 bg-[#111] rounded-lg p-1">
              <button
                onClick={() => setView("list")}
                className={`px-3 py-1.5 rounded transition-colors text-sm font-medium ${
                  view === "list"
                    ? "bg-green-dim text-green"
                    : "text-text2 hover:text-text1"
                }`}
              >
                <List size={16} className="inline mr-1.5" />
                List
              </button>
              <button
                onClick={() => setView("schedule")}
                className={`px-3 py-1.5 rounded transition-colors text-sm font-medium ${
                  view === "schedule"
                    ? "bg-green-dim text-green"
                    : "text-text2 hover:text-text1"
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
      className={`p-3 rounded-lg border border-[#222] ${color}`}
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
      className="px-3 py-2 rounded-lg bg-[#111] border border-[#222] text-sm text-text2 hover:border-white/20 transition-colors focus:outline-none focus:border-green/50"
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
        <div className="text-center py-12 text-text2">
          <Wrench size={48} className="mx-auto mb-4 opacity-50" />
          <p>No work orders found</p>
        </div>
      ) : (
        orders.map((order) => (
          <motion.div
            key={order.id}
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            className="bg-[#111] border border-[#222] rounded-lg overflow-hidden hover:border-white/20 transition-colors"
          >
            {/* Main Row */}
            <button
              onClick={() => setExpandedId(expandedId === order.id ? null : order.id)}
              className="w-full p-4 flex items-center justify-between hover:bg-surface transition-colors text-left"
            >
              <div className="flex-1 min-w-0 flex items-center gap-4">
                <div className="flex-1">
                  <h3 className="font-semibold text-text1 truncate">{order.title}</h3>
                  <div className="flex items-center gap-4 mt-2 text-sm text-text2 flex-wrap">
                    <span className="flex items-center gap-1.5">
                      <MapPin size={14} />
                      {order.community}
                      {order.lot_number && ` / Lot ${order.lot_number}`}
                    </span>
                    <span className="px-2 py-1 rounded bg-[#1a1a1a] text-xs">
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
                  className="text-text2"
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
                  className="border-t border-[#222] bg-surface px-4 py-4"
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
                    <div className="mt-4 pt-4 border-t border-[#222]">
                      <p className="text-xs text-text2 font-medium mb-2">Description</p>
                      <p className="text-sm text-text2">{order.description}</p>
                    </div>
                  )}

                  {order.completion_notes && (
                    <div className="mt-4 pt-4 border-t border-[#222]">
                      <p className="text-xs text-text2 font-medium mb-2">Completion Notes</p>
                      <p className="text-sm text-text2">{order.completion_notes}</p>
                    </div>
                  )}

                  <div className="mt-4 pt-4 border-t border-[#222] flex gap-2 flex-wrap">
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
      <span className="text-xs text-text3 font-medium">{label}</span>
      <span className="text-sm text-text2 text-right">{value}</span>
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
          ? "bg-red-dim text-red hover:bg-red-dim"
          : "bg-green-dim text-green hover:bg-green-dim"
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
          className="p-2 hover:bg-[#1a1a1a] rounded-lg transition-colors text-text2"
        >
          <ArrowLeft size={20} />
        </button>
        <div className="text-center">
          <p className="text-sm text-text2">
            {formatDate(days[0])} - {formatDate(days[6])}
          </p>
        </div>
        <button
          onClick={onNextWeek}
          className="p-2 hover:bg-[#1a1a1a] rounded-lg transition-colors text-text2"
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
                  ? "border-green/50 bg-green-dim"
                  : "border-[#222] bg-[#111]"
              }`}
            >
              <div className="mb-4">
                <p className="text-xs text-text3 font-medium uppercase">{dayName}</p>
                <p className={`text-lg font-bold ${isToday ? "text-green" : "text-text1"}`}>
                  {new Date(day + "T00:00:00").getDate()}
                </p>
              </div>

              <div className="flex-1 space-y-2">
                {dayOrders.length === 0 ? (
                  <div className="text-center text-text3 text-xs py-8">No orders scheduled</div>
                ) : (
                  dayOrders.map((order) => (
                    <motion.div
                      key={order.id}
                      initial={{ opacity: 0, scale: 0.9 }}
                      animate={{ opacity: 1, scale: 1 }}
                      className={`p-2 rounded text-xs border ${
                        order.priority === "urgent"
                          ? "bg-red-dim text-red border-red-bdr"
                          : order.priority === "high"
                            ? "bg-amber-dim text-amber border-amber-bdr"
                            : order.priority === "normal"
                              ? "bg-[rgba(192,160,255,0.12)] text-purple border-[rgba(192,160,255,0.3)]"
                              : "bg-[rgba(144,191,249,0.12)] text-blue border-[rgba(144,191,249,0.3)]"
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
            className="fixed right-0 top-0 h-full w-full max-w-md border-l border-[#222] z-50 overflow-y-auto"
          >
            <div className="p-6">
              <div className="flex items-center justify-between mb-6">
                <h2 className="text-2xl font-bold text-text1">New Work Order</h2>
                <button
                  onClick={onClose}
                  className="text-text2 hover:text-text1 transition-colors"
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
                    className="flex-1 px-4 py-2 rounded-lg border border-[#222] text-text1 hover:bg-[#1a1a1a] transition-colors"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    className="flex-1 px-4 py-2 rounded-lg bg-green hover:bg-green text-black font-medium transition-colors"
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
      <label className="block text-xs font-medium text-text2 mb-2">{label}</label>
      {type === "textarea" ? (
        <textarea
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          className="w-full px-3 py-2 rounded-lg bg-[#111] border border-[#222] text-text1 placeholder-text3 focus:outline-none focus:border-green/50 transition-colors"
          rows={3}
        />
      ) : (
        <input
          type={type}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          className="w-full px-3 py-2 rounded-lg bg-[#111] border border-[#222] text-text1 placeholder-text3 focus:outline-none focus:border-green/50 transition-colors"
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
      <label className="block text-xs font-medium text-text2 mb-2">{label}</label>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full px-3 py-2 rounded-lg bg-[#111] border border-[#222] text-text1 focus:outline-none focus:border-green/50 transition-colors"
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
