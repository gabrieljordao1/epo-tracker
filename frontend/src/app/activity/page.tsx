"use client";

import { useState, useEffect, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { getEPOs } from "@/lib/api";
import type { ActivityItem, EPO } from "@/lib/api";
import { useActivityFeed } from "@/hooks/useActivity";
import {
  Activity,
  Mail,
  CheckCircle2,
  XCircle,
  Clock,
  AlertTriangle,
  Bell,
  FileText,
  ArrowRight,
  RefreshCw,
  Filter,
  ChevronDown,
  Inbox,
  Search,
} from "lucide-react";

// Helper: Format timestamp to relative time (e.g., "2 hours ago")
const formatRelativeTime = (timestamp: string): string => {
  const now = new Date();
  const eventTime = new Date(timestamp);
  const diffInSeconds = Math.floor((now.getTime() - eventTime.getTime()) / 1000);

  if (diffInSeconds < 60) return "just now";
  if (diffInSeconds < 3600) return `${Math.floor(diffInSeconds / 60)}m ago`;
  if (diffInSeconds < 86400) return `${Math.floor(diffInSeconds / 3600)}h ago`;
  if (diffInSeconds < 604800) {
    const daysAgo = Math.floor(diffInSeconds / 86400);
    return daysAgo === 1 ? "Yesterday" : `${daysAgo}d ago`;
  }

  // Format as date for older events
  const options: Intl.DateTimeFormatOptions = {
    month: "short",
    day: "numeric",
    year: eventTime.getFullYear() !== now.getFullYear() ? "numeric" : undefined,
  };
  return eventTime.toLocaleDateString("en-US", options);
};

// Helper: Format timestamp to full datetime (e.g., "3:45 PM")
const formatFullTime = (timestamp: string): string => {
  const eventTime = new Date(timestamp);
  return eventTime.toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  });
};

// Helper: Get date group key for timeline grouping
const getDateGroupKey = (timestamp: string): string => {
  const eventTime = new Date(timestamp);
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const yesterday = new Date(today);
  yesterday.setDate(yesterday.getDate() - 1);
  const eventDate = new Date(
    eventTime.getFullYear(),
    eventTime.getMonth(),
    eventTime.getDate()
  );

  if (eventDate.getTime() === today.getTime()) {
    return "Today";
  } else if (eventDate.getTime() === yesterday.getTime()) {
    return "Yesterday";
  } else {
    const options: Intl.DateTimeFormatOptions = {
      month: "long",
      day: "numeric",
      year: eventDate.getFullYear() !== today.getFullYear() ? "numeric" : undefined,
    };
    return eventDate.toLocaleDateString("en-US", options);
  }
};

// Helper: Group activities by date
const groupByDate = (activities: ActivityItem[]): Record<string, ActivityItem[]> => {
  const grouped: Record<string, ActivityItem[]> = {};
  activities.forEach((activity) => {
    const key = getDateGroupKey(activity.timestamp);
    if (!grouped[key]) {
      grouped[key] = [];
    }
    grouped[key].push(activity);
  });
  return grouped;
};

// Helper: Get icon for event type
const getEventIcon = (type: string) => {
  const iconProps = { size: 20, strokeWidth: 2 };
  switch (type) {
    case "epo_confirmed":
      return <CheckCircle2 {...iconProps} />;
    case "epo_denied":
      return <XCircle {...iconProps} />;
    case "epo_pending":
      return <Clock {...iconProps} />;
    case "epo_created":
      return <Bell {...iconProps} />;
    case "follow_up_sent":
      return <Mail {...iconProps} />;
    case "email_reply":
      return <Mail {...iconProps} />;
    case "document_uploaded":
      return <FileText {...iconProps} />;
    default:
      return <Activity {...iconProps} />;
  }
};

// Helper: Get color classes for event type
const getEventColor = (type: string): { dot: string; bg: string; border: string; icon: string } => {
  switch (type) {
    case "epo_confirmed":
      return {
        dot: "bg-emerald-500/70",
        bg: "bg-emerald-500/5",
        border: "border-emerald-500/20",
        icon: "text-emerald-400",
      };
    case "epo_denied":
      return {
        dot: "bg-red-500/70",
        bg: "bg-red-500/5",
        border: "border-red-500/20",
        icon: "text-red-400",
      };
    case "epo_pending":
      return {
        dot: "bg-amber-500/70",
        bg: "bg-amber-500/5",
        border: "border-amber-500/20",
        icon: "text-amber-400",
      };
    case "epo_created":
      return {
        dot: "bg-blue-500/70",
        bg: "bg-blue-500/5",
        border: "border-blue-500/20",
        icon: "text-blue-400",
      };
    case "follow_up_sent":
      return {
        dot: "bg-purple-500/70",
        bg: "bg-purple-500/5",
        border: "border-purple-500/20",
        icon: "text-purple-400",
      };
    case "email_reply":
      return {
        dot: "bg-cyan-500/70",
        bg: "bg-cyan-500/5",
        border: "border-cyan-500/20",
        icon: "text-cyan-400",
      };
    case "document_uploaded":
      return {
        dot: "bg-indigo-500/70",
        bg: "bg-indigo-500/5",
        border: "border-indigo-500/20",
        icon: "text-indigo-400",
      };
    default:
      return {
        dot: "bg-gray-500/70",
        bg: "bg-gray-500/5",
        border: "border-gray-500/20",
        icon: "text-gray-400",
      };
  }
};

