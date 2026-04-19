"use client";

import { useState, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  AreaChart,
  Area,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from "recharts";
import {
  TrendingUp,
  TrendingDown,
  Download,
  Inbox,
  Mail,
  Send,
  Clock,
  AlertCircle,
  DollarSign,
  FileText,
} from "lucide-react";
import {
  getStats,
  getEPOs,
  getActivityFeed,
  getTodayStats,
  downloadCSV,
  batchFollowup,
} from "@/lib/api";
import type { ActivityItem } from "@/lib/api";
import { useUser } from "@/lib/user-context";

const stagger = {
  hidden: {},
  visible: { transition: { staggerChildren: 0.08 } },
};
const fadeUp = {
  hidden: { opacity: 0, y: 16 },
  visible: {
    opacity: 1,
    y: 0,
    transition: { duration: 0.45, ease: [0.16, 1, 0.3, 1] as const },
  },
};

export default function Dashboard() {
  const { supervisorId, activeUser, isBossView } = useUser();
  const [stats, setStats] = useState<any>({
    total: 0,
    capture_rate: 0,
    total_value: 0,
    needs_followup: 0,
    confirmed: 0,
    pending: 0,
    denied: 0,
    discount: 0,
    avg_amount: 0,
  });
  const [epos, setEpos] = useState<any[]>([]);
  const [activity, setActivity] = useState<ActivityItem[]>([]);
  const [todayStats, setTodayStats] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [exporting, setExporting] = useState(false);
  const [batchSending, setBatchSending] = useState(false);
  const [batchResult, setBatchResult] = useState<string | null>(null);

  const loadData = async () => {
    setLoading(true);
    const [statsData, eposData, activityData, todayData] = await Promise.all([
      getStats(supervisorId),
      getEPOs(undefined, supervisorId),
      getActivityFeed(10, 7),
      getTodayStats(),
    ]);
    setStats(statsData);
    setEpos(eposData);
    setActivity(activityData.feed);
    setTodayStats(todayData);
    setLoading(false);
  };

  useEffect(() => {
    loadData();
  }, [supervisorId]);

  const handleExportCSV = async () => {
    setExporting(true);
    try {
      await downloadCSV();
    } catch {
      // In demo mode the authenticated export won't work — just show a toast
    } finally {
      setExporting(false);
    }
  };

  const handleBatchFollowup = async () => {
    setBatchSending(true);
    setBatchResult(null);
    try {
      const result = await batchFollowup();
      setBatchResult(result.message || `Sent ${result.sent} follow-ups`);
      setTimeout(() => setBatchResult(null), 5000);
    } catch (err: any) {
      setBatchResult(err.message || "Follow-up failed");
      setTimeout(() => setBatchResult(null), 5000);
    } finally {
      setBatchSending(false);
    }
  };

  // Revenue chart — cumulative revenue over time using email_date
  // Shows how total EPO value has grown, which always looks like a meaningful trend
  const chartData = epos.length > 0
    ? (() => {
        // Sort EPOs by date (oldest first)
        const sorted = [...epos]
          .map((epo) => ({
            date: new Date(epo.email_date || epo.created_at),
            amount: epo.amount || 0,
          }))
          .sort((a, b) => a.date.getTime() - b.date.getTime());

        // Build cumulative data points
        let cumulative = 0;
        const points: { month: string; value: number }[] = [];
        sorted.forEach((item) => {
          cumulative += item.amount;
          const label = `${item.date.toLocaleString("default", { month: "short" })} ${item.date.getDate()}`;
          // Merge same-day entries (update the last point if same label)
          if (points.length > 0 && points[points.length - 1].month === label) {
            points[points.length - 1].value = cumulative;
          } else {
            points.push({ month: label, value: cumulative });
          }
        });
        return points;
      })()
    : [];

  const statusData = [
    { status: "Confirmed", count: stats.confirmed || 0, color: "#34d399" },
    { status: "Pending", count: stats.pending || 0, color: "#fbbf24" },
    { status: "Denied", count: stats.denied || 0, color: "#f87171" },
    { status: "Discount", count: stats.discount || 0, color: "#c0a0ff" },
  ];

  // Weekly volume from real EPO data (using email_date for accuracy)
  const monthlyData = epos.length > 0
    ? (() => {
        const now = new Date();
        const weeks: Record<string, number> = {};
        for (let i = 3; i >= 0; i--) {
          weeks[`Week ${4 - i}`] = 0;
        }
        epos.forEach((epo) => {
          const epoDate = new Date(epo.email_date || epo.created_at);
          const weeksAgo = Math.floor((now.getTime() - epoDate.getTime()) / (7 * 86400000));
          if (weeksAgo < 4) {
            const key = `Week ${4 - weeksAgo}`;
            if (weeks[key] !== undefined) weeks[key]++;
          }
        });
        return Object.entries(weeks).map(([month, volume]) => ({ month, volume }));
      })()
    : [];

  const MetricCard = ({
    label,
    value,
    change,
    isPositive,
    icon,
    color,
    subtitle,
  }: {
    label: string;
    value: string;
    change: number;
    isPositive: boolean;
    icon: React.ReactNode;
    color: string;
    subtitle?: string;
  }) => (
    <motion.div className="bg-[#111] rounded-lg p-6 border border-[#222]" variants={fadeUp}>
      <div className="flex items-start justify-between mb-4">
        <div>
          <p className="text-text3 text-sm mb-1">{label}</p>
          <div className="flex items-baseline gap-2">
            <motion.span
              className={`text-3xl font-bold ${color}`}
              key={value}
              initial={{ opacity: 0, scale: 0.9 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ duration: 0.4, ease: [0.16, 1, 0.3, 1] }}
            >
              {value}
            </motion.span>
          </div>
        </div>
        <div className={`w-12 h-12 md:w-14 md:h-14 rounded-full bg-[#1a1a1a] flex items-center justify-center border-2 ${color.replace("text-", "border-").replace("-400", "-500/30")}`}>
          {icon}
        </div>
      </div>
      <div className="flex items-center justify-between">
        <p className="text-text3 text-xs">{subtitle || ""}</p>
        <div
          className={`flex items-center gap-1 text-xs ${
            isPositive ? "text-emerald-400" : "text-red-400"
          }`}
        >
          {isPositive ? <TrendingUp size={12} /> : <TrendingDown size={12} />}
          <span>{Math.abs(change || 0)}%</span>
        </div>
      </div>
    </motion.div>
  );

  const getActivityIcon = (type: string) => {
    switch (type) {
      case "epo_created":
        return <Inbox size={14} className="text-blue" />;
      case "followup_sent":
        return <Mail size={14} className="text-amber" />;
      default:
        return <Clock size={14} className="text-text3" />;
    }
  };

  return (
    <motion.div
      className="p-4 md:p-8 space-y-6 md:space-y-8"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.3 }}
    >
      {/* Page Header with Export Button */}
      <motion.div
        className="flex items-start justify-between"
        initial={{ opacity: 0, y: -10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4, ease: [0.16, 1, 0.3, 1] }}
      >
        <div>
          <h1 className="text-3xl font-semibold mb-2 text-text1">
            {(() => {
              const hour = new Date().getHours();
              const greeting = hour < 12 ? "Good morning" : hour < 17 ? "Good afternoon" : "Good evening";
              return `${greeting}${activeUser ? `, ${activeUser.full_name.split(" ")[0]}` : ""}`;
            })()}
          </h1>
          <AnimatePresence mode="wait">
            <motion.p
              key={activeUser?.id || "all"}
              className="text-text2"
              initial={{ opacity: 0, x: -10 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: 10 }}
              transition={{ duration: 0.25 }}
            >
              {isBossView
                ? "Viewing all communities"
                : `${activeUser?.full_name} — ${(activeUser?.communities ?? []).join(", ")}`}
            </motion.p>
          </AnimatePresence>
        </div>
        <div className="flex gap-3">
          <button
            onClick={handleExportCSV}
            disabled={exporting}
            className="btn-secondary flex items-center gap-2 text-sm"
          >
            <Download size={16} />
            {exporting ? "Exporting..." : "Export CSV"}
          </button>
        </div>
      </motion.div>

      {/* Batch Follow-up Banner */}
      {stats.needs_followup > 0 && (
        <motion.div
          className="card p-4 border-amber-bdr bg-amber-dim flex flex-col sm:flex-row items-start sm:items-center gap-3 sm:justify-between"
          initial={{ opacity: 0, y: -8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.2 }}
        >
          <div className="flex items-center gap-3">
            <AlertCircle className="text-amber flex-shrink-0" size={18} />
            <span className="text-sm text-text2">
              <span className="text-text1 font-semibold">
                {stats.needs_followup} EPOs
              </span>{" "}
              need follow-up (4+ days pending)
            </span>
          </div>
          <div className="flex items-center gap-3">
            {batchResult && (
              <span className="text-xs text-text2">{batchResult}</span>
            )}
            <button
              onClick={handleBatchFollowup}
              disabled={batchSending}
              className="btn-primary text-sm flex items-center gap-2"
            >
              <Send size={14} />
              {batchSending ? "Sending..." : "Follow Up All"}
            </button>
          </div>
        </motion.div>
      )}

      {/* Metrics Row */}
      <motion.div
        className="grid grid-cols-2 md:grid-cols-4 gap-3 md:gap-6"
        variants={stagger}
        initial="hidden"
        animate="visible"
        key={`metrics-${supervisorId || "all"}`}
      >
        <MetricCard
          label="Total EPOs"
          value={stats.total.toString()}
          change={stats.followUpChange}
          isPositive={(stats.followUpChange || 0) >= 0}
          icon={<FileText className="w-6 h-6 md:w-7 md:h-7 text-blue-400" />}
          color="text-blue-400"
          subtitle={`${stats.confirmed || 0} confirmed`}
        />
        <MetricCard
          label="Capture Rate"
          value={`${stats.capture_rate}%`}
          change={stats.captureRateChange}
          isPositive={(stats.captureRateChange || 0) >= 0}
          icon={<TrendingUp className="w-6 h-6 md:w-7 md:h-7 text-emerald-400" />}
          color="text-emerald-400"
          subtitle={`${stats.confirmed || 0} of ${stats.total || 0} confirmed`}
        />
        <MetricCard
          label="Total Value"
          value={`$${
            stats.total_value >= 1000
              ? (stats.total_value / 1000).toFixed(1) + "K"
              : stats.total_value.toFixed(0)
          }`}
          change={stats.valueChange}
          isPositive={(stats.valueChange || 0) >= 0}
          icon={<DollarSign className="w-6 h-6 md:w-7 md:h-7 text-amber-400" />}
          color="text-amber-400"
          subtitle={`${stats.total || 0} total EPOs`}
        />
        <MetricCard
          label="Needs Follow-Up"
          value={stats.needs_followup.toString()}
          change={0}
          isPositive={true}
          icon={<AlertCircle className="w-6 h-6 md:w-7 md:h-7 text-red-400" />}
          color="text-red-400"
          subtitle="Pending review"
        />
      </motion.div>

      {/* Charts + Activity Feed Row */}
      <motion.div
        className="grid grid-cols-1 md:grid-cols-3 gap-4 md:gap-6"
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{
          duration: 0.5,
          delay: 0.35,
          ease: [0.16, 1, 0.3, 1],
        }}
      >
        {/* Revenue Trend */}
        <div className="md:col-span-2 bg-[#111] rounded-lg p-6 border border-[#222]">
          <h3 className="text-lg font-semibold text-text1 mb-6">Revenue Trend</h3>
          {chartData.length === 0 ? (
            <div className="flex items-center justify-center h-[300px] text-[rgba(255,255,255,0.4)] text-sm">
              No EPO data yet. Create your first EPO to see trends here.
            </div>
          ) : (
          <ResponsiveContainer width="100%" height={300}>
            <AreaChart data={chartData}>
              <defs>
                <linearGradient id="colorValue" x1="0" y1="0" x2="0" y2="1">
                  <stop
                    offset="5%"
                    stopColor="rgb(52,211,153)"
                    stopOpacity={0.3}
                  />
                  <stop
                    offset="95%"
                    stopColor="rgb(52,211,153)"
                    stopOpacity={0.05}
                  />
                </linearGradient>
              </defs>
              <CartesianGrid
                strokeDasharray="3 3"
                stroke="rgba(255,255,255,0.08)"
              />
              <XAxis
                dataKey="month"
                stroke="rgba(255,255,255,0.30)"
                style={{ fontSize: "12px" }}
              />
              <YAxis
                stroke="rgba(255,255,255,0.30)"
                style={{ fontSize: "12px" }}
              />
              <Tooltip
                contentStyle={{
                  background: "rgba(255,255,255,0.06)",
                  border: "1px solid rgba(255,255,255,0.08)",
                  borderRadius: "8px",
                }}
              />
              <Area
                type="monotone"
                dataKey="value"
                stroke="rgb(52,211,153)"
                fillOpacity={1}
                fill="url(#colorValue)"
                animationDuration={1500}
                animationEasing="ease-out"
              />
            </AreaChart>
          </ResponsiveContainer>
          )}
        </div>

        {/* Activity Feed */}
        <div className="bg-[#111] rounded-lg p-6 border border-[#222]">
          <h3 className="text-lg font-semibold text-text1 mb-4">Recent Activity</h3>
          <div className="space-y-3">
            {activity.length > 0 ? (
              activity.slice(0, 8).map((item, i) => (
                <motion.div
                  key={`${item.epo_id}-${item.type}-${i}`}
                  className="flex items-start gap-3 py-2"
                  initial={{ opacity: 0, x: 10 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: 0.5 + i * 0.05 }}
                >
                  <div className="mt-0.5 flex-shrink-0">
                    {getActivityIcon(item.type)}
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm text-text1 truncate">{item.title}</p>
                    <p className="text-xs text-text3 truncate">
                      {item.description}
                    </p>
                  </div>
                </motion.div>
              ))
            ) : (
              <p className="text-text3 text-sm py-4 text-center">
                No recent activity
              </p>
            )}
          </div>
        </div>
      </motion.div>

      {/* Status Breakdown + Today's Stats */}
      <motion.div
        className="grid grid-cols-1 md:grid-cols-3 gap-4 md:gap-6"
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{
          duration: 0.5,
          delay: 0.45,
          ease: [0.16, 1, 0.3, 1],
        }}
      >
        {/* Status Breakdown */}
        <div className="md:col-span-2 bg-[#111] rounded-lg p-6 border border-[#222]">
          <h3 className="text-lg font-semibold text-text1 mb-6">Status Breakdown</h3>
          <div className="grid grid-cols-2 gap-x-8 gap-y-5">
            {statusData.map((item, i) => (
              <motion.div
                key={item.status}
                initial={{ opacity: 0, x: 12 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ duration: 0.4, delay: 0.5 + i * 0.1 }}
              >
                <div className="flex justify-between items-center mb-2">
                  <span className="text-sm text-text2">{item.status}</span>
                  <span className="text-sm font-semibold text-text1">
                    {item.count}
                  </span>
                </div>
                <div className="w-full h-2 bg-surface rounded-full overflow-hidden">
                  <motion.div
                    className="h-full rounded-full"
                    initial={{ width: 0 }}
                    animate={{
                      width: `${
                        stats.total > 0
                          ? (item.count / stats.total) * 100
                          : 0
                      }%`,
                    }}
                    transition={{
                      duration: 0.8,
                      delay: 0.6 + i * 0.1,
                      ease: [0.16, 1, 0.3, 1],
                    }}
                    style={{ backgroundColor: item.color }}
                  />
                </div>
              </motion.div>
            ))}
          </div>
        </div>

        {/* Today's Stats Card */}
        {todayStats && (
          <div className="bg-[#111] rounded-lg p-6 border border-[#222] space-y-5">
            <h3 className="text-lg font-semibold text-text1">Today&apos;s Snapshot</h3>
            <div>
              <p className="text-text3 text-xs mb-1">New EPOs Today</p>
              <p className="text-2xl font-bold text-text1">
                {todayStats.today_new}
              </p>
              <p className="text-text3 text-xs mt-1">
                ${todayStats.today_value?.toLocaleString() || 0} total value
              </p>
            </div>
            <div className="border-t border-card-border pt-4">
              <p className="text-text3 text-xs mb-1">Needs Attention</p>
              <p className="text-2xl font-bold text-amber-400">
                {todayStats.needs_attention}
              </p>
              <p className="text-text3 text-xs mt-1">
                $
                {todayStats.needs_attention_value?.toLocaleString() || 0} at
                risk
              </p>
            </div>
          </div>
        )}
      </motion.div>

      {/* Monthly Volume */}
      <motion.div
        className="bg-[#111] rounded-lg p-6 border border-[#222]"
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5, delay: 0.5, ease: [0.16, 1, 0.3, 1] }}
      >
        <h3 className="text-lg font-semibold text-text1 mb-6">Monthly Volume</h3>
        <ResponsiveContainer width="100%" height={250}>
          <BarChart data={monthlyData}>
            <CartesianGrid
              strokeDasharray="3 3"
              stroke="rgba(255,255,255,0.08)"
            />
            <XAxis
              dataKey="month"
              stroke="rgba(255,255,255,0.30)"
              style={{ fontSize: "12px" }}
            />
            <YAxis
              stroke="rgba(255,255,255,0.30)"
              style={{ fontSize: "12px" }}
            />
            <Tooltip
              contentStyle={{
                background: "rgba(255,255,255,0.06)",
                border: "1px solid rgba(255,255,255,0.08)",
                borderRadius: "8px",
              }}
            />
            <Bar
              dataKey="volume"
              fill="rgb(52,211,153)"
              radius={[8, 8, 0, 0]}
              animationDuration={1200}
              animationEasing="ease-out"
            />
          </BarChart>
        </ResponsiveContainer>
      </motion.div>
    </motion.div>
  );
}
