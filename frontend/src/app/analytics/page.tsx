"use client";

import { useState, useEffect } from "react";
import { getEPOs } from "@/lib/api";
import { useUser } from "@/lib/user-context";
import type { EPO } from "@/lib/api";

interface CommunityData {
  name: string;
  count: number;
  amount: number;
  captureRate: number;
}

interface VendorData {
  name: string;
  count: number;
  amount: number;
}

export default function AnalyticsPage() {
  const { supervisorId, activeUser, isBossView } = useUser();
  const [communities, setCommunities] = useState<CommunityData[]>([]);
  const [vendors, setVendors] = useState<VendorData[]>([]);

  useEffect(() => {
    const loadData = async () => {
      const epos = await getEPOs(undefined, supervisorId);
      if (epos.length === 0) return;

      // Aggregate by community
      const commMap: Record<string, { total: number; confirmed: number; amount: number }> = {};
      const vendMap: Record<string, { count: number; amount: number }> = {};

      for (const e of epos) {
        const comm = e.community || "Unknown";
        if (!commMap[comm]) commMap[comm] = { total: 0, confirmed: 0, amount: 0 };
        commMap[comm].total++;
        commMap[comm].amount += e.amount || 0;
        if (e.status === "confirmed") commMap[comm].confirmed++;

        const vend = e.vendor_name || "Unknown";
        if (!vendMap[vend]) vendMap[vend] = { count: 0, amount: 0 };
        vendMap[vend].count++;
        vendMap[vend].amount += e.amount || 0;
      }

      setCommunities(
        Object.entries(commMap)
          .map(([name, d]) => ({
            name,
            count: d.total,
            amount: Math.round(d.amount),
            captureRate: d.total > 0 ? Math.round((d.confirmed / d.total) * 100) : 0,
          }))
          .sort((a, b) => b.amount - a.amount)
      );

      setVendors(
        Object.entries(vendMap)
          .map(([name, d]) => ({ name, count: d.count, amount: Math.round(d.amount) }))
          .sort((a, b) => b.count - a.count)
      );
    };
    loadData();
  }, [supervisorId]);

  const commData = communities;
  const vendData = vendors;

  return (
    <div className="p-8 space-y-6">
      <div>
        <h1 className="text-3xl font-semibold mb-2">Analytics</h1>
        <p className="text-text2">
          {isBossView
            ? "Performance breakdown across all communities"
            : `${activeUser?.full_name} — ${activeUser?.communities.join(", ")}`}
        </p>
      </div>

      {commData.length > 0 || vendData.length > 0 ? (
        <div className="grid grid-cols-2 gap-8">
          {/* By Community */}
          <div>
            <h2 className="label mb-6">By Community</h2>
            <div className="space-y-6">
              {commData.map((c) => (
                <div key={c.name} className="card p-6">
                  <div className="flex justify-between items-start mb-4">
                    <h3 className="font-semibold text-text1">{c.name}</h3>
                    <span className="font-mono text-sm text-text2">
                      ${c.amount.toLocaleString()}
                    </span>
                  </div>
                  <div className="w-full h-1.5 bg-surface rounded-full overflow-hidden">
                    <div
                      className="h-full rounded-full transition-all duration-500"
                      style={{
                        width: `${c.captureRate}%`,
                        backgroundColor: c.captureRate >= 60 ? "rgb(52,211,153)" : c.captureRate > 0 ? "rgb(251,191,36)" : "rgba(255,255,255,0.3)",
                        opacity: 0.7,
                      }}
                    />
                  </div>
                  <div className="mt-3 flex justify-between text-xs text-text3">
                    <span className="font-mono">{c.count} EPOs</span>
                    <span className="font-mono" style={{ color: c.captureRate >= 60 ? "rgb(52,211,153)" : c.captureRate > 0 ? "rgb(251,191,36)" : undefined }}>
                      {c.captureRate}% capture
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* By Vendor */}
          <div>
            <h2 className="label mb-6">By Vendor</h2>
            <div className="space-y-4">
              {vendData.map((v) => (
                <div key={v.name} className="card p-6 flex items-center justify-between">
                  <div className="flex items-center gap-4 flex-1">
                    <div className="w-10 h-10 rounded-lg bg-surface border border-borderLt flex items-center justify-center">
                      <span className="font-mono text-sm text-text2">{v.name.charAt(0)}</span>
                    </div>
                    <div>
                      <h3 className="font-semibold text-text1">{v.name}</h3>
                      <span className="font-mono text-xs text-text3">{v.count} EPOs</span>
                    </div>
                  </div>
                  <span className="font-mono text-lg text-text1">${v.amount.toLocaleString()}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      ) : (
        <div className="card p-12 text-center">
          <p className="text-text3 text-sm">No analytics data available yet</p>
        </div>
      )}
    </div>
  );
}
