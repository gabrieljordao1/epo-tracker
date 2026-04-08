"use client";

import { useState, useEffect } from "react";
import {
  PieChart,
  Pie,
  Cell,
  AreaChart,
  Area,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Legend,
} from "recharts";
import { getEPOs, getStats, downloadCSV, getExportSummary } from "@/lib/api";
import { useUser } from "@/lib/user-context";
import type { EPO, Stats } from "@/lib/api";
import {
  TrendingUp,
  DollarSign,
  Clock,
  AlertCircle,
  Download,
  FileText,
  Loader2,
} from "lucide-react";

interface ChartData {
  name: string;
  value?: number;
  count?: number;
  amount?: number;
  [key: string]: any;
}

interface VendorStats {
  vendor: string;
  totalValue: number;
  epoCount: number;
  avgAmount: number;
}

interface OverdueEPO {
  vendor: string;
  community: string;
  daysOpen: number;
  amount: number;
  status: string;
}

const COLORS_STATUS = {
  confirmed: "#10b981",
  pending: "#f59e0b",
  denied: "#ef4444",
  discount: "#8b5cf6",
};

const COLORS_VENDORS = ["#10b981", "#3b82f6", "#f59e0b", "#ef4444", "#8b5cf6"];

function CustomTooltip({
  active,
  payload,
}: {
  active?: boolean;
  payload?: any[];
}) {
  if (active && payload && payload.length) {
    return (
      <div className="bg-[#1a1a1a] border border-[#333] rounded-lg p-3 shadow-lg">
        <p className="text-text1 font-medium">{payload[0].payload.name}</p>
        {payload.map((entry, idx) => (
          <p key={idx} style={{ color: entry.color }} className="text-sm">
            {entry.name}: {typeof entry.value === "number" ? entry.value.toLocaleString() : entry.value}
          </p>
        ))}
      </div>
    );
  }
  return null;
}

function Skeleton() {
  return (
    <div className="bg-[#1a1a1a] rounded-lg h-10 animate-pulse" />
  );
}

