"use client";

import { useState } from "react";
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
import { downloadCSV, getExportSummary } from "@/lib/api";
import { useUser } from "@/lib/user-context";
import { useStats, useEPOs } from "@/hooks/useEPOs";
import type { EPO, Stats } from "@/lib/api";
import {
  TrendingUp,
  DollarSign,
  Clock,
  AlertCircle,
  Download,
  FileText,
  Loader2,
  BarChart3,
  ArrowRight,
} from "lucide-react";
import Link from "next/link";

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

  const { data: stats = null, isLoading } = useStats(supervisorId);
  const { data: epos = [], isLoading: eposLoading } = useEPOs({
    supervisorId,
  });

  const [exporting, setExporting] = useState(false);
  const [exportDays, setExportDays] = useState(30);

  // Compute loading state
  const loading = isLoading || eposLoading;

  // Processed chart data
  const statusData: ChartData[] = (() => {
    if (!epos.length) return [];
    const statusBreakdown = {
      confirmed: epos.filter((e) => e.status === "confirmed").length,
      pending: epos.filter((e) => e.status === "pending").length,
      denied: epos.filter((e) => e.status === "denied").length,
      discount: epos.filter((e) => e.status === "discount").length,
    };
    return [
      { name: "Confirmed", value: statusBreakdown.confirmed },
      { name: "Pending", value: statusBreakdown.pending },
      { name: "Denied", value: statusBreakdown.denied },
      { name: "Discount", value: statusBreakdown.discount },
    ];
  })();

  const monthlyData: ChartData[] = (() => {
    if (!epos.length) return [];
    const monthlyMap: Record<string, number> = {};
    epos.forEach((e) => {
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

    return sortedMonths.map(([month, count]) => ({
      name: month,
      count,
    }));
  })();

  const vendorData: ChartData[] = (() => {
    if (!epos.length) return [];
    const vendorMap: Record<string, { count: number; amount: number }> = {};
    epos.forEach((e) => {
      const vendor = e.vendor_name || "Unknown";
      if (!vendorMap[vendor]) {
        vendorMap[vendor] = { count: 0, amount: 0 };
      }
      vendorMap[vendor].count++;
      vendorMap[vendor].amount += e.amount || 0;
    });

    return Object.entries(vendorMap)
      .map(([name, data]) => ({
        name,
        count: data.count,
        amount: data.amount,
      }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 8);
  })();

  const vendorStats: VendorStats[] = (() => {
    if (!epos.length) return [];
    const vendorMap: Record<string, { count: number; amount: number }> = {};
    epos.forEach((e) => {
      const vendor = e.vendor_name || "Unknown";
      if (!vendorMap[vendor]) {
        vendorMap[vendor] = { count: 0, amount: 0 };
      }
      vendorMap[vendor].count++;
      vendorMap[vendor].amount += e.amount || 0;
    });

    return Object.entries(vendorMap)
      .map(([name, data]) => ({
        vendor: name,
        totalValue: data.amount,
        epoCount: data.count,
        avgAmount: Math.round(data.amount / data.count),
      }))
      .sort((a, b) => b.totalValue - a.totalValue)
      .slice(0, 10);
  })();

  const communityData: ChartData[] = (() => {
    if (!epos.length) return [];
    const communityMap: Record<string, number> = {};
    epos.forEach((e) => {
      const community = e.community || "Unknown";
      communityMap[community] = (communityMap[community] || 0) + 1;
    });

    return Object.entries(communityMap)
      .map(([name, count]) => ({
        name,
        count,
      }))
      .sort((a, b) => b.count - a.count);
  })();

  const overdueEPOs: OverdueEPO[] = (() => {
    if (!epos.length) return [];
    return epos
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
  })();

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
      const o = summary.overview || {};
      const vendors = summary.by_vendor || [];
      const communities = summary.by_community || [];

      // Generate a professional HTML report
      const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Onyx EPO Report — ${summary.date_from} to ${summary.date_to}</title>
<style>
*{margin:0;padding:0;box-sizing:border-box}
body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;background:#0a0a0a;color:#fff;padding:40px}
.container{max-width:800px;margin:0 auto}
h1{font-size:28px;margin-bottom:4px}
.subtitle{color:#999;font-size:14px;margin-bottom:32px}
.kpi-grid{display:grid;grid-template-columns:repeat(4,1fr);gap:16px;margin-bottom:32px}
.kpi{background:#111;border:1px solid #222;border-radius:12px;padding:20px}
.kpi-label{font-size:12px;color:#999;text-transform:uppercase;letter-spacing:0.05em;margin-bottom:4px}
.kpi-value{font-size:28px;font-weight:700}
.green{color:#34d399}.blue{color:#60a5fa}.amber{color:#fbbf24}.red{color:#f87171}
h2{font-size:18px;margin:32px 0 16px;border-bottom:1px solid #222;padding-bottom:8px}
table{width:100%;border-collapse:collapse;font-size:14px}
th{text-align:left;color:#999;font-weight:600;padding:8px 12px;border-bottom:1px solid #333}
td{padding:8px 12px;border-bottom:1px solid #1a1a1a}
tr:hover{background:#1a1a1a}
.right{text-align:right}
.logo{display:flex;align-items:center;gap:8px;margin-bottom:24px}
.logo-text{font-size:20px;font-weight:700;letter-spacing:0.05em;color:#34d399}
.footer{margin-top:40px;padding-top:16px;border-top:1px solid #222;color:#666;font-size:12px;text-align:center}
@media print{body{background:#fff;color:#000}.kpi{border-color:#ddd}th{color:#666;border-color:#ddd}td{border-color:#eee}tr:hover{background:transparent}.green,.blue,.amber,.red{color:#000}}
</style>
</head>
<body>
<div class="container">
<div class="logo"><span class="logo-text">ONYX</span></div>
<h1>EPO Summary Report</h1>
<p class="subtitle">${summary.date_from} — ${summary.date_to} (${summary.period_days} days)</p>
<div class="kpi-grid">
<div class="kpi"><div class="kpi-label">Total EPOs</div><div class="kpi-value blue">${o.total}</div></div>
<div class="kpi"><div class="kpi-label">Capture Rate</div><div class="kpi-value green">${o.capture_rate}%</div></div>
<div class="kpi"><div class="kpi-label">Total Value</div><div class="kpi-value amber">$${(o.total_value||0).toLocaleString()}</div></div>
<div class="kpi"><div class="kpi-label">Avg Days Open</div><div class="kpi-value ${(o.avg_days_open||0)>7?'red':'green'}">${o.avg_days_open||0}</div></div>
</div>
<div class="kpi-grid">
<div class="kpi"><div class="kpi-label">Confirmed</div><div class="kpi-value green">${o.confirmed}</div></div>
<div class="kpi"><div class="kpi-label">Pending</div><div class="kpi-value amber">${o.pending}</div></div>
<div class="kpi"><div class="kpi-label">Denied</div><div class="kpi-value red">${o.denied}</div></div>
<div class="kpi"><div class="kpi-label">Overdue</div><div class="kpi-value red">${o.overdue_count}</div></div>
</div>
<h2>By Builder</h2>
<table><thead><tr><th>Builder</th><th class="right">EPOs</th><th class="right">Confirmed</th><th class="right">Capture Rate</th><th class="right">Total Value</th></tr></thead>
<tbody>${vendors.map((v: any) => `<tr><td>${v.vendor}</td><td class="right">${v.total}</td><td class="right">${v.confirmed}</td><td class="right">${v.capture_rate}%</td><td class="right">$${(v.total_value||0).toLocaleString()}</td></tr>`).join('')}</tbody></table>
<h2>By Community</h2>
<table><thead><tr><th>Community</th><th class="right">EPOs</th><th class="right">Confirmed</th><th class="right">Total Value</th></tr></thead>
<tbody>${communities.map((c: any) => `<tr><td>${c.community}</td><td class="right">${c.total}</td><td class="right">${c.confirmed}</td><td class="right">$${(c.total_value||0).toLocaleString()}</td></tr>`).join('')}</tbody></table>
<div class="footer">Generated by Onyx EPO Tracker — ${new Date().toLocaleDateString()}</div>
</div>
</body></html>`;

      // Open in new tab
      const blob = new Blob([html], { type: "text/html" });
      const url = URL.createObjectURL(blob);
      window.open(url, "_blank");
      setTimeout(() => URL.revokeObjectURL(url), 5000);
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

  const avgResponseDays = stats?.avg_days_open
    ? Math.round(stats.avg_days_open)
    : 0;

  return (
    <div className="p-8 space-y-8 bg-[#0a0a0a] min-h-screen">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-3xl font-semibold mb-2 text-text1">Analytics</h1>
          <p className="text-text2">
            {isBossView
              ? "Performance breakdown across all communities"
              : `${activeUser?.full_name} — ${(activeUser?.communities ?? []).join(", ")}`}
          </p>
        </div>
        <Link
          href="/analytics/builders"
          className="flex items-center gap-2 px-4 py-2.5 bg-emerald-500/10 border border-emerald-500/20 rounded-xl text-emerald-400 text-sm font-medium hover:bg-emerald-500/20 transition-colors"
        >
          <BarChart3 size={16} />
          Builder Scorecards
          <ArrowRight size={14} />
        </Link>
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
                  {avgResponseDays}
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
                margin={{ top: 5, right: 30, left: 0, bottom: 5 }}
              >
                <CartesianGrid strokeDasharray="3 3" stroke="#333" />
                <XAxis type="number" stroke="#666" />
                <YAxis
                  dataKey="name"
                  type="category"
                  stroke="#666"
                  width={130}
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
