"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  getDailyReports,
  getDailyReportSummary,
  getDailyReport,
  createDailyReport,
  updateDailyReport,
  submitDailyReport,
  deleteDailyReport,
  type DailyReport,
  type DailyReportSummary,
} from "@/lib/api";
import {
  Plus,
  BarChart3,
  Users,
  Clock,
  AlertTriangle,
  Sun,
  Cloud,
  CloudRain,
  CloudLightning,
  Snowflake,
  Wind,
  Thermometer,
  ChevronDown,
  X,
  Save,
  Send,
  Edit2,
  Trash2,
  Calendar,
  MapPin,
  FileText,
  Gauge,
  Construction,
  Loader2,
} from "lucide-react";

// ─── Helper Functions ───────────────────────────
const formatDate = (dateStr: string): string => {
  const date = new Date(dateStr);
  return date.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
};

const formatDateForInput = (dateStr: string): string => {
  const date = new Date(dateStr);
  return date.toISOString().split("T")[0];
};

const getWeatherIcon = (weather: string | null) => {
  if (!weather) return null;
  const w = weather.toLowerCase();
  const iconProps = { size: 16, className: "text-green" };
  if (w.includes("sun")) return <Sun {...iconProps} />;
  if (w.includes("cloud") && !w.includes("rain")) return <Cloud {...iconProps} />;
  if (w.includes("rain")) return <CloudRain {...iconProps} />;
  if (w.includes("thunder") || w.includes("lightning")) return <CloudLightning {...iconProps} />;
  if (w.includes("snow")) return <Snowflake {...iconProps} />;
  if (w.includes("wind")) return <Wind {...iconProps} />;
  return <Thermometer {...iconProps} />;
};

const containerVariants = {
  hidden: { opacity: 0 },
  visible: {
    opacity: 1,
    transition: {
      staggerChildren: 0.05,
      delayChildren: 0.1,
    },
  },
};

const itemVariants = {
  hidden: { opacity: 0, y: 10 },
  visible: {
    opacity: 1,
    y: 0,
    transition: { duration: 0.3 },
  },
};

// ─── Summary Cards ──────────────────────────────
interface SummaryCardProps {
  title: string;
  value: number;
  icon: React.ReactNode;
  trend?: string;
  highlight?: boolean;
  subtitle?: string;
}

function SummaryCard({
  title,
  value,
  icon,
  trend,
  highlight,
  subtitle,
}: SummaryCardProps) {
  return (
    <motion.div
      variants={itemVariants}
      className={`rounded-xl border p-6 backdrop-blur-sm ${
        highlight
          ? "bg-red-dim border-red-bdr"
          : "bg-[#111] border-[#222]"
      }`}
    >
      <div className="flex items-start justify-between">
        <div>
          <p className="text-xs font-medium text-text2 uppercase tracking-wide">
            {title}
          </p>
          <p className={`text-3xl font-bold mt-2 ${highlight ? "text-red" : "text-text1"}`}>
            {value}
          </p>
          {subtitle && (
            <p className="text-xs text-text3 mt-1">{subtitle}</p>
          )}
          {trend && (
            <p className="text-xs text-green mt-2 font-medium">{trend}</p>
          )}
        </div>
        <div
          className={`p-3 rounded-lg ${
            highlight
              ? "bg-red-dim text-red"
              : "bg-green-dim text-green"
          }`}
        >
          {icon}
        </div>
      </div>
    </motion.div>
  );
}