export default function AnalyticsPage() {
  const { supervisorId, activeUser, isBossView } = useUser();

  const [stats, setStats] = useState<Stats | null>(null);
  const [epos, setEPOs] = useState<EPO[]>([]);
  const [loading, setLoading] = useState(true);
  const [exporting, setExporting] = useState(false);
  const [exportDays, setExportDays] = useState(30);

  // Processed chart data
  const [statusData, setStatusData] = useState<ChartData[]>([]);
  const [monthlyData, setMonthlyData] = useState<ChartData[]>([]);
  const [vendorData, setVendorData] = useState<ChartData[]>([]);
  const [communityData, setCommunityData] = useState<ChartData[]>([]);
  const [vendorStats, setVendorStats] = useState<VendorStats[]>([]);
  const [overdueEPOs, setOverdueEPOs] = useState<OverdueEPO[]>([]);

  useEffect(() => {
    const loadData = async () => {
      try {
        setLoading(true);

        // Load stats and EPOs
        const [statsData, eposData] = await Promise.all([
          getStats(supervisorId),
          getEPOs(undefined, supervisorId),
        ]);

        setStats(statsData);
        setEPOs(eposData);

        // Process status breakdown
        if (eposData.length > 0) {
          const statusBreakdown = {
            confirmed: eposData.filter((e) => e.status === "confirmed").length,
            pending: eposData.filter((e) => e.status === "pending").length,
            denied: eposData.filter((e) => e.status === "denied").length,
            discount: eposData.filter((e) => e.status === "discount").length,
          };

          setStatusData([
            { name: "Confirmed", value: statusBreakdown.confirmed },
            { name: "Pending", value: statusBreakdown.pending },
            { name: "Denied", value: statusBreakdown.denied },
            { name: "Discount", value: statusBreakdown.discount },
          ]);

          // Process monthly trend
          const monthlyMap: Record<string, number> = {};
          eposData.forEach((e) => {
            const date = new Date(e.created_at);
            const monthKey = date.toLocaleDateString("en-US", {
              year: "numeric",
              month: "short",
            });
            monthlyMap[monthKey] = (monthlyMap[monthKey] || 0) + 1;
          });

          const sortedMonths = Object.entries(monthlyMap)
            .sort((a, b) => {
              const dateA = new Date(a[0]);
              const dateB = new Date(b[0]);
              return dateA.getTime() - dateB.getTime();
            })
            .slice(-12);

          setMonthlyData(
            sortedMonths.map(([month, count]) => ({
              name: month,
              count,
            }))
          );

          // Process vendor data
          const vendorMap: Record<
            string,
            { count: number; amount: number }
          > = {};
          eposData.forEach((e) => {
            const vendor = e.vendor_name || "Unknown";
            if (!vendorMap[vendor]) {
              vendorMap[vendor] = { count: 0, amount: 0 };
            }
            vendorMap[vendor].count++;
            vendorMap[vendor].amount += e.amount || 0;
          });

          const topVendors = Object.entries(vendorMap)
            .map(([name, data]) => ({
              name,
              count: data.count,
              amount: data.amount,
            }))
            .sort((a, b) => b.count - a.count)
            .slice(0, 8);

          setVendorData(topVendors);

          // Vendor statistics for table
          setVendorStats(
            Object.entries(vendorMap)
              .map(([name, data]) => ({
                vendor: name,
                totalValue: data.amount,
                epoCount: data.count,
                avgAmount: Math.round(data.amount / data.count),
              }))
              .sort((a, b) => b.totalValue - a.totalValue)
              .slice(0, 10)
          );

          // Process community data
          const communityMap: Record<string, number> = {};
          eposData.forEach((e) => {
            const community = e.community || "Unknown";
            communityMap[community] = (communityMap[community] || 0) + 1;
          });

          setCommunityData(
            Object.entries(communityMap)
              .map(([name, count]) => ({
                name,
                count,
              }))
              .sort((a, b) => b.count - a.count)
          );

          // Overdue EPOs (more than 30 days open)
          const overdue = eposData
            .filter((e) => e.days_open > 30 && e.status === "pending")
            .map((e) => ({
              vendor: e.vendor_name || "Unknown",
              community: e.community || "Unknown",
              daysOpen: e.days_open,
              amount: e.amount || 0,
              status: e.status,
            }))
            .sort((a, b) => b.daysOpen - a.daysOpen)
            .slice(0, 10);

          setOverdueEPOs(overdue);
        }
      } catch (error) {
        console.error("Failed to load analytics data:", error);
      } finally {
        setLoading(false);
      }
    };

    loadData();
  }, [supervisorId]);

  const handleExportCSV = async () => {
    try {
      setExporting(true);
      await downloadCSV({ days: exportDays });
    } catch (error) {
      console.error("Export failed:", error);
    } finally {
      setExporting(false);
    }
  };

  const handleSummaryReport = async () => {
    try {
      setExporting(true);
      const summary = await getExportSummary(exportDays);
      // Download as JSON or could format as CSV
      const blob = new Blob([JSON.stringify(summary, null, 2)], {
        type: "application/json",
      });
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = `epo-summary-${exportDays}days.json`;
      a.click();
      URL.revokeObjectURL(a.href);
    } catch (error) {
      console.error("Summary report failed:", error);
    } finally {
      setExporting(false);
    }
  };

  if (loading) {
    return (
      <div className="p-8 space-y-6 bg-[#0a0a0a] min-h-screen">
        <div>
          <h1 className="text-3xl font-semibold mb-2 text-text1">Analytics</h1>
          <p className="text-text2">Loading data...</p>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
          {[1, 2, 3, 4].map((i) => (
            <div key={i} className="bg-[#111] rounded-lg p-6">
              <Skeleton />
              <Skeleton />
            </div>
          ))}
        </div>
      </div>
    );
  }

  const avgResponseDays = stats?.avg_amount
    ? Math.round(stats.avg_amount / 100)
    : 0;

  return (
    <div className="p-8 space-y-8 bg-[#0a0a0a] min-h-screen">
      {/* Header */}
      <div>
        <h1 className="text-3xl font-semibold mb-2 text-text1">Analytics</h1>
        <p className="text-text2">
          {isBossView
            ? "Performance breakdown across all communities"
            : `${activeUser?.full_name} — ${(activeUser?.communities ?? []).join(", ")}`}
        </p>
      </div>

      {/* KPI Cards Row */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
        {/* Capture Rate */}
        <div className="bg-[#111] rounded-lg p-6 border border-[#222]">
          <div className="flex items-start justify-between mb-4">
            <div>
              <p className="text-text3 text-sm mb-1">Capture Rate</p>
              <div className="flex items-baseline gap-2">
                <span className="text-3xl font-bold text-emerald-400">
                  {stats?.capture_rate || 0}%
                </span>
              </div>
            </div>
            <div className="w-16 h-16 rounded-full bg-[#1a1a1a] flex items-center justify-center border-2 border-emerald-500/30">
              <TrendingUp className="w-8 h-8 text-emerald-400" />
            </div>
          </div>
          <p className="text-text3 text-xs">
            {stats?.confirmed || 0} of {stats?.total || 0} confirmed
          </p>
        </div>

        {/* Total EPO Value */}
        <div className="bg-[#111] rounded-lg p-6 border border-[#222]">
          <div className="flex items-start justify-between mb-4">
            <div>
              <p className="text-text3 text-sm mb-1">Total EPO Value</p>
              <div className="flex items-baseline gap-2">
                <span className="text-3xl font-bold text-blue-400">
                  ${(stats?.total_value || 0).toLocaleString()}
                </span>
              </div>
            </div>
            <div className="w-16 h-16 rounded-full bg-[#1a1a1a] flex items-center justify-center border-2 border-blue-500/30">
              <DollarSign className="w-8 h-8 text-blue-400" />
            </div>
          </div>
          <p className="text-text3 text-xs">
            {stats?.total || 0} total EPOs
          </p>
        </div>

        {/* Average Response Time */}
        <div className="bg-[#111] rounded-lg p-6 border border-[#222]">
          <div className="flex items-start justify-between mb-4">
            <div>
              <p className="text-text3 text-sm mb-1">Avg Response Time</p>
              <div className="flex items-baseline gap-2">
                <span className="text-3xl font-bold text-amber-400">
                  {stats?.avg_amount ? Math.round(stats.avg_amount) : 0}
                </span>
                <span className="text-sm text-text3">days</span>
              </div>
            </div>
            <div className="w-16 h-16 rounded-full bg-[#1a1a1a] flex items-center justify-center border-2 border-amber-500/30">
              <Clock className="w-8 h-8 text-amber-400" />
            </div>
          </div>
          <p className="text-text3 text-xs">
            Average days to confirmation
          </p>
        </div>

        {/* Needing Attention */}
        <div className="bg-[#111] rounded-lg p-6 border border-[#222]">
          <div className="flex items-start justify-between mb-4">
            <div>
              <p className="text-text3 text-sm mb-1">Needs Attention</p>
              <div className="flex items-baseline gap-2">
                <span className="text-3xl font-bold text-red-400">
                  {stats?.needs_followup || 0}
                </span>
              </div>
            </div>
            <div className="w-16 h-16 rounded-full bg-[#1a1a1a] flex items-center justify-center border-2 border-red-500/30">
              <AlertCircle className="w-8 h-8 text-red-400" />
            </div>
          </div>
          <p className="text-text3 text-xs">
            Pending review or follow-up
          </p>
        </div>
      </div>

      {/* Charts Row */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Status Breakdown */}
        <div className="bg-[#111] rounded-lg p-6 border border-[#222]">
          <h2 className="text-lg font-semibold text-text1 mb-6">
            EPO Status Breakdown
          </h2>
          {statusData.some((d) => (d.value ?? 0) > 0) ? (
            <ResponsiveContainer width="100%" height={300}>
              <PieChart>
                <Pie
                  data={statusData.filter((d) => (d.value ?? 0) > 0)}
                  cx="50%"
                  cy="50%"
                  labelLine={true}
                  label={({ name, value, percent }) =>
                    `${name}: ${value} (${((percent ?? 0) * 100).toFixed(0)}%)`
                  }
                  outerRadius={90}
                  innerRadius={40}
                  fill="#8884d8"
                  dataKey="value"
                  paddingAngle={2}
                  stroke="none"
                >
                  {statusData
                    .filter((d) => (d.value ?? 0) > 0)
                    .map((entry) => (
                      <Cell
                        key={`cell-${entry.name}`}
                        fill={
                          COLORS_STATUS[
                            entry.name.toLowerCase() as keyof typeof COLORS_STATUS
                          ] || "#999"
                        }
                      />
                    ))}
                </Pie>
                <Tooltip content={<CustomTooltip />} />
                <Legend
                  verticalAlign="bottom"
                  height={36}
                  formatter={(value: string) => (
                    <span style={{ color: "#999", fontSize: "12px" }}>{value}</span>
                  )}
                />
              </PieChart>
            </ResponsiveContainer>
          ) : (
            <div className="h-[300px] flex items-center justify-center text-text3">
              No data available
            </div>
          )}
        </div>

        {/* Monthly Trend */}
        <div className="bg-[#111] rounded-lg p-6 border border-[#222]">
          <h2 className="text-lg font-semibold text-text1 mb-6">
            Monthly EPO Trend
          </h2>
          {monthlyData.length > 0 ? (
            <ResponsiveContainer width="100%" height={300}>
              <AreaChart data={monthlyData}>
                <defs>
                  <linearGradient id="colorCount" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#10b981" stopOpacity={0.8} />
                    <stop offset="95%" stopColor="#10b981" stopOpacity={0.1} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="#333" />
                <XAxis dataKey="name" stroke="#666" />
                <YAxis stroke="#666" />
                <Tooltip content={<CustomTooltip />} />
                <Area
                  type="monotone"
                  dataKey="count"
                  stroke="#10b981"
                  fillOpacity={1}
                  fill="url(#colorCount)"
                />
              </AreaChart>
            </ResponsiveContainer>
          ) : (
            <div className="h-[300px] flex items-center justify-center text-text3">
              No data available
            </div>
          )}
        </div>
      </div>

      {/* Charts Row 2 */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Top Vendors */}
        <div className="bg-[#111] rounded-lg p-6 border border-[#222]">
          <h2 className="text-lg font-semibold text-text1 mb-6">
            Top Builders by EPO Count
          </h2>
          {vendorData.length > 0 ? (
            <ResponsiveContainer width="100%" height={300}>
              <BarChart
                data={vendorData}
                layout="vertical"
                margin={{ top: 5, right: 30, left: 200, bottom: 5 }}
              >
                <CartesianGrid strokeDasharray="3 3" stroke="#333" />
                <XAxis type="number" stroke="#666" />
                <YAxis
                  dataKey="name"
                  type="category"
                  stroke="#666"
                  width={180}
                  tick={{ fontSize: 12 }}
                />
                <Tooltip content={<CustomTooltip />} />
                <Bar dataKey="count" fill="#3b82f6" radius={[0, 8, 8, 0]} />
              </BarChart>
            </ResponsiveContainer>
          ) : (
            <div className="h-[300px] flex items-center justify-center text-text3">
              No data available
            </div>
          )}
        </div>

        {/* Community Breakdown */}
        <div className="bg-[#111] rounded-lg p-6 border border-[#222]">
          <h2 className="text-lg font-semibold text-text1 mb-6">
            Community Breakdown
          </h2>
          {communityData.length > 0 ? (
            <ResponsiveContainer width="100%" height={300}>
              <BarChart data={communityData}>
                <CartesianGrid strokeDasharray="3 3" stroke="#333" />
                <XAxis dataKey="name" stroke="#666" />
                <YAxis stroke="#666" />
                <Tooltip content={<CustomTooltip />} />
                <Bar dataKey="count" fill="#10b981" radius={[8, 8, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          ) : (
            <div className="h-[300px] flex items-center justify-center text-text3">
              No data available
            </div>
          )}
        </div>
      </div>

      {/* Tables Section */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Top Vendors by Value */}
        <div className="bg-[#111] rounded-lg p-6 border border-[#222] overflow-hidden">
          <h2 className="text-lg font-semibold text-text1 mb-6">
            Top Builders by Total Value
          </h2>
          {vendorStats.length > 0 ? (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-[#333]">
                    <th className="text-left text-text2 font-semibold pb-3">
                      Rank
                    </th>
                    <th className="text-left text-text2 font-semibold pb-3">
                      Builder
                    </th>
                    <th className="text-right text-text2 font-semibold pb-3">
                      Total Value
                    </th>
                    <th className="text-right text-text2 font-semibold pb-3">
                      EPOs
                    </th>
                    <th className="text-right text-text2 font-semibold pb-3">
                      Avg Amount
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {vendorStats.map((vendor, idx) => (
                    <tr
                      key={vendor.vendor}
                      className="border-b border-[#1a1a1a] hover:bg-[#1a1a1a] transition-colors"
                    >
                      <td className="py-3 text-text3">{idx + 1}</td>
                      <td className="py-3 text-text1 font-medium">
                        {vendor.vendor}
                      </td>
                      <td className="py-3 text-right text-emerald-400 font-semibold">
                        ${vendor.totalValue.toLocaleString()}
                      </td>
                      <td className="py-3 text-right text-text2">
                        {vendor.epoCount}
                      </td>
                      <td className="py-3 text-right text-text2">
                        ${vendor.avgAmount.toLocaleString()}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="text-text3 text-sm">No builder data available</p>
          )}
        </div>

        {/* Overdue EPOs */}
        <div className="bg-[#111] rounded-lg p-6 border border-[#222] overflow-hidden">
          <h2 className="text-lg font-semibold text-text1 mb-6">
            Overdue EPOs (30+ Days)
          </h2>
          {overdueEPOs.length > 0 ? (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-[#333]">
                    <th className="text-left text-text2 font-semibold pb-3">
                      Builder
                    </th>
                    <th className="text-left text-text2 font-semibold pb-3">
                      Community
                    </th>
                    <th className="text-right text-text2 font-semibold pb-3">
                      Days Open
                    </th>
                    <th className="text-right text-text2 font-semibold pb-3">
                      Amount
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {overdueEPOs.map((epo, idx) => (
                    <tr
                      key={idx}
                      className="border-b border-[#1a1a1a] hover:bg-[#1a1a1a] transition-colors"
                    >
                      <td className="py-3 text-text1 font-medium">
                        {epo.vendor}
                      </td>
                      <td className="py-3 text-text2">{epo.community}</td>
                      <td className="py-3 text-right text-red-400 font-semibold">
                        {epo.daysOpen}
                      </td>
                      <td className="py-3 text-right text-text1">
                        ${epo.amount.toLocaleString()}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="text-text3 text-sm">No overdue EPOs</p>
          )}
        </div>
      </div>

      {/* Export Section */}
      <div className="bg-[#111] rounded-lg p-6 border border-[#222]">
        <h2 className="text-lg font-semibold text-text1 mb-6">Export Data</h2>
        <div className="space-y-4">
          <div className="flex flex-col sm:flex-row gap-4 items-end">
            <div className="flex-1 min-w-[200px]">
              <label className="block text-sm font-medium text-text2 mb-2">
                Date Range
              </label>
              <select
                value={exportDays}
                onChange={(e) => setExportDays(parseInt(e.target.value))}
                className="w-full bg-[#1a1a1a] border border-[#333] rounded-lg px-4 py-2 text-text1 focus:outline-none focus:border-emerald-500"
              >
                <option value={7}>Last 7 days</option>
                <option value={30}>Last 30 days</option>
                <option value={90}>Last 90 days</option>
              </select>
            </div>

            <button
              onClick={handleExportCSV}
              disabled={exporting}
              className="flex items-center gap-2 px-6 py-2 bg-emerald-600 hover:bg-emerald-700 disabled:bg-emerald-600/50 rounded-lg text-white font-medium transition-colors"
            >
              {exporting ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <Download className="w-4 h-4" />
              )}
              Export CSV
            </button>

            <button
              onClick={handleSummaryReport}
              disabled={exporting}
              className="flex items-center gap-2 px-6 py-2 bg-blue-600 hover:bg-blue-700 disabled:bg-blue-600/50 rounded-lg text-white font-medium transition-colors"
            >
              {exporting ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <FileText className="w-4 h-4" />
              )}
              Summary Report
            </button>
          </div>
          <p className="text-text3 text-sm">
            Download detailed EPO data or generate a summary report for your selected date range.
          </p>
        </div>
      </div>
    </div>
  );
}
