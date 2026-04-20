"use client";

import { useState, useEffect, useMemo } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  DollarSign,
  TrendingUp,
  TrendingDown,
  AlertTriangle,
  Target,
  Plus,
  X,
  Calendar,
  FileText,
} from "lucide-react";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
  Cell,
} from "recharts";
import {
  CommunityBudget,
  BudgetOverview,
  BudgetTrendMonth,
} from "@/lib/api";
import {
  useGetBudgetOverview,
  useGetBudgetTrends,
  useCreateBudget,
} from "@/hooks/useBudgets";

// Stat Card Component
function StatCard({
  icon: Icon,
  label,
  value,
  trend,
  color = "emerald",
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  trend?: { direction: "up" | "down"; percent: number };
  color?: "emerald" | "red" | "orange";
}) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3 }}
      className="bg-surface border border-card-border rounded-xl p-6 space-y-3"
    >
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-medium text-text2">{label}</h3>
        <div
          className={`p-2.5 rounded-lg ${
            color === "emerald"
              ? "bg-green-dim text-green"
              : color === "red"
              ? "bg-red-dim text-red"
              : "bg-amber-dim text-amber"
          }`}
        >
          {Icon}
        </div>
      </div>
      <p className="text-2xl font-bold text-text1">{value}</p>
      {trend && (
        <div className="flex items-center gap-1 text-xs">
          {trend.direction === "up" ? (
            <TrendingUp size={14} className="text-green" />
          ) : (
            <TrendingDown size={14} className="text-red" />
          )}
          <span className={trend.direction === "up" ? "text-green" : "text-red"}>
            {trend.percent}% vs last month
          </span>
        </div>
      )}
    </motion.div>
  );
}

// Progress Bar Component
function ProgressBar({ percent, status }: { percent: number; status: string }) {
  const getColor = (p: number) => {
    if (p < 75) return "bg-green";
    if (p < 90) return "bg-amber";
    return "bg-red";
  };

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between text-xs">
        <span className="text-text3">Usage</span>
        <span className="font-semibold text-text1">{percent.toFixed(0)}%</span>
      </div>
      <div className="h-2 bg-surface-secondary rounded-full overflow-hidden">
        <motion.div
          initial={{ width: 0 }}
          animate={{ width: `${Math.min(percent, 100)}%` }}
          transition={{ duration: 0.5 }}
          className={`h-full ${getColor(percent)}`}
        />
      </div>
    </div>
  );
}

// Budget Card Component
function BudgetCard({
  budget,
  onViewTrend,
}: {
  budget: BudgetOverview["communities"][0];
  onViewTrend: () => void;
}) {
  const statusColors = {
    on_track: "bg-green-dim text-green border border-green-bdr",
    warning: "bg-amber-dim text-amber border border-amber-bdr",
    over_budget: "bg-red-dim text-red border border-red-bdr",
    exceeded: "bg-red-dim text-red border border-red-bdr",
  };

  const statusLabels = {
    on_track: "On Track",
    warning: "Warning",
    over_budget: "Over Budget",
    exceeded: "Exceeded",
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3 }}
      className="bg-surface border border-card-border rounded-xl p-6 space-y-5 hover:border-green-bdr transition-colors cursor-pointer"
      onClick={onViewTrend}
    >
      <div>
        <div className="flex items-start justify-between mb-3">
          <h3 className="text-lg font-semibold text-text1">{budget.community}</h3>
          <span
            className={`text-xs font-medium px-2.5 py-1 rounded-full ${statusColors[budget.status]}`}
          >
            {statusLabels[budget.status]}
          </span>
        </div>
      </div>

      <div className="grid grid-cols-3 gap-4">
        <div>
          <p className="text-xs text-text3 mb-1">Budget</p>
          <p className="text-sm font-semibold text-text1">
            ${(budget.budget_amount / 1000).toFixed(1)}K
          </p>
        </div>
        <div>
          <p className="text-xs text-text3 mb-1">Actual Spend</p>
          <p className="text-sm font-semibold text-text1">
            ${(budget.actual_spend / 1000).toFixed(1)}K
          </p>
        </div>
        <div>
          <p className="text-xs text-text3 mb-1">Remaining</p>
          <p
            className={`text-sm font-semibold ${
              budget.remaining >= 0 ? "text-green" : "text-red"
            }`}
          >
            ${Math.abs(budget.remaining / 1000).toFixed(1)}K
          </p>
        </div>
      </div>

      <ProgressBar percent={budget.percent_used} status={budget.status} />

      <div className="flex items-center justify-between pt-2 border-t border-card-border">
        <span className="text-xs text-text3">
          {budget.epo_count} EPO{budget.epo_count !== 1 ? "s" : ""}
        </span>
        <span className="text-xs text-green hover:text-green transition-colors font-medium">
          View Trends →
        </span>
      </div>
    </motion.div>
  );
}