// ─── Main Page Component ────────────────────────
export default function DailyReportsPage() {
  const [mounted, setMounted] = useState(false);
  const [loading, setLoading] = useState(true);
  const [summary, setSummary] = useState<DailyReportSummary | null>(null);
  const [reports, setReports] = useState<DailyReport[]>([]);
  const [expandedReportId, setExpandedReportId] = useState<number | null>(null);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingReport, setEditingReport] = useState<DailyReport | null>(null);

  // Filters
  const [communityFilter, setCommunityFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState<"all" | "draft" | "submitted">(
    "all"
  );
  const [dateFromFilter, setDateFromFilter] = useState("");
  const [dateToFilter, setDateToFilter] = useState("");

  // Form state
  const [formData, setFormData] = useState<Partial<DailyReport>>({
    report_date: new Date().toISOString().split("T")[0],
    community: "",
    phase: "",
    crew_size: undefined,
    crew_hours: undefined,
    units_completed: undefined,
    percent_complete: 0,
    weather: "",
    temperature_high: undefined,
    work_delayed: false,
    safety_incidents: false,
  });

  // Load data
  useEffect(() => {
    setMounted(true);
    fetchData();
  }, []);

  const fetchData = useCallback(async () => {
    try {
      setLoading(true);
      const [summaryData, reportsData] = await Promise.all([
        getDailyReportSummary(),
        getDailyReports({
          community: communityFilter || undefined,
          status: statusFilter !== "all" ? statusFilter : undefined,
          date_from: dateFromFilter || undefined,
          date_to: dateToFilter || undefined,
        }),
      ]);
      setSummary(summaryData);
      setReports(reportsData.reports);
    } catch (error) {
      console.error("Failed to load daily reports:", error);
    } finally {
      setLoading(false);
    }
  }, [communityFilter, statusFilter, dateFromFilter, dateToFilter]);

  // Refetch when filters change
  useEffect(() => {
    if (mounted) {
      fetchData();
    }
  }, [communityFilter, statusFilter, dateFromFilter, dateToFilter, fetchData]);

  const handleCreateNew = () => {
    setEditingReport(null);
    setFormData({
      report_date: new Date().toISOString().split("T")[0],
      community: "",
      phase: "",
      crew_size: undefined,
      crew_hours: undefined,
      units_completed: undefined,
      percent_complete: 0,
      weather: "",
      temperature_high: undefined,
      work_delayed: false,
      safety_incidents: false,
    });
    setIsModalOpen(true);
  };

  const handleEdit = (report: DailyReport) => {
    setEditingReport(report);
    setFormData(report);
    setIsModalOpen(true);
  };

  const handleSaveAsDraft = async () => {
    try {
      if (editingReport) {
        await updateDailyReport(editingReport.id, formData);
      } else {
        await createDailyReport({ ...formData, status: "draft" });
      }
      setIsModalOpen(false);
      fetchData();
    } catch (error) {
      console.error("Failed to save report:", error);
    }
  };

  const handleSubmit = async () => {
    try {
      if (editingReport) {
        await updateDailyReport(editingReport.id, formData);
        await submitDailyReport(editingReport.id);
      } else {
        const report = await createDailyReport({
          ...formData,
          status: "draft",
        });
        await submitDailyReport(report.id);
      }
      setIsModalOpen(false);
      fetchData();
    } catch (error) {
      console.error("Failed to submit report:", error);
    }
  };

  const handleDelete = async (id: number) => {
    if (!confirm("Delete this report?")) return;
    try {
      await deleteDailyReport(id);
      fetchData();
    } catch (error) {
      console.error("Failed to delete report:", error);
    }
  };

  if (!mounted) return null;

  return (
    <div className="flex-1 min-h-screen overflow-auto">
      {/* Header */}
      <motion.div
        initial={{ opacity: 0, y: -20 }}
        animate={{ opacity: 1, y: 0 }}
        className="sticky top-0 z-30 border-b border-[#222] bg-[#0a0a0a]/95 backdrop-blur-sm"
      >
        <div className="px-8 py-6">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-3xl font-bold text-text1">Daily Field Reports</h1>
              <p className="text-text2 text-sm mt-1">
                Track crew work, materials, and safety incidents
              </p>
            </div>
            <motion.button
              whileHover={{ scale: 1.02 }}
              whileTap={{ scale: 0.98 }}
              onClick={handleCreateNew}
              className="flex items-center gap-2 px-4 py-2 bg-green-dim border border-green-bdr text-green rounded-lg hover:bg-green-dim transition-colors"
            >
              <Plus size={18} />
              <span className="font-medium">New Report</span>
            </motion.button>
          </div>
        </div>
      </motion.div>

      {/* Content */}
      <div className="px-8 py-8 max-w-7xl mx-auto">
        {/* Summary Cards */}
        {summary && (
          <motion.div
            variants={containerVariants}
            initial="hidden"
            animate="visible"
            className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-4 mb-8"
          >
            <SummaryCard
              title="Reports This Week"
              value={summary.reports_this_week}
              icon={<FileText size={24} />}
            />
            <SummaryCard
              title="Active Communities"
              value={summary.active_communities}
              icon={<MapPin size={24} />}
            />
            <SummaryCard
              title="Crew Hours This Week"
              value={Math.round(summary.total_crew_hours_this_week)}
              icon={<Clock size={24} />}
            />
            <SummaryCard
              title="Avg Crew Size"
              value={Math.round(summary.avg_crew_size)}
              icon={<Users size={24} />}
            />
            <SummaryCard
              title="Safety Incidents"
              value={summary.safety_incidents_this_month}
              icon={<AlertTriangle size={24} />}
              highlight={summary.safety_incidents_this_month > 0}
              subtitle="this month"
            />
          </motion.div>
        )}

        {/* Filters */}
        <motion.div
          variants={itemVariants}
          initial="hidden"
          animate="visible"
          className="bg-[#111] border border-[#222] rounded-xl p-6 mb-8 backdrop-blur-sm"
        >
          <h3 className="text-sm font-semibold text-text1 mb-4">Filters</h3>
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
            <input
              type="text"
              placeholder="Community"
              value={communityFilter}
              onChange={(e) => setCommunityFilter(e.target.value)}
              className="px-3 py-2 bg-[#111] border border-[#222] rounded-lg text-text1 placeholder-text3 text-sm focus:outline-none focus:ring-2 focus:ring-green/50"
            />
            <input
              type="date"
              value={dateFromFilter}
              onChange={(e) => setDateFromFilter(e.target.value)}
              className="px-3 py-2 bg-[#111] border border-[#222] rounded-lg text-text1 placeholder-text3 text-sm focus:outline-none focus:ring-2 focus:ring-green/50"
            />
            <input
              type="date"
              value={dateToFilter}
              onChange={(e) => setDateToFilter(e.target.value)}
              className="px-3 py-2 bg-[#111] border border-[#222] rounded-lg text-text1 placeholder-text3 text-sm focus:outline-none focus:ring-2 focus:ring-green/50"
            />
            <select
              value={statusFilter}
              onChange={(e) =>
                setStatusFilter(e.target.value as "all" | "draft" | "submitted")
              }
              className="px-3 py-2 bg-[#111] border border-[#222] rounded-lg text-text1 text-sm focus:outline-none focus:ring-2 focus:ring-green/50"
            >
              <option value="all">All Status</option>
              <option value="draft">Draft</option>
              <option value="submitted">Submitted</option>
            </select>
          </div>
        </motion.div>

        {/* Reports List */}
        {loading ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="w-8 h-8 text-green animate-spin" />
          </div>
        ) : reports.length === 0 ? (
          <motion.div
            variants={itemVariants}
            className="bg-[#111] border border-[#222] rounded-xl p-12 text-center backdrop-blur-sm"
          >
            <FileText className="w-12 h-12 text-text3 mx-auto mb-4" />
            <p className="text-text2 mb-4">No reports found</p>
            <button
              onClick={handleCreateNew}
              className="inline-flex items-center gap-2 px-4 py-2 bg-green-dim border border-green-bdr text-green rounded-lg hover:bg-green-dim transition-colors"
            >
              <Plus size={16} />
              Create your first report
            </button>
          </motion.div>
        ) : (
          <motion.div
            variants={containerVariants}
            initial="hidden"
            animate="visible"
            className="space-y-4"
          >
            {reports.map((report) => {
              const isExpanded = expandedReportId === report.id;
              return (
                <motion.div
                  key={report.id}
                  variants={itemVariants}
                  className="bg-[#111] border border-[#222] rounded-xl overflow-hidden backdrop-blur-sm hover:bg-surface transition-colors"
                >
                  {/* Card Header - Always Visible */}
                  <button
                    onClick={() =>
                      setExpandedReportId(isExpanded ? null : report.id)
                    }
                    className="w-full text-left p-6 focus:outline-none"
                  >
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4 items-start mb-4">
                      <div>
                        <div className="flex items-center gap-3 mb-3">
                          <Calendar size={16} className="text-green" />
                          <span className="font-semibold text-text1">
                            {formatDate(report.report_date)}
                          </span>
                          <span
                            className={`px-2 py-1 text-xs font-medium rounded-full ${
                              report.status === "submitted"
                                ? "bg-green-dim text-green"
                                : "bg-amber-dim text-amber"
                            }`}
                          >
                            {report.status === "submitted"
                              ? "Submitted"
                              : "Draft"}
                          </span>
                        </div>
                        <div className="space-y-2">
                          <p className="text-sm text-text2">
                            <span className="text-text3">Community:</span>{" "}
                            {report.community}
                          </p>
                          {report.lot_number && (
                            <p className="text-sm text-text2">
                              <span className="text-text3">Lot:</span>{" "}
                              {report.lot_number}
                            </p>
                          )}
                        </div>
                      </div>

                      <div className="space-y-3">
                        {report.phase && (
                          <div className="flex items-center gap-2">
                            <Construction size={16} className="text-green" />
                            <span className="text-sm text-text2">
                              {report.phase}
                            </span>
                          </div>
                        )}
                        {report.crew_size !== null && (
                          <div className="flex items-center gap-2">
                            <Users size={16} className="text-green" />
                            <span className="text-sm text-text2">
                              {report.crew_size} crew,{" "}
                              {report.crew_hours?.toFixed(1)} hours
                            </span>
                          </div>
                        )}
                        {report.weather && (
                          <div className="flex items-center gap-2">
                            {getWeatherIcon(report.weather)}
                            <span className="text-sm text-text2">
                              {report.weather}
                              {report.temperature_high &&
                                ` / ${report.temperature_high}°F`}
                            </span>
                          </div>
                        )}
                      </div>
                    </div>

                    {/* Warning Badges */}
                    <div className="flex items-center gap-2 flex-wrap">
                      {report.work_delayed && (
                        <span className="px-2 py-1 text-xs font-medium bg-amber-dim text-amber rounded-full">
                          Work Delayed
                        </span>
                      )}
                      {report.safety_incidents && (
                        <span className="px-2 py-1 text-xs font-medium bg-red-dim text-red rounded-full">
                          Safety Incident
                        </span>
                      )}
                      {report.work_performed && (
                        <span className="text-xs text-text3">
                          {report.work_performed.substring(0, 50)}
                          {report.work_performed.length > 50 ? "..." : ""}
                        </span>
                      )}
                    </div>

                    {/* Expand indicator */}
                    <motion.div
                      animate={{ rotate: isExpanded ? 180 : 0 }}
                      className="mt-4 flex justify-center"
                    >
                      <ChevronDown
                        size={18}
                        className="text-text3 transition-transform"
                      />
                    </motion.div>
                  </button>

                  {/* Expanded Details */}
                  <AnimatePresence>
                    {isExpanded && (
                      <motion.div
                        initial={{ opacity: 0, height: 0 }}
                        animate={{ opacity: 1, height: "auto" }}
                        exit={{ opacity: 0, height: 0 }}
                        transition={{ duration: 0.2 }}
                        className="border-t border-[#222] bg-surface px-6 py-4"
                      >
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-6 text-sm">
                          {report.work_performed && (
                            <div>
                              <h4 className="text-xs font-semibold text-text3 uppercase mb-2">
                                Work Performed
                              </h4>
                              <p className="text-text2">{report.work_performed}</p>
                            </div>
                          )}
                          {(report.units_completed !== null ||
                            report.percent_complete !== null) && (
                            <div>
                              <h4 className="text-xs font-semibold text-text3 uppercase mb-2">
                                Progress
                              </h4>
                              <p className="text-text2">
                                {report.units_completed} units{" "}
                                {report.percent_complete
                                  ? `(${report.percent_complete}%)`
                                  : ""}
                              </p>
                            </div>
                          )}
                          {report.issues_noted && (
                            <div>
                              <h4 className="text-xs font-semibold text-text3 uppercase mb-2">
                                Issues Noted
                              </h4>
                              <p className="text-text2">{report.issues_noted}</p>
                            </div>
                          )}
                          {report.work_delayed && report.delay_reason && (
                            <div>
                              <h4 className="text-xs font-semibold text-text3 uppercase mb-2">
                                Delay Reason
                              </h4>
                              <p className="text-text2">{report.delay_reason}</p>
                            </div>
                          )}
                          {report.safety_incidents && report.safety_notes && (
                            <div>
                              <h4 className="text-xs font-semibold text-text3 uppercase mb-2">
                                Safety Notes
                              </h4>
                              <p className="text-text2">{report.safety_notes}</p>
                            </div>
                          )}
                          {report.materials_needed && (
                            <div>
                              <h4 className="text-xs font-semibold text-text3 uppercase mb-2">
                                Materials Needed
                              </h4>
                              <p className="text-text2">
                                {report.materials_needed}
                              </p>
                            </div>
                          )}
                          {report.materials_delivered && (
                            <div>
                              <h4 className="text-xs font-semibold text-text3 uppercase mb-2">
                                Materials Delivered
                              </h4>
                              <p className="text-text2">
                                {report.materials_delivered}
                              </p>
                            </div>
                          )}
                          {(report.inspections_passed !== null ||
                            report.inspections_failed !== null) && (
                            <div>
                              <h4 className="text-xs font-semibold text-text3 uppercase mb-2">
                                Inspections
                              </h4>
                              <p className="text-text2">
                                Passed: {report.inspections_passed || 0}, Failed:{" "}
                                {report.inspections_failed || 0}
                              </p>
                            </div>
                          )}
                          {report.rework_needed && (
                            <div>
                              <h4 className="text-xs font-semibold text-text3 uppercase mb-2">
                                Rework Needed
                              </h4>
                              <p className="text-text2">{report.rework_needed}</p>
                            </div>
                          )}
                          {report.notes && (
                            <div className="md:col-span-2">
                              <h4 className="text-xs font-semibold text-text3 uppercase mb-2">
                                Notes
                              </h4>
                              <p className="text-text2">{report.notes}</p>
                            </div>
                          )}
                        </div>

                        {/* Action Buttons */}
                        <div className="mt-6 flex items-center gap-2 pt-4 border-t border-[#222]">
                          {report.status === "draft" && (
                            <>
                              <button
                                onClick={() => handleEdit(report)}
                                className="flex items-center gap-2 px-3 py-2 text-xs font-medium rounded-lg bg-green-dim text-green hover:bg-green-dim transition-colors"
                              >
                                <Edit2 size={14} />
                                Edit
                              </button>
                              <button
                                onClick={() => handleDelete(report.id)}
                                className="flex items-center gap-2 px-3 py-2 text-xs font-medium rounded-lg bg-red-dim text-red hover:bg-red-dim transition-colors"
                              >
                                <Trash2 size={14} />
                                Delete
                              </button>
                            </>
                          )}
                        </div>
                      </motion.div>
                    )}
                  </AnimatePresence>
                </motion.div>
              );
            })}
          </motion.div>
        )}
      </div>

      {/* Create/Edit Modal */}
      <AnimatePresence>
        {isModalOpen && (
          <DailyReportModal
            isOpen={isModalOpen}
            report={editingReport}
            formData={formData}
            onFormChange={setFormData}
            onClose={() => setIsModalOpen(false)}
            onSaveDraft={handleSaveAsDraft}
            onSubmit={handleSubmit}
          />
        )}
      </AnimatePresence>
    </div>
  );
}