// Loading skeleton
const ActivitySkeleton = () => (
  <div className="flex gap-4 pb-6">
    <div className="flex flex-col items-center">
      <div className="w-5 h-5 rounded-full bg-white/10 animate-pulse" />
      <div className="w-0.5 h-20 bg-white/10 mt-2" />
    </div>
    <div className="flex-1 pt-1">
      <div className="h-4 bg-white/10 rounded w-1/3 animate-pulse mb-2" />
      <div className="h-3 bg-white/10 rounded w-2/3 animate-pulse mb-3" />
      <div className="h-3 bg-white/10 rounded w-1/4 animate-pulse" />
    </div>
  </div>
);

// Empty state
const EmptyState = () => (
  <div className="flex flex-col items-center justify-center py-20 px-4">
    <div className="mb-6">
      <Inbox size={64} className="text-white/20" strokeWidth={1} />
    </div>
    <h3 className="text-lg font-semibold text-white/70 mb-2">No activity yet</h3>
    <p className="text-sm text-white/50 text-center max-w-md">
      Activity from new EPOs, status changes, and follow-ups will appear here.
    </p>
  </div>
);

export default function ActivityPage() {
  const [error, setError] = useState<string | null>(null);
  const [days, setDays] = useState(7);
  const [typeFilter, setTypeFilter] = useState("all");
  const [searchQuery, setSearchQuery] = useState("");
  const [autoRefresh, setAutoRefresh] = useState(false);
  const [lastRefresh, setLastRefresh] = useState<Date>(new Date());
  const [filterOpen, setFilterOpen] = useState(false);

  // Fetch activities with hook
  const { data: activityData, isLoading: loading, refetch, error: hookError } = useActivityFeed(100, days);
  const activities = activityData?.feed || [];

  // Load activities callback for manual refresh
  const loadActivities = useCallback(async () => {
    try {
      setError(null);
      await refetch();
      setLastRefresh(new Date());
    } catch (err) {
      setError("Failed to load activity feed");
      console.error("Activity feed error:", err);
    }
  }, [refetch]);

  // Set hook error if it occurs
  useEffect(() => {
    if (hookError) {
      setError("Failed to load activity feed");
    }
  }, [hookError]);

  // Auto-refresh
  useEffect(() => {
    if (!autoRefresh) return;

    const interval = setInterval(() => {
      loadActivities();
    }, 30000);

    return () => clearInterval(interval);
  }, [autoRefresh, loadActivities]);

  // Filter activities
  const filteredActivities = activities
    .filter((activity) => {
      if (typeFilter !== "all" && activity.type !== typeFilter) return false;
      if (searchQuery) {
        const query = searchQuery.toLowerCase();
        return (
          activity.title?.toLowerCase().includes(query) ||
          activity.description?.toLowerCase().includes(query)
        );
      }
      return true;
    })
    .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());

  const groupedActivities = groupByDate(filteredActivities);
  const dateKeys = Object.keys(groupedActivities).sort((a, b) => {
    const aTime = new Date(groupedActivities[a][0].timestamp).getTime();
    const bTime = new Date(groupedActivities[b][0].timestamp).getTime();
    return bTime - aTime;
  });

  return (
    <div className="min-h-screen bg-bg text-white">
      {/* Header */}
      <div className="border-b border-white/10 bg-white/[0.02] backdrop-blur-sm">
        <div className="max-w-6xl mx-auto px-6 py-8">
          <div className="flex items-start justify-between mb-8">
            <div>
              <h1 className="text-4xl font-bold mb-2 flex items-center gap-3">
                <Activity size={32} className="text-white/80" />
                Activity Feed
              </h1>
              <p className="text-white/50">
                Real-time log of all EPO events and updates
              </p>
            </div>
            <div className="flex items-center gap-3">
              <motion.button
                whileHover={{ scale: 1.05 }}
                whileTap={{ scale: 0.95 }}
                onClick={() => loadActivities()}
                className="px-4 py-2 rounded-lg bg-white/5 border border-white/10 hover:bg-white/10 transition-colors flex items-center gap-2"
              >
                <RefreshCw size={18} />
                Refresh
              </motion.button>
              <motion.button
                whileHover={{ scale: 1.05 }}
                whileTap={{ scale: 0.95 }}
                onClick={() => setAutoRefresh(!autoRefresh)}
                className={`px-4 py-2 rounded-lg border transition-colors flex items-center gap-2 ${
                  autoRefresh
                    ? "bg-emerald-500/20 border-emerald-500/30 text-emerald-300"
                    : "bg-white/5 border-white/10 hover:bg-white/10"
                }`}
              >
                <Bell size={18} />
                {autoRefresh ? "Auto-refresh ON" : "Auto-refresh OFF"}
              </motion.button>
            </div>
          </div>

          {/* Filters Bar */}
          <div className="flex flex-col sm:flex-row gap-4 items-stretch sm:items-center">
            {/* Time Range Filter */}
            <div className="flex gap-2">
              {[
                { label: "Today", value: 1 },
                { label: "7 Days", value: 7 },
                { label: "30 Days", value: 30 },
                { label: "All", value: 999 },
              ].map((option) => (
                <motion.button
                  key={option.value}
                  whileHover={{ scale: 1.05 }}
                  whileTap={{ scale: 0.95 }}
                  onClick={() => setDays(option.value)}
                  className={`px-3 py-2 rounded-lg text-sm font-medium transition-colors ${
                    days === option.value
                      ? "bg-white/10 border border-white/20 text-white"
                      : "bg-white/5 border border-white/10 text-white/60 hover:bg-white/8"
                  }`}
                >
                  {option.label}
                </motion.button>
              ))}
            </div>

            {/* Divider */}
            <div className="hidden sm:block w-px h-8 bg-white/10" />

            {/* Type Filter Dropdown */}
            <div className="relative">
              <motion.button
                whileHover={{ scale: 1.02 }}
                whileTap={{ scale: 0.98 }}
                onClick={() => setFilterOpen(!filterOpen)}
                className="px-4 py-2 rounded-lg bg-white/5 border border-white/10 hover:bg-white/8 transition-colors flex items-center gap-2 w-full sm:w-auto"
              >
                <Filter size={18} />
                <span className="text-sm">
                  {typeFilter === "all"
                    ? "All Types"
                    : typeFilter.replace(/_/g, " ").charAt(0).toUpperCase() +
                      typeFilter.replace(/_/g, " ").slice(1)}
                </span>
                <ChevronDown size={16} className={`transition-transform ${filterOpen ? "rotate-180" : ""}`} />
              </motion.button>

              <AnimatePresence>
                {filterOpen && (
                  <motion.div
                    initial={{ opacity: 0, y: -10 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -10 }}
                    className="absolute top-full left-0 mt-2 w-48 bg-bg border border-white/10 rounded-xl shadow-2xl z-50 overflow-hidden"
                  >
                    {[
                      { label: "All Types", value: "all" },
                      { label: "New EPO", value: "epo_created" },
                      { label: "Status Change", value: "epo_confirmed" },
                      { label: "Follow-up", value: "follow_up_sent" },
                      { label: "Email Reply", value: "email_reply" },
                    ].map((option) => (
                      <motion.button
                        key={option.value}
                        whileHover={{ backgroundColor: "rgba(255,255,255,0.05)" }}
                        onClick={() => {
                          setTypeFilter(option.value);
                          setFilterOpen(false);
                        }}
                        className={`w-full px-4 py-3 text-left text-sm transition-colors border-b border-white/5 last:border-b-0 ${
                          typeFilter === option.value
                            ? "bg-white/10 text-white"
                            : "text-white/70 hover:text-white"
                        }`}
                      >
                        {option.label}
                      </motion.button>
                    ))}
                  </motion.div>
                )}
              </AnimatePresence>
            </div>

            {/* Search Box */}
            <div className="relative flex-1 sm:flex-none">
              <Search size={18} className="absolute left-3 top-1/2 -translate-y-1/2 text-white/30" />
              <input
                type="text"
                placeholder="Search by builder or community..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full pl-10 pr-4 py-2 rounded-lg bg-white/5 border border-white/10 text-white placeholder-white/30 focus:outline-none focus:border-white/20 focus:bg-white/8 transition-colors"
              />
            </div>
          </div>
        </div>
      </div>

      {/* Main Content */}
      <div className="max-w-6xl mx-auto px-6 py-8">
        {error && (
          <motion.div
            initial={{ opacity: 0, y: -10 }}
            animate={{ opacity: 1, y: 0 }}
            className="mb-6 p-4 rounded-lg bg-red-500/10 border border-red-500/20 text-red-300 text-sm flex items-start gap-3"
          >
            <AlertTriangle size={18} className="flex-shrink-0 mt-0.5" />
            <div>
              <p className="font-medium">Error loading activity feed</p>
              <p className="text-red-300/70 text-xs mt-1">{error}</p>
            </div>
          </motion.div>
        )}

        {loading ? (
          <div className="space-y-2">
            {[...Array(5)].map((_, i) => (
              <ActivitySkeleton key={i} />
            ))}
          </div>
        ) : filteredActivities.length === 0 ? (
          <EmptyState />
        ) : (
          <div className="space-y-2">
            {dateKeys.map((dateKey, dateIndex) => (
              <motion.div
                key={dateKey}
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: dateIndex * 0.05 }}
              >
                {/* Date Group Header */}
                <div className="sticky top-0 z-40 bg-bg/80 backdrop-blur-sm py-3 px-4 mb-4 -mx-4">
                  <h3 className="text-xs font-semibold text-white/40 uppercase tracking-wider">
                    {dateKey}
                  </h3>
                </div>

                {/* Timeline Items */}
                <div className="relative pl-6 space-y-4">
                  {/* Timeline Line */}
                  <div className="absolute left-0 top-0 bottom-0 w-0.5 bg-gradient-to-b from-white/20 to-white/5 rounded-full" />

                  <AnimatePresence mode="popLayout">
                    {groupedActivities[dateKey].map((activity, itemIndex) => {
                      const colors = getEventColor(activity.type);
                      return (
                        <motion.div
                          key={activity.epo_id}
                          initial={{ opacity: 0, x: -20 }}
                          animate={{ opacity: 1, x: 0 }}
                          exit={{ opacity: 0, x: 20 }}
                          transition={{ delay: itemIndex * 0.05 }}
                          className="group"
                        >
                          {/* Timeline Dot and Card */}
                          <div className="flex gap-4 -ml-6">
                            {/* Dot */}
                            <motion.div
                              whileHover={{ scale: 1.3 }}
                              className={`w-5 h-5 rounded-full ${colors.dot} border-2 border-[#0a1929] shadow-lg flex-shrink-0 mt-1 z-10`}
                            />

                            {/* Card */}
                            <motion.div
                              whileHover={{ scale: 1.02, y: -2 }}
                              className={`flex-1 p-4 rounded-xl border transition-all ${colors.bg} ${colors.border} hover:border-white/20 cursor-default`}
                            >
                              <div className="flex items-start justify-between gap-4 mb-2">
                                <div className="flex items-start gap-3 flex-1">
                                  <div className={`mt-1 ${colors.icon}`}>
                                    {getEventIcon(activity.type)}
                                  </div>
                                  <div className="flex-1 min-w-0">
                                    <h4 className="font-semibold text-white text-sm leading-snug">
                                      {activity.title}
                                    </h4>
                                    {activity.description && (
                                      <p className="text-white/60 text-xs mt-1.5">
                                        {activity.description}
                                      </p>
                                    )}
                                  </div>
                                </div>

                                {/* Status Badge */}
                                {activity.status && (
                                  <div className="px-2 py-1 rounded-md bg-white/5 border border-white/10 flex-shrink-0">
                                    <span className="text-xs font-medium text-white/70">
                                      {activity.status}
                                    </span>
                                  </div>
                                )}
                              </div>

                              {/* Timestamp and Details */}
                              <div className="flex items-center gap-2 text-xs text-white/50 mt-3 pt-3 border-t border-white/5">
                                <Clock size={14} />
                                <span>
                                  {formatRelativeTime(activity.timestamp)}
                                  {new Date().getTime() - new Date(activity.timestamp).getTime() > 86400000 &&
                                    ` at ${formatFullTime(activity.timestamp)}`}
                                </span>
                              </div>
                            </motion.div>
                          </div>
                        </motion.div>
                      );
                    })}
                  </AnimatePresence>
                </div>
              </motion.div>
            ))}
          </div>
        )}

        {/* Footer with Last Refresh Info */}
        {!loading && filteredActivities.length > 0 && (
          <div className="mt-12 pt-8 border-t border-white/5 text-center text-xs text-white/40">
            <p>
              Last refreshed {formatRelativeTime(lastRefresh.toISOString())}
              {autoRefresh && " • Auto-refresh enabled"}
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
