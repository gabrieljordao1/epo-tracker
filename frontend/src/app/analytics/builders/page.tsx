"use client";

import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from "recharts";
import { useBuilderScores, useCommunityScores, useTrends } from "@/hooks/useAnalytics";
import type { BuilderScore, CommunityScore, TrendWeek } from "@/lib/api";
import {
  TrendingUp,
  TrendingDown,
  Minus,
  Building2,
  Users,
  ArrowUpRight,
  ArrowDownRight,
  BarChart3,
  MapPin,
  Filter,
  ChevronDown,
  Star,
  Award,
  AlertTriangle,
} from "lucide-react";
import Link from "next/link";

type SortField = "value" | "capture_rate" | "avg_response_days" | "total_epos";

interface ExpandedDetails {
  confirmed: number;
  denied: number;
  pending: number;
}

export default function BuildersPage() {
  const [mounted, setMounted] = useState(false);
  const [days, setDays] = useState(90);
  const [sortBy, setSortBy] = useState<SortField>("value");
  const [expandedBuilder, setExpandedBuilder] = useState<string | null>(null);
  const [expandedDetails, setExpandedDetails] = useState<Record<string, ExpandedDetails>>({});

  const { data: builders = [], isLoading: buildersLoading } = useBuilderScores({ sortBy, days });
  const { data: communities = [], isLoading: communitiesLoading } = useCommunityScores({ days });
  const { data: trends = [], isLoading: trendsLoading } = useTrends({ weeks: Math.ceil(days / 7) });

  const loading = buildersLoading || communitiesLoading || trendsLoading;
  const error: string | null = null;

  // Sort builders based on selected field
  const sortedBuilders = [...(builders || [])].sort((a, b) => {
    switch (sortBy) {
      case "value":
        return (b.total_value || 0) - (a.total_value || 0);
      case "capture_rate":
        return (b.capture_rate || 0) - (a.capture_rate || 0);
      case "avg_response_days":
        return (a.avg_response_days || 0) - (b.avg_response_days || 0);
      case "total_epos":
        return (b.total_epos || 0) - (a.total_epos || 0);
      default:
        return 0;
    }
  });

  // Calculate summary metrics
  const totalBuilders = (builders || []).length;
  const bestCaptureRate = (builders || []).reduce(
    (max, b) => (b.capture_rate > max.capture_rate ? b : max),
    { vendor_name: "—", capture_rate: 0 } as BuilderScore
  );
  const fastestResponse = (builders || []).reduce(
    (min, b) =>
      (b.avg_response_days ?? Infinity) < (min.avg_response_days ?? Infinity) ? b : min,
    { vendor_name: "—", avg_response_days: 0 } as BuilderScore
  );
  const highestValue = (builders || []).reduce(
    (max, b) => (b.total_value > max.total_value ? b : max),
    { vendor_name: "—", total_value: 0 } as BuilderScore
  );

  // Helper functions for formatting
  const formatCurrency = (value: number | null | undefined) => {
    const v = value ?? 0;
    if (v >= 1000000) {
      return `$${(v / 1000000).toFixed(1)}M`;
    }
    if (v >= 1000) {
      return `$${(v / 1000).toFixed(0)}K`;
    }
    return `$${v}`;
  };

  const formatPercentage = (value: number | null | undefined) => `${(value ?? 0).toFixed(1)}%`;

  const getCaptureRateColor = (rate: number | null | undefined) => {
    const r = rate ?? 0;
    if (r > 70) return "text-emerald-400";
    if (r > 40) return "text-yellow-400";
    return "text-red-400";
  };

  const getCaptureRateBgColor = (rate: number | null | undefined) => {
    const r = rate ?? 0;
    if (r > 70) return "bg-emerald-500/20 border-emerald-500/30";
    if (r > 40) return "bg-yellow-500/20 border-yellow-500/30";
    return "bg-red-500/20 border-red-500/30";
  };

  const getResponseTimeColor = (days: number | null | undefined) => {
    const d = days ?? 0;
    if (d < 3) return "text-emerald-400";
    if (d < 7) return "text-yellow-400";
    return "text-red-400";
  };

  const getResponseTimeBgColor = (days: number | null | undefined) => {
    const d = days ?? 0;
    if (d < 3) return "bg-emerald-500/20 border-emerald-500/30";
    if (d < 7) return "bg-yellow-500/20 border-yellow-500/30";
    return "bg-red-500/20 border-red-500/30";
  };

  const getTrendIcon = (trend: number | undefined) => {
    if (!trend) return <Minus className="w-4 h-4 text-gray-500" />;
    if (trend > 0) return <TrendingUp className="w-4 h-4 text-emerald-400" />;
    return <TrendingDown className="w-4 h-4 text-red-400" />;
  };

  const handleExpandRow = async (builderName: string) => {
    if (expandedBuilder === builderName) {
      setExpandedBuilder(null);
      return;
    }

    // Use real data from the builder scorecard
    const builder = builders.find(b => b.vendor_name === builderName);
    if (builder && !expandedDetails[builderName]) {
      setExpandedDetails((prev) => ({
        ...prev,
        [builderName]: {
          confirmed: builder.confirmed_count || 0,
          denied: builder.denied_count || 0,
          pending: builder.pending_count || 0,
        },
      }));
    }

    setExpandedBuilder(builderName);
  };


  if (error) {
    return (
      <div className="min-h-screen bg-bg p-8">
        <div className="max-w-6xl mx-auto">
          <Link
            href="/analytics"
            className="text-emerald-400 hover:text-emerald-300 text-sm mb-6 inline-flex items-center gap-2"
          >
            ← Back to Analytics
          </Link>
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            className="bg-red-500/10 border border-red-500/30 rounded-xl p-6 flex items-start gap-4"
          >
            <AlertTriangle className="w-5 h-5 text-red-400 flex-shrink-0 mt-0.5" />
            <div>
              <h3 className="text-white font-semibold mb-1">Error Loading Data</h3>
              <p className="text-gray-400 text-sm">{error}</p>
            </div>
          </motion.div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-bg p-8">
      <div className="max-w-7xl mx-auto">
        {/* Back Link */}
        <Link
          href="/analytics"
          className="text-emerald-400 hover:text-emerald-300 text-sm mb-8 inline-flex items-center gap-2 transition-colors"
        >
          ← Back to Analytics
        </Link>

        {/* Header */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="mb-12"
        >
          <div className="flex items-start justify-between mb-4">
            <div>
              <h1 className="text-4xl font-bold text-white mb-2">
                Builder Scorecards
              </h1>
              <p className="text-gray-400">
                Track builder performance and response patterns
              </p>
            </div>

            {/* Time Range Filter */}
            <div className="relative group">
              <button className="px-4 py-2 bg-white/5 border border-white/10 rounded-lg text-white text-sm hover:bg-white/10 transition-colors flex items-center gap-2">
                <Filter className="w-4 h-4" />
                {days}d
                <ChevronDown className="w-4 h-4" />
              </button>
              <div className="absolute right-0 mt-2 w-40 bg-[#1a2f3f] border border-white/10 rounded-lg shadow-xl opacity-0 invisible group-hover:opacity-100 group-hover:visible transition-all duration-200 z-10">
                {[30, 60, 90, 180, 365].map((d) => (
                  <button
                    key={d}
                    onClick={() => setDays(d)}
                    className={`w-full text-left px-4 py-2 text-sm transition-colors ${
                      days === d
                        ? "bg-emerald-500/20 text-emerald-400"
                        : "text-gray-300 hover:bg-white/5"
                    }`}
                  >
                    {d} days
                  </button>
                ))}
              </div>
            </div>
          </div>
        </motion.div>

        {/* Summary Cards Row */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.1 }}
          className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mb-12"
        >
          {/* Total Builders */}
          <div className="bg-white/5 border border-white/10 rounded-xl p-6 hover:bg-white/10 transition-colors">
            <div className="flex items-center justify-between mb-3">
              <span className="text-gray-400 text-sm font-medium">
                Total Builders
              </span>
              <Building2 className="w-4 h-4 text-emerald-400" />
            </div>
            {loading ? (
              <div className="h-8 bg-white/5 rounded animate-pulse" />
            ) : (
              <p className="text-3xl font-bold text-white">{totalBuilders}</p>
            )}
          </div>

          {/* Best Capture Rate */}
          <div className="bg-white/5 border border-white/10 rounded-xl p-6 hover:bg-white/10 transition-colors">
            <div className="flex items-center justify-between mb-3">
              <span className="text-gray-400 text-sm font-medium">
                Best Capture Rate
              </span>
              <Star className="w-4 h-4 text-yellow-400" />
            </div>
            {loading ? (
              <div className="space-y-2">
                <div className="h-6 bg-white/5 rounded animate-pulse" />
                <div className="h-4 bg-white/5 rounded animate-pulse w-24" />
              </div>
            ) : (
              <div>
                <p className="text-xl font-bold text-white">
                  {bestCaptureRate.vendor_name}
                </p>
                <p className="text-emerald-400 text-sm font-medium">
                  {formatPercentage(bestCaptureRate.capture_rate)}
                </p>
              </div>
            )}
          </div>

          {/* Fastest Response */}
          <div className="bg-white/5 border border-white/10 rounded-xl p-6 hover:bg-white/10 transition-colors">
            <div className="flex items-center justify-between mb-3">
              <span className="text-gray-400 text-sm font-medium">
                Fastest Response
              </span>
              <ArrowUpRight className="w-4 h-4 text-emerald-400" />
            </div>
            {loading ? (
              <div className="space-y-2">
                <div className="h-6 bg-white/5 rounded animate-pulse" />
                <div className="h-4 bg-white/5 rounded animate-pulse w-24" />
              </div>
            ) : (
              <div>
                <p className="text-xl font-bold text-white">
                  {fastestResponse.vendor_name}
                </p>
                <p className="text-emerald-400 text-sm font-medium">
                  {(fastestResponse.avg_response_days ?? 0).toFixed(1)}d avg
                </p>
              </div>
            )}
          </div>

          {/* Highest Value */}
          <div className="bg-white/5 border border-white/10 rounded-xl p-6 hover:bg-white/10 transition-colors">
            <div className="flex items-center justify-between mb-3">
              <span className="text-gray-400 text-sm font-medium">
                Highest Value
              </span>
              <Award className="w-4 h-4 text-emerald-400" />
            </div>
            {loading ? (
              <div className="space-y-2">
                <div className="h-6 bg-white/5 rounded animate-pulse" />
                <div className="h-4 bg-white/5 rounded animate-pulse w-24" />
              </div>
            ) : (
              <div>
                <p className="text-xl font-bold text-white">
                  {highestValue.vendor_name}
                </p>
                <p className="text-emerald-400 text-sm font-medium">
                  {formatCurrency(highestValue.total_value)}
                </p>
              </div>
            )}
          </div>
        </motion.div>

        {/* Builder Table */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.2 }}
          className="mb-12"
        >
          <div className="bg-white/5 border border-white/10 rounded-xl overflow-hidden">
            {/* Table Header */}
            <div className="border-b border-white/10 bg-white/[0.02] px-6 py-4">
              <div className="flex items-center gap-6">
                <div className="flex-1 min-w-0">
                  <button
                    onClick={() => setSortBy("value")}
                    className={`text-xs font-semibold uppercase tracking-wider transition-colors ${
                      sortBy === "value"
                        ? "text-emerald-400"
                        : "text-gray-500 hover:text-gray-400"
                    }`}
                  >
                    Builder
                  </button>
                </div>
                <div className="w-32">
                  <button
                    onClick={() => setSortBy("total_epos")}
                    className={`text-xs font-semibold uppercase tracking-wider transition-colors ${
                      sortBy === "total_epos"
                        ? "text-emerald-400"
                        : "text-gray-500 hover:text-gray-400"
                    }`}
                  >
                    EPO Count
                  </button>
                </div>
                <div className="w-40">
                  <button
                    onClick={() => setSortBy("capture_rate")}
                    className={`text-xs font-semibold uppercase tracking-wider transition-colors ${
                      sortBy === "capture_rate"
                        ? "text-emerald-400"
                        : "text-gray-500 hover:text-gray-400"
                    }`}
                  >
                    Capture Rate
                  </button>
                </div>
                <div className="w-36">
                  <button
                    onClick={() => setSortBy("avg_response_days")}
                    className={`text-xs font-semibold uppercase tracking-wider transition-colors ${
                      sortBy === "avg_response_days"
                        ? "text-emerald-400"
                        : "text-gray-500 hover:text-gray-400"
                    }`}
                  >
                    Avg Response
                  </button>
                </div>
                <div className="w-32">
                  <span className="text-xs font-semibold uppercase tracking-wider text-gray-500">
                    Total Value
                  </span>
                </div>
                <div className="w-20">
                  <span className="text-xs font-semibold uppercase tracking-wider text-gray-500">
                    Trend
                  </span>
                </div>
              </div>
            </div>

            {/* Table Body */}
            {loading ? (
              <div className="space-y-px">
                {[...Array(5)].map((_, i) => (
                  <div
                    key={i}
                    className="h-16 bg-white/[0.02] border-t border-white/5 animate-pulse"
                  />
                ))}
              </div>
            ) : sortedBuilders.length === 0 ? (
              <div className="px-6 py-12 text-center">
                <Building2 className="w-12 h-12 text-gray-600 mx-auto mb-4" />
                <p className="text-gray-400">No builders found for this period</p>
              </div>
            ) : (
              <div>
                <AnimatePresence>
                  {sortedBuilders.map((builder, idx) => (
                    <motion.div
                      key={builder.vendor_name}
                      initial={{ opacity: 0, y: 10 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ delay: idx * 0.05 }}
                    >
                      {/* Row */}
                      <button
                        onClick={() => handleExpandRow(builder.vendor_name)}
                        className="w-full px-6 py-4 border-t border-white/5 hover:bg-white/5 transition-colors text-left group"
                      >
                        <div className="flex items-center gap-6">
                          {/* Builder Info */}
                          <div className="flex-1 min-w-0">
                            <p className="text-white font-medium truncate group-hover:text-emerald-400 transition-colors">
                              {builder.vendor_name}
                            </p>
                            <p className="text-gray-500 text-sm truncate">
                              {builder.vendor_email || "—"}
                            </p>
                          </div>

                          {/* EPO Count with Mini Bar */}
                          <div className="w-32">
                            <div className="flex items-center gap-2">
                              <div className="flex-1 h-2 bg-white/10 rounded-full overflow-hidden">
                                <div
                                  className="h-full bg-emerald-500/60"
                                  style={{
                                    width: `${Math.min(
                                      (builder.total_epos /
                                        (Math.max(
                                          ...builders.map((b) => b.total_epos || 0)
                                        ) || 1)) *
                                        100,
                                      100
                                    )}%`,
                                  }}
                                />
                              </div>
                              <span className="text-white font-medium text-sm w-10 text-right">
                                {builder.total_epos}
                              </span>
                            </div>
                          </div>

                          {/* Capture Rate with Progress Bar */}
                          <div className="w-40">
                            <div
                              className={`px-3 py-1.5 rounded-lg border ${getCaptureRateBgColor(
                                builder.capture_rate
                              )} inline-block`}
                            >
                              <span
                                className={`text-sm font-semibold ${getCaptureRateColor(
                                  builder.capture_rate
                                )}`}
                              >
                                {formatPercentage(builder.capture_rate)}
                              </span>
                            </div>
                          </div>

                          {/* Avg Response */}
                          <div className="w-36">
                            <div
                              className={`px-3 py-1.5 rounded-lg border ${getResponseTimeBgColor(
                                builder.avg_response_days
                              )} inline-block`}
                            >
                              <span
                                className={`text-sm font-semibold ${getResponseTimeColor(
                                  builder.avg_response_days
                                )}`}
                              >
                                {(builder.avg_response_days ?? 0).toFixed(1)}d
                              </span>
                            </div>
                          </div>

                          {/* Total Value */}
                          <div className="w-32">
                            <p className="text-white font-medium">
                              {formatCurrency(builder.total_value)}
                            </p>
                          </div>

                          {/* Trend */}
                          <div className="w-20 flex justify-center">
                            {builder.trend === "up" ? (
                              <TrendingUp className="w-4 h-4 text-emerald-400" />
                            ) : builder.trend === "down" ? (
                              <TrendingDown className="w-4 h-4 text-red-400" />
                            ) : (
                              <Minus className="w-4 h-4 text-gray-500" />
                            )}
                          </div>
                        </div>
                      </button>

                      {/* Expanded Details */}
                      <AnimatePresence>
                        {expandedBuilder === builder.vendor_name &&
                          expandedDetails[builder.vendor_name] && (
                            <motion.div
                              initial={{ opacity: 0, height: 0 }}
                              animate={{ opacity: 1, height: "auto" }}
                              exit={{ opacity: 0, height: 0 }}
                              className="border-t border-white/5 bg-white/[0.02] px-6 py-4"
                            >
                              <p className="text-gray-400 text-sm font-medium mb-3">
                                Status Breakdown
                              </p>
                              <div className="grid grid-cols-3 gap-4">
                                <div className="bg-white/5 border border-emerald-500/30 rounded-lg p-4">
                                  <p className="text-gray-400 text-sm mb-1">
                                    Confirmed
                                  </p>
                                  <p className="text-xl font-bold text-emerald-400">
                                    {expandedDetails[builder.vendor_name].confirmed}
                                  </p>
                                </div>
                                <div className="bg-white/5 border border-red-500/30 rounded-lg p-4">
                                  <p className="text-gray-400 text-sm mb-1">
                                    Denied
                                  </p>
                                  <p className="text-xl font-bold text-red-400">
                                    {expandedDetails[builder.vendor_name].denied}
                                  </p>
                                </div>
                                <div className="bg-white/5 border border-yellow-500/30 rounded-lg p-4">
                                  <p className="text-gray-400 text-sm mb-1">
                                    Pending
                                  </p>
                                  <p className="text-xl font-bold text-yellow-400">
                                    {expandedDetails[builder.vendor_name].pending}
                                  </p>
                                </div>
                              </div>
                            </motion.div>
                          )}
                      </AnimatePresence>
                    </motion.div>
                  ))}
                </AnimatePresence>
              </div>
            )}
          </div>
        </motion.div>

        {/* Community Breakdown Grid */}
        {communities.length > 0 && (
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.3 }}
            className="mb-12"
          >
            <h2 className="text-2xl font-bold text-white mb-6">
              Community Breakdown
            </h2>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {communities.map((community, idx) => (
                <motion.div
                  key={community.community_name}
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: 0.3 + idx * 0.05 }}
                  className="bg-white/5 border border-white/10 rounded-xl p-6 hover:bg-white/10 transition-colors"
                >
                  <div className="flex items-start justify-between mb-4">
                    <div className="flex items-center gap-2">
                      <MapPin className="w-4 h-4 text-emerald-400" />
                      <h3 className="font-semibold text-white">
                        {community.community_name}
                      </h3>
                    </div>
                  </div>
                  <div className="space-y-3">
                    <div>
                      <p className="text-gray-400 text-xs mb-1">EPO Count</p>
                      <p className="text-lg font-bold text-white">
                        {community.total_epos}
                      </p>
                    </div>
                    <div>
                      <p className="text-gray-400 text-xs mb-1">Total Value</p>
                      <p className="text-emerald-400 font-semibold">
                        {formatCurrency(community.total_value)}
                      </p>
                    </div>
                    <div>
                      <p className="text-gray-400 text-xs mb-1">Top Builder</p>
                      <p className="text-white font-medium">
                        {community.top_vendor}
                      </p>
                    </div>
                    <div>
                      <p className="text-gray-400 text-xs mb-1">
                        Avg Days Open
                      </p>
                      <p className="text-yellow-400 font-semibold">
                        {(community.avg_days_open ?? 0).toFixed(1)}d
                      </p>
                    </div>
                  </div>
                </motion.div>
              ))}
            </div>
          </motion.div>
        )}

        {/* Trends Chart */}
        {trends.length > 0 && (
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.4 }}
            className="mb-12"
          >
            <h2 className="text-2xl font-bold text-white mb-6 flex items-center gap-2">
              <BarChart3 className="w-6 h-6 text-emerald-400" />
              Weekly Volume Trends
            </h2>
            <div className="bg-white/5 border border-white/10 rounded-xl p-6">
              {loading ? (
                <div className="h-80 bg-white/5 rounded-lg animate-pulse" />
              ) : (
                <ResponsiveContainer width="100%" height={300}>
                  <BarChart data={trends}>
                    <CartesianGrid
                      strokeDasharray="3 3"
                      stroke="rgba(255, 255, 255, 0.1)"
                    />
                    <XAxis
                      dataKey="week"
                      tick={{ fill: "rgba(255, 255, 255, 0.5)", fontSize: 12 }}
                      stroke="rgba(255, 255, 255, 0.1)"
                    />
                    <YAxis
                      tick={{ fill: "rgba(255, 255, 255, 0.5)", fontSize: 12 }}
                      stroke="rgba(255, 255, 255, 0.1)"
                    />
                    <Tooltip
                      contentStyle={{
                        backgroundColor: "rgba(12, 27, 42, 0.95)",
                        border: "1px solid rgba(255, 255, 255, 0.1)",
                        borderRadius: "0.5rem",
                        color: "white",
                      }}
                      labelStyle={{ color: "white" }}
                    />
                    <Bar
                      dataKey="confirmed_count"
                      fill="#10B981"
                      name="Confirmed"
                      stackId="a"
                      radius={[0, 0, 0, 0]}
                    />
                    <Bar
                      dataKey="denied_count"
                      fill="#EF4444"
                      name="Denied"
                      stackId="a"
                      radius={[8, 8, 0, 0]}
                    />
                  </BarChart>
                </ResponsiveContainer>
              )}
            </div>
          </motion.div>
        )}
      </div>
    </div>
  );
}