// ─── Modal Component ────────────────────────────
interface DailyReportModalProps {
  isOpen: boolean;
  report: DailyReport | null;
  formData: Partial<DailyReport>;
  onFormChange: (data: Partial<DailyReport>) => void;
  onClose: () => void;
  onSaveDraft: () => Promise<void>;
  onSubmit: () => Promise<void>;
}

function DailyReportModal({
  isOpen,
  report,
  formData,
  onFormChange,
  onClose,
  onSaveDraft,
  onSubmit,
}: DailyReportModalProps) {
  const [submitting, setSubmitting] = useState(false);

  const handleSaveDraft = async () => {
    setSubmitting(true);
    try {
      await onSaveDraft();
    } finally {
      setSubmitting(false);
    }
  };

  const handleSubmit = async () => {
    setSubmitting(true);
    try {
      await onSubmit();
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm"
      onClick={onClose}
    >
      <motion.div
        initial={{ x: 400, opacity: 0 }}
        animate={{ x: 0, opacity: 1 }}
        exit={{ x: 400, opacity: 0 }}
        transition={{ type: "spring", damping: 25, stiffness: 200 }}
        onClick={(e) => e.stopPropagation()}
        className="absolute right-0 top-0 h-screen w-full max-w-2xl bg-[#0a0a0a] border-l border-[#222] flex flex-col overflow-y-auto"
      >
        {/* Header */}
        <div className="sticky top-0 z-50 border-b border-[#222] bg-[#0a0a0a]/95 backdrop-blur-sm px-6 py-4 flex items-center justify-between">
          <h2 className="text-xl font-bold text-text1">
            {report ? "Edit Report" : "Create Report"}
          </h2>
          <button
            onClick={onClose}
            className="p-1 hover:bg-[#1a1a1a] rounded-lg transition-colors"
          >
            <X size={20} className="text-text2" />
          </button>
        </div>

        {/* Form */}
        <div className="flex-1 px-6 py-6 space-y-6">
          {/* Date & Community */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-text2 mb-2">
                Date
              </label>
              <input
                type="date"
                value={formatDateForInput(formData.report_date || "")}
                onChange={(e) =>
                  onFormChange({ ...formData, report_date: e.target.value })
                }
                className="w-full px-3 py-2 bg-[#111] border border-[#222] rounded-lg text-text1 text-sm focus:outline-none focus:ring-2 focus:ring-green/50"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-text2 mb-2">
                Community
              </label>
              <input
                type="text"
                value={formData.community || ""}
                onChange={(e) =>
                  onFormChange({ ...formData, community: e.target.value })
                }
                className="w-full px-3 py-2 bg-[#111] border border-[#222] rounded-lg text-text1 text-sm focus:outline-none focus:ring-2 focus:ring-green/50"
                placeholder="e.g., Sunset Valley"
              />
            </div>
          </div>

          {/* Lot Number */}
          <div>
            <label className="block text-sm font-medium text-text2 mb-2">
              Lot Number (Optional)
            </label>
            <input
              type="text"
              value={formData.lot_number || ""}
              onChange={(e) =>
                onFormChange({ ...formData, lot_number: e.target.value })
              }
              className="w-full px-3 py-2 bg-[#111] border border-[#222] rounded-lg text-text1 text-sm focus:outline-none focus:ring-2 focus:ring-green/50"
              placeholder="e.g., LOT-001"
            />
          </div>

          {/* Phase */}
          <div>
            <label className="block text-sm font-medium text-text2 mb-2">
              Phase
            </label>
            <select
              value={formData.phase || ""}
              onChange={(e) =>
                onFormChange({ ...formData, phase: e.target.value })
              }
              className="w-full px-3 py-2 bg-[#111] border border-[#222] rounded-lg text-text1 text-sm focus:outline-none focus:ring-2 focus:ring-green/50"
            >
              <option value="">Select phase</option>
              <option value="Drywall Hang">Drywall Hang</option>
              <option value="Drywall Finish">Drywall Finish</option>
              <option value="Texture">Texture</option>
              <option value="Prime">Prime</option>
              <option value="Paint">Paint</option>
              <option value="Touch-up">Touch-up</option>
              <option value="Punch">Punch</option>
              <option value="Other">Other</option>
            </select>
          </div>

          {/* Work Performed */}
          <div>
            <label className="block text-sm font-medium text-text2 mb-2">
              Work Performed
            </label>
            <textarea
              value={formData.work_performed || ""}
              onChange={(e) =>
                onFormChange({ ...formData, work_performed: e.target.value })
              }
              className="w-full px-3 py-2 bg-[#111] border border-[#222] rounded-lg text-text1 text-sm focus:outline-none focus:ring-2 focus:ring-green/50 min-h-[80px] resize-none"
              placeholder="Describe work completed today..."
            />
          </div>

          {/* Crew Info */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-text2 mb-2">
                Crew Size
              </label>
              <input
                type="number"
                value={formData.crew_size || ""}
                onChange={(e) =>
                  onFormChange({
                    ...formData,
                    crew_size: e.target.value ? parseInt(e.target.value) : undefined,
                  })
                }
                className="w-full px-3 py-2 bg-[#111] border border-[#222] rounded-lg text-text1 text-sm focus:outline-none focus:ring-2 focus:ring-green/50"
                placeholder="0"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-text2 mb-2">
                Crew Hours
              </label>
              <input
                type="number"
                step="0.5"
                value={formData.crew_hours || ""}
                onChange={(e) =>
                  onFormChange({
                    ...formData,
                    crew_hours: e.target.value ? parseFloat(e.target.value) : undefined,
                  })
                }
                className="w-full px-3 py-2 bg-[#111] border border-[#222] rounded-lg text-text1 text-sm focus:outline-none focus:ring-2 focus:ring-green/50"
                placeholder="0"
              />
            </div>
          </div>

          {/* Progress */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-text2 mb-2">
                Units Completed
              </label>
              <input
                type="number"
                value={formData.units_completed || ""}
                onChange={(e) =>
                  onFormChange({
                    ...formData,
                    units_completed: e.target.value
                      ? parseInt(e.target.value)
                      : undefined,
                  })
                }
                className="w-full px-3 py-2 bg-[#111] border border-[#222] rounded-lg text-text1 text-sm focus:outline-none focus:ring-2 focus:ring-green/50"
                placeholder="0"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-text2 mb-2">
                Progress (%)
              </label>
              <div className="flex items-center gap-3">
                <input
                  type="range"
                  min="0"
                  max="100"
                  value={formData.percent_complete || 0}
                  onChange={(e) =>
                    onFormChange({
                      ...formData,
                      percent_complete: parseInt(e.target.value),
                    })
                  }
                  className="flex-1 accent-green"
                />
                <span className="text-sm text-text2 w-12 text-right">
                  {formData.percent_complete || 0}%
                </span>
              </div>
            </div>
          </div>

          {/* Weather */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-text2 mb-2">
                Weather
              </label>
              <select
                value={formData.weather || ""}
                onChange={(e) =>
                  onFormChange({ ...formData, weather: e.target.value })
                }
                className="w-full px-3 py-2 bg-[#111] border border-[#222] rounded-lg text-text1 text-sm focus:outline-none focus:ring-2 focus:ring-green/50"
              >
                <option value="">Select weather</option>
                <option value="Sunny">Sunny</option>
                <option value="Cloudy">Cloudy</option>
                <option value="Rainy">Rainy</option>
                <option value="Thunderstorm">Thunderstorm</option>
                <option value="Snowy">Snowy</option>
                <option value="Windy">Windy</option>
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-text2 mb-2">
                Temperature High (°F)
              </label>
              <input
                type="number"
                value={formData.temperature_high || ""}
                onChange={(e) =>
                  onFormChange({
                    ...formData,
                    temperature_high: e.target.value
                      ? parseInt(e.target.value)
                      : undefined,
                  })
                }
                className="w-full px-3 py-2 bg-[#111] border border-[#222] rounded-lg text-text1 text-sm focus:outline-none focus:ring-2 focus:ring-green/50"
                placeholder="72"
              />
            </div>
          </div>

          {/* Work Delayed */}
          <div className="border-t border-[#222] pt-4">
            <label className="flex items-center gap-3 cursor-pointer">
              <input
                type="checkbox"
                checked={formData.work_delayed || false}
                onChange={(e) =>
                  onFormChange({ ...formData, work_delayed: e.target.checked })
                }
                className="w-4 h-4 rounded border-[#444] bg-[#111] text-green focus:ring-green/50"
              />
              <span className="text-sm font-medium text-text2">Work Delayed</span>
            </label>
            {formData.work_delayed && (
              <textarea
                value={formData.delay_reason || ""}
                onChange={(e) =>
                  onFormChange({ ...formData, delay_reason: e.target.value })
                }
                className="w-full mt-2 px-3 py-2 bg-[#111] border border-[#222] rounded-lg text-text1 text-sm focus:outline-none focus:ring-2 focus:ring-green/50 resize-none"
                placeholder="Reason for delay..."
                rows={3}
              />
            )}
          </div>

          {/* Issues */}
          <div>
            <label className="block text-sm font-medium text-text2 mb-2">
              Issues Noted
            </label>
            <textarea
              value={formData.issues_noted || ""}
              onChange={(e) =>
                onFormChange({ ...formData, issues_noted: e.target.value })
              }
              className="w-full px-3 py-2 bg-[#111] border border-[#222] rounded-lg text-text1 text-sm focus:outline-none focus:ring-2 focus:ring-green/50 min-h-[60px] resize-none"
              placeholder="Any issues or concerns..."
            />
          </div>

          {/* Safety */}
          <div className="border-t border-[#222] pt-4">
            <label className="flex items-center gap-3 cursor-pointer">
              <input
                type="checkbox"
                checked={formData.safety_incidents || false}
                onChange={(e) =>
                  onFormChange({
                    ...formData,
                    safety_incidents: e.target.checked,
                  })
                }
                className="w-4 h-4 rounded border-[#444] bg-[#111] text-red focus:ring-red/50"
              />
              <span className="text-sm font-medium text-text2">
                Safety Incidents
              </span>
            </label>
            {formData.safety_incidents && (
              <textarea
                value={formData.safety_notes || ""}
                onChange={(e) =>
                  onFormChange({ ...formData, safety_notes: e.target.value })
                }
                className="w-full mt-2 px-3 py-2 bg-[#111] border border-[#222] rounded-lg text-text1 text-sm focus:outline-none focus:ring-2 focus:ring-green/50 resize-none"
                placeholder="Describe the incident..."
                rows={3}
              />
            )}
          </div>

          {/* Materials */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-text2 mb-2">
                Materials Needed
              </label>
              <textarea
                value={formData.materials_needed || ""}
                onChange={(e) =>
                  onFormChange({ ...formData, materials_needed: e.target.value })
                }
                className="w-full px-3 py-2 bg-[#111] border border-[#222] rounded-lg text-text1 text-sm focus:outline-none focus:ring-2 focus:ring-green/50 min-h-[60px] resize-none"
                placeholder="List materials..."
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-text2 mb-2">
                Materials Delivered
              </label>
              <textarea
                value={formData.materials_delivered || ""}
                onChange={(e) =>
                  onFormChange({
                    ...formData,
                    materials_delivered: e.target.value,
                  })
                }
                className="w-full px-3 py-2 bg-[#111] border border-[#222] rounded-lg text-text1 text-sm focus:outline-none focus:ring-2 focus:ring-green/50 min-h-[60px] resize-none"
                placeholder="List delivered..."
              />
            </div>
          </div>

          {/* Inspections */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-text2 mb-2">
                Inspections Passed
              </label>
              <input
                type="number"
                value={formData.inspections_passed || ""}
                onChange={(e) =>
                  onFormChange({
                    ...formData,
                    inspections_passed: e.target.value
                      ? parseInt(e.target.value)
                      : undefined,
                  })
                }
                className="w-full px-3 py-2 bg-[#111] border border-[#222] rounded-lg text-text1 text-sm focus:outline-none focus:ring-2 focus:ring-green/50"
                placeholder="0"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-text2 mb-2">
                Inspections Failed
              </label>
              <input
                type="number"
                value={formData.inspections_failed || ""}
                onChange={(e) =>
                  onFormChange({
                    ...formData,
                    inspections_failed: e.target.value
                      ? parseInt(e.target.value)
                      : undefined,
                  })
                }
                className="w-full px-3 py-2 bg-[#111] border border-[#222] rounded-lg text-text1 text-sm focus:outline-none focus:ring-2 focus:ring-green/50"
                placeholder="0"
              />
            </div>
          </div>

          {/* Rework */}
          <div>
            <label className="block text-sm font-medium text-text2 mb-2">
              Rework Needed
            </label>
            <textarea
              value={formData.rework_needed || ""}
              onChange={(e) =>
                onFormChange({ ...formData, rework_needed: e.target.value })
              }
              className="w-full px-3 py-2 bg-[#111] border border-[#222] rounded-lg text-text1 text-sm focus:outline-none focus:ring-2 focus:ring-green/50 min-h-[60px] resize-none"
              placeholder="Any rework needed..."
            />
          </div>

          {/* Notes */}
          <div>
            <label className="block text-sm font-medium text-text2 mb-2">
              General Notes
            </label>
            <textarea
              value={formData.notes || ""}
              onChange={(e) => onFormChange({ ...formData, notes: e.target.value })}
              className="w-full px-3 py-2 bg-[#111] border border-[#222] rounded-lg text-text1 text-sm focus:outline-none focus:ring-2 focus:ring-green/50 min-h-[60px] resize-none"
              placeholder="Additional notes..."
            />
          </div>
        </div>

        {/* Footer */}
        <div className="sticky bottom-0 border-t border-[#222] bg-[#0a0a0a]/95 backdrop-blur-sm px-6 py-4 flex items-center justify-between gap-3">
          <button
            onClick={onClose}
            className="px-4 py-2 text-sm font-medium text-text2 hover:text-text1 transition-colors"
          >
            Cancel
          </button>
          <div className="flex gap-3">
            <motion.button
              whileHover={{ scale: 1.02 }}
              whileTap={{ scale: 0.98 }}
              onClick={handleSaveDraft}
              disabled={submitting}
              className="flex items-center gap-2 px-4 py-2 bg-green-dim border border-green-bdr text-green rounded-lg hover:bg-green-dim transition-colors disabled:opacity-50"
            >
              {submitting ? (
                <Loader2 size={16} className="animate-spin" />
              ) : (
                <Save size={16} />
              )}
              Save Draft
            </motion.button>
            <motion.button
              whileHover={{ scale: 1.02 }}
              whileTap={{ scale: 0.98 }}
              onClick={handleSubmit}
              disabled={submitting}
              className="flex items-center gap-2 px-4 py-2 bg-green text-text1 rounded-lg hover:bg-green transition-colors disabled:opacity-50 font-medium"
            >
              {submitting ? (
                <Loader2 size={16} className="animate-spin" />
              ) : (
                <Send size={16} />
              )}
              Submit Report
            </motion.button>
          </div>
        </div>
      </motion.div>
    </motion.div>
  );
}