// Unbudgeted Warning Card
function UnbudgetedCard({
  community,
  actualSpend,
  epoCount,
  onSetBudget,
}: {
  community: string;
  actualSpend: number;
  epoCount: number;
  onSetBudget: () => void;
}) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3 }}
      className="bg-amber-dim border border-amber-bdr rounded-xl p-5 flex items-start gap-4"
    >
      <AlertTriangle size={20} className="text-amber shrink-0 mt-0.5" />
      <div className="flex-1">
        <h4 className="font-semibold text-amber mb-1">{community}</h4>
        <p className="text-xs text-text2 mb-3">
          Unbudgeted community with ${(actualSpend / 1000).toFixed(1)}K spent across {epoCount} EPO
          {epoCount !== 1 ? "s" : ""}
        </p>
        <button
          onClick={onSetBudget}
          className="text-xs font-medium px-3 py-1.5 bg-amber hover:bg-amber text-white rounded-lg transition-colors"
        >
          Set Budget
        </button>
      </div>
    </motion.div>
  );
}

// Trend Chart Modal
function TrendModal({
  community,
  trends,
  onClose,
}: {
  community: string | null;
  trends: BudgetTrendMonth[];
  onClose: () => void;
}) {
  if (!community) return null;

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        transition={{ duration: 0.2 }}
        className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-end md:items-center justify-center p-4"
        onClick={onClose}
      >
        <motion.div
          initial={{ y: 100, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          exit={{ y: 100, opacity: 0 }}
          transition={{ duration: 0.3 }}
          className="bg-surface border border-card-border rounded-2xl w-full max-w-2xl max-h-[85vh] overflow-y-auto"
          onClick={(e) => e.stopPropagation()}
        >
          {/* Header */}
          <div className="sticky top-0 bg-surface border-b border-card-border px-6 py-4 flex items-center justify-between z-10">
            <div>
              <h2 className="text-xl font-bold text-text1">{community}</h2>
              <p className="text-xs text-text3 mt-1">Monthly budget vs actual spend</p>
            </div>
            <button
              onClick={onClose}
              className="p-2 hover:bg-surface-secondary rounded-lg transition-colors"
            >
              <X size={20} className="text-text2" />
            </button>
          </div>

          {/* Chart */}
          <div className="p-6">
            {trends.length > 0 ? (
              <ResponsiveContainer width="100%" height={300}>
                <BarChart data={trends}>
                  <defs>
                    <linearGradient id="colorBudget" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#9ca3af" stopOpacity={0.8} />
                      <stop offset="95%" stopColor="#9ca3af" stopOpacity={0} />
                    </linearGradient>
                    <linearGradient id="colorActual" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#10b981" stopOpacity={0.8} />
                      <stop offset="95%" stopColor="#10b981" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="#ffffff10" />
                  <XAxis
                    dataKey="month"
                    tick={{ fill: "#9ca3af", fontSize: 12 }}
                    axisLine={{ stroke: "#ffffff10" }}
                  />
                  <YAxis
                    tick={{ fill: "#9ca3af", fontSize: 12 }}
                    axisLine={{ stroke: "#ffffff10" }}
                    label={{ value: "Amount ($)", angle: -90, position: "insideLeft" }}
                  />
                  <Tooltip
                    contentStyle={{
                      backgroundColor: "#111",
                      border: "1px solid rgba(255,255,255,0.1)",
                      borderRadius: "8px",
                    }}
                    labelStyle={{ color: "#fff" }}
                    formatter={(value) => `$${(value as number / 1000).toFixed(1)}K`}
                  />
                  <Legend wrapperStyle={{ paddingTop: "20px" }} />
                  <Bar
                    dataKey="budget_portion"
                    fill="url(#colorBudget)"
                    name="Budget Portion"
                    radius={[8, 8, 0, 0]}
                  />
                  <Bar
                    dataKey="actual_spend"
                    fill="url(#colorActual)"
                    name="Actual Spend"
                    radius={[8, 8, 0, 0]}
                  />
                </BarChart>
              </ResponsiveContainer>
            ) : (
              <div className="h-64 flex items-center justify-center text-text3">
                <p>No trend data available</p>
              </div>
            )}
          </div>

          {/* Footer Stats */}
          {trends.length > 0 && (
            <div className="border-t border-card-border px-6 py-4 grid grid-cols-3 gap-4 text-sm">
              <div>
                <p className="text-text3 text-xs mb-1">Total Budget</p>
                <p className="text-text1 font-semibold">
                  ${(trends.reduce((sum, t) => sum + t.budget_portion, 0) / 1000).toFixed(1)}K
                </p>
              </div>
              <div>
                <p className="text-text3 text-xs mb-1">Total Spent</p>
                <p className="text-text1 font-semibold">
                  ${(trends.reduce((sum, t) => sum + t.actual_spend, 0) / 1000).toFixed(1)}K
                </p>
              </div>
              <div>
                <p className="text-text3 text-xs mb-1">Total EPOs</p>
                <p className="text-text1 font-semibold">
                  {trends.reduce((sum, t) => sum + t.epo_count, 0)}
                </p>
              </div>
            </div>
          )}
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
}

// Create Budget Modal
function CreateBudgetModal({
  communities,
  onClose,
  onSuccess,
}: {
  communities: string[];
  onClose: () => void;
  onSuccess: () => void;
}) {
  const [formData, setFormData] = useState({
    community: "",
    budget_amount: "",
    period_start: "",
    period_end: "",
    labor_budget: "",
    materials_budget: "",
    equipment_budget: "",
    notes: "",
  });

  const createMutation = useCreateBudget();
  const [formLoading, setFormLoading] = useState(false);
  const [formError, setFormError] = useState("");

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormLoading(true);
    setFormError("");

    const data = {
      community: formData.community,
      budget_amount: parseFloat(formData.budget_amount),
      period_start: formData.period_start,
      period_end: formData.period_end,
      labor_budget: formData.labor_budget ? parseFloat(formData.labor_budget) : null,
      materials_budget: formData.materials_budget ? parseFloat(formData.materials_budget) : null,
      equipment_budget: formData.equipment_budget ? parseFloat(formData.equipment_budget) : null,
      notes: formData.notes || null,
      is_active: true,
    };

    createMutation.mutate(data, {
      onSuccess: () => {
        setFormLoading(false);
        onSuccess();
      },
      onError: (err) => {
        setFormError(err instanceof Error ? err.message : "Failed to create budget");
        setFormLoading(false);
      },
    });
  };

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        transition={{ duration: 0.2 }}
        className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-end md:items-center justify-center p-4"
        onClick={onClose}
      >
        <motion.div
          initial={{ y: 100, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          exit={{ y: 100, opacity: 0 }}
          transition={{ duration: 0.3 }}
          className="bg-surface border border-card-border rounded-2xl w-full max-w-lg max-h-[85vh] overflow-y-auto"
          onClick={(e) => e.stopPropagation()}
        >
          {/* Header */}
          <div className="sticky top-0 bg-surface border-b border-card-border px-6 py-4 flex items-center justify-between z-10">
            <div>
              <h2 className="text-xl font-bold text-text1">Create Budget</h2>
              <p className="text-xs text-text3 mt-1">Set up a new community budget period</p>
            </div>
            <button
              onClick={onClose}
              className="p-2 hover:bg-surface-secondary rounded-lg transition-colors"
            >
              <X size={20} className="text-text2" />
            </button>
          </div>

          {/* Form */}
          <form onSubmit={handleSubmit} className="p-6 space-y-4">
            {formError && (
              <div className="p-3 bg-red-dim border border-red-bdr rounded-lg text-sm text-red">
                {formError}
              </div>
            )}

            {/* Community */}
            <div>
              <label className="block text-sm font-medium text-text1 mb-2">Community</label>
              <input
                type="text"
                list="communities-list"
                value={formData.community}
                onChange={(e) => setFormData({ ...formData, community: e.target.value })}
                className="w-full px-4 py-2.5 rounded-lg bg-surface-secondary border border-card-border text-text1 placeholder-text3 focus:outline-none focus:border-green/50"
                placeholder="Enter community name"
                required
              />
              <datalist id="communities-list">
                {communities.map((c) => (
                  <option key={c} value={c} />
                ))}
              </datalist>
            </div>

            {/* Budget Amount */}
            <div>
              <label className="block text-sm font-medium text-text1 mb-2">Total Budget Amount</label>
              <input
                type="number"
                value={formData.budget_amount}
                onChange={(e) => setFormData({ ...formData, budget_amount: e.target.value })}
                className="w-full px-4 py-2.5 rounded-lg bg-surface-secondary border border-card-border text-text1 placeholder-text3 focus:outline-none focus:border-green/50"
                placeholder="e.g., 100000"
                step="0.01"
                required
              />
            </div>

            {/* Period Dates */}
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-sm font-medium text-text1 mb-2">Period Start</label>
                <input
                  type="date"
                  value={formData.period_start}
                  onChange={(e) => setFormData({ ...formData, period_start: e.target.value })}
                  className="w-full px-4 py-2.5 rounded-lg bg-surface-secondary border border-card-border text-text1 focus:outline-none focus:border-green/50"
                  required
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-text1 mb-2">Period End</label>
                <input
                  type="date"
                  value={formData.period_end}
                  onChange={(e) => setFormData({ ...formData, period_end: e.target.value })}
                  className="w-full px-4 py-2.5 rounded-lg bg-surface-secondary border border-card-border text-text1 focus:outline-none focus:border-green/50"
                  required
                />
              </div>
            </div>

            {/* Budget Breakdown */}
            <div className="border-t border-card-border pt-4">
              <p className="text-xs font-semibold text-text2 uppercase tracking-wider mb-3">
                Budget Breakdown (Optional)
              </p>
              <div className="space-y-3">
                <div>
                  <label className="block text-sm font-medium text-text1 mb-2">Labor Budget</label>
                  <input
                    type="number"
                    value={formData.labor_budget}
                    onChange={(e) => setFormData({ ...formData, labor_budget: e.target.value })}
                    className="w-full px-4 py-2.5 rounded-lg bg-surface-secondary border border-card-border text-text1 placeholder-text3 focus:outline-none focus:border-green/50"
                    placeholder="e.g., 50000"
                    step="0.01"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-text1 mb-2">Materials Budget</label>
                  <input
                    type="number"
                    value={formData.materials_budget}
                    onChange={(e) => setFormData({ ...formData, materials_budget: e.target.value })}
                    className="w-full px-4 py-2.5 rounded-lg bg-surface-secondary border border-card-border text-text1 placeholder-text3 focus:outline-none focus:border-green/50"
                    placeholder="e.g., 35000"
                    step="0.01"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-text1 mb-2">Equipment Budget</label>
                  <input
                    type="number"
                    value={formData.equipment_budget}
                    onChange={(e) => setFormData({ ...formData, equipment_budget: e.target.value })}
                    className="w-full px-4 py-2.5 rounded-lg bg-surface-secondary border border-card-border text-text1 placeholder-text3 focus:outline-none focus:border-green/50"
                    placeholder="e.g., 15000"
                    step="0.01"
                  />
                </div>
              </div>
            </div>

            {/* Notes */}
            <div>
              <label className="block text-sm font-medium text-text1 mb-2">Notes</label>
              <textarea
                value={formData.notes}
                onChange={(e) => setFormData({ ...formData, notes: e.target.value })}
                className="w-full px-4 py-2.5 rounded-lg bg-surface-secondary border border-card-border text-text1 placeholder-text3 focus:outline-none focus:border-green/50 resize-none"
                placeholder="Add any notes about this budget..."
                rows={3}
              />
            </div>

            {/* Submit */}
            <div className="pt-2">
              <button
                type="submit"
                disabled={formLoading}
                className="w-full px-4 py-3 bg-green hover:bg-green disabled:opacity-50 text-white font-medium rounded-lg transition-colors flex items-center justify-center gap-2"
              >
                <Plus size={18} />
                {formLoading ? "Creating..." : "Create Budget"}
              </button>
            </div>
          </form>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
}

// Main Page
export default function BudgetsPage() {
  const [mounted, setMounted] = useState(false);
  const [selectedCommunity, setSelectedCommunity] = useState<string | null>(null);
  const [showCreateModal, setShowCreateModal] = useState(false);

  // Hydration guard
  useEffect(() => {
    setMounted(true);
  }, []);

  // React Query hooks
  const overviewQuery = useGetBudgetOverview();
  const trendsQuery = useGetBudgetTrends(selectedCommunity || "");
  const createMutation = useCreateBudget();

  const overview = overviewQuery.data || null;
  const trends = trendsQuery.data || [];
  const loading = overviewQuery.isLoading;
  const error = overviewQuery.error?.message || "";

  const handleSuccess = () => {
    setShowCreateModal(false);
  };

  const allCommunities = useMemo(() => {
    if (!overview) return [];
    return overview.communities.map((c) => c.community);
  }, [overview]);

  if (!mounted) return null;

  return (
    <div className="min-h-screen bg-bg">
      {/* Header */}
      <div className="border-b border-card-border sticky top-0 z-20 bg-bg/80 backdrop-blur-sm">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6 flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-bold text-text1 flex items-center gap-3">
              <Target size={32} className="text-green" />
              Budget Tracking
            </h1>
            <p className="text-sm text-text3 mt-1">Monitor community budgets vs actual spend</p>
          </div>
          <button
            onClick={() => setShowCreateModal(true)}
            className="px-4 py-2.5 bg-green hover:bg-green text-white font-medium rounded-lg transition-colors flex items-center gap-2"
          >
            <Plus size={18} />
            Create Budget
          </button>
        </div>
      </div>

      {/* Main Content */}
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-8">
        {error && (
          <motion.div
            initial={{ opacity: 0, y: -10 }}
            animate={{ opacity: 1, y: 0 }}
            className="p-4 bg-red-dim border border-red-bdr rounded-lg text-red text-sm"
          >
            {error}
          </motion.div>
        )}

        {loading ? (
          <div className="flex items-center justify-center min-h-64">
            <div className="text-center">
              <div className="inline-block w-12 h-12 border-4 border-card-border border-t-green rounded-full animate-spin mb-4" />
              <p className="text-text2">Loading budget data...</p>
            </div>
          </div>
        ) : overview ? (
          <>
            {/* Summary Cards */}
            <div>
              <h2 className="text-lg font-semibold text-text1 mb-4">Overview</h2>
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
                <StatCard
                  icon={<DollarSign size={20} />}
                  label="Total Budget"
                  value={`$${(overview.totals.total_budget / 1000000).toFixed(1)}M`}
                />
                <StatCard
                  icon={<TrendingUp size={20} />}
                  label="Total Spent"
                  value={`$${(overview.totals.total_spend / 1000000).toFixed(1)}M`}
                />
                <StatCard
                  icon={overview.totals.total_remaining >= 0 ? <TrendingUp size={20} /> : <TrendingDown size={20} />}
                  label="Total Remaining"
                  value={`$${Math.abs(overview.totals.total_remaining / 1000000).toFixed(1)}M`}
                  color={overview.totals.total_remaining >= 0 ? "emerald" : "red"}
                />
                <StatCard
                  icon={<Target size={20} />}
                  label="Overall Usage"
                  value={`${overview.totals.overall_percent.toFixed(0)}%`}
                  color={
                    overview.totals.overall_percent < 75
                      ? "emerald"
                      : overview.totals.overall_percent < 90
                      ? "orange"
                      : "red"
                  }
                />
              </div>
            </div>

            {/* Budgeted Communities */}
            {overview.communities.length > 0 && (
              <div>
                <h2 className="text-lg font-semibold text-text1 mb-4">Communities</h2>
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
                  {overview.communities.map((budget) => (
                    <BudgetCard
                      key={budget.community}
                      budget={budget}
                      onViewTrend={() => setSelectedCommunity(budget.community)}
                    />
                  ))}
                </div>
              </div>
            )}

            {/* Unbudgeted Communities Warning */}
            {overview.unbudgeted.length > 0 && (
              <div>
                <h2 className="text-lg font-semibold text-text1 mb-4 flex items-center gap-2">
                  <AlertTriangle size={20} className="text-amber" />
                  Unbudgeted Communities
                </h2>
                <div className="space-y-3">
                  {overview.unbudgeted.map((unbudgeted) => (
                    <UnbudgetedCard
                      key={unbudgeted.community}
                      community={unbudgeted.community}
                      actualSpend={unbudgeted.actual_spend}
                      epoCount={unbudgeted.epo_count}
                      onSetBudget={() => {
                        setShowCreateModal(true);
                        // Pre-fill community name would require form state management
                      }}
                    />
                  ))}
                </div>
              </div>
            )}

            {/* Empty State */}
            {overview.communities.length === 0 && overview.unbudgeted.length === 0 && (
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                className="text-center py-16 border border-dashed border-card-border rounded-xl"
              >
                <Target size={48} className="mx-auto text-text3 mb-3 opacity-50" />
                <h3 className="text-lg font-semibold text-text1 mb-1">No budgets yet</h3>
                <p className="text-sm text-text3 mb-6">
                  Create your first community budget to start tracking spend
                </p>
                <button
                  onClick={() => setShowCreateModal(true)}
                  className="px-4 py-2.5 bg-green hover:bg-green text-white font-medium rounded-lg transition-colors inline-flex items-center gap-2"
                >
                  <Plus size={18} />
                  Create Budget
                </button>
              </motion.div>
            )}
          </>
        ) : null}
      </div>

      {/* Trend Modal */}
      <TrendModal
        community={selectedCommunity}
        trends={trends}
        onClose={() => {
          setSelectedCommunity(null);
        }}
      />

      {/* Create Budget Modal */}
      {showCreateModal && (
        <CreateBudgetModal
          communities={allCommunities}
          onClose={() => setShowCreateModal(false)}
          onSuccess={handleSuccess}
        />
      )}
    </div>
  );
}
