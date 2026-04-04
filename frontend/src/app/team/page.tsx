"use client";

import { useState, useEffect } from "react";
import { Users, ChevronRight, AlertTriangle, CheckCircle } from "lucide-react";

const API_BASE = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";

interface TeamMember {
  id: number;
  full_name: string;
  email: string;
  role: string;
  communities: string[];
  stats: {
    total: number;
    confirmed: number;
    pending: number;
    denied: number;
    total_value: number;
    capture_rate: number;
    needs_followup: number;
    overdue: number;
  };
  health: "green" | "amber" | "red";
}

const healthColors = {
  green: { bg: "rgba(52,211,153,0.12)", border: "rgba(52,211,153,0.25)", text: "rgb(52,211,153)", label: "On Track" },
  amber: { bg: "rgba(251,191,36,0.12)", border: "rgba(251,191,36,0.25)", text: "rgb(251,191,36)", label: "Needs Attention" },
  red: { bg: "rgba(248,113,113,0.12)", border: "rgba(248,113,113,0.25)", text: "rgb(248,113,113)", label: "Overdue" },
};

export default function TeamPage() {
  const [members, setMembers] = useState<TeamMember[]>([]);
  const [selectedMember, setSelectedMember] = useState<TeamMember | null>(null);
  const [memberEpos, setMemberEpos] = useState<any[]>([]);

  useEffect(() => {
    fetch(`${API_BASE}/api/team/members`)
      .then((r) => r.json())
      .then((d) => setMembers(d.members?.filter((m: TeamMember) => m.role !== "admin") || []))
      .catch(() => setMembers([]));
  }, []);

  const handleSelectMember = async (member: TeamMember) => {
    setSelectedMember(member);
    try {
      const res = await fetch(`${API_BASE}/api/team/members/${member.id}/epos`);
      const data = await res.json();
      setMemberEpos(data.epos || []);
    } catch {
      setMemberEpos([]);
    }
  };

  const statusColor = (s: string) => {
    if (s === "confirmed") return "rgb(52,211,153)";
    if (s === "pending") return "rgb(251,191,36)";
    if (s === "denied") return "rgb(248,113,113)";
    return "rgb(192,160,255)";
  };

  return (
    <div className="p-8 space-y-6">
      <div>
        <h1 className="text-3xl font-semibold mb-2">Team</h1>
        <p className="text-text2">Monitor supervisor performance across communities</p>
      </div>

      {/* Supervisor Cards Grid */}
      <div className="grid grid-cols-3 gap-4">
        {members.map((m) => {
          const h = healthColors[m.health];
          const isSelected = selectedMember?.id === m.id;
          return (
            <div
              key={m.id}
              onClick={() => handleSelectMember(m)}
              className="card p-5 cursor-pointer transition-all duration-150"
              style={{
                borderColor: isSelected ? "rgba(255,255,255,0.2)" : undefined,
                background: isSelected ? "rgba(255,255,255,0.08)" : undefined,
              }}
            >
              {/* Header */}
              <div className="flex items-center justify-between mb-4">
                <div className="flex items-center gap-3">
                  <div
                    className="w-9 h-9 rounded-lg flex items-center justify-center text-sm font-semibold"
                    style={{ background: h.bg, border: `1px solid ${h.border}`, color: h.text }}
                  >
                    {m.full_name.split(" ").map((n) => n[0]).join("")}
                  </div>
                  <div>
                    <div className="text-sm font-medium text-text1">{m.full_name}</div>
                    <div className="text-xs text-text3">{m.communities.join(", ")}</div>
                  </div>
                </div>
                <ChevronRight size={14} className="text-text3" />
              </div>

              {/* Stats Row */}
              <div className="grid grid-cols-3 gap-3">
                <div>
                  <div className="label mb-1">EPOs</div>
                  <div className="font-mono text-lg text-text1">{m.stats.total}</div>
                </div>
                <div>
                  <div className="label mb-1">Capture</div>
                  <div className="font-mono text-lg" style={{ color: m.stats.capture_rate >= 50 ? "rgb(52,211,153)" : "rgb(251,191,36)" }}>
                    {m.stats.capture_rate}%
                  </div>
                </div>
                <div>
                  <div className="label mb-1">Value</div>
                  <div className="font-mono text-lg text-text1">
                    ${m.stats.total_value >= 1000 ? (m.stats.total_value / 1000).toFixed(1) + "K" : m.stats.total_value}
                  </div>
                </div>
              </div>

              {/* Health indicator */}
              {m.stats.needs_followup > 0 && (
                <div
                  className="mt-3 flex items-center gap-2 text-xs px-3 py-1.5 rounded-md"
                  style={{ background: h.bg, border: `1px solid ${h.border}`, color: h.text }}
                >
                  <AlertTriangle size={12} />
                  {m.stats.needs_followup} need{m.stats.needs_followup > 1 ? "" : "s"} follow-up
                  {m.stats.overdue > 0 && ` (${m.stats.overdue} overdue)`}
                </div>
              )}
              {m.stats.needs_followup === 0 && (
                <div
                  className="mt-3 flex items-center gap-2 text-xs px-3 py-1.5 rounded-md"
                  style={{ background: healthColors.green.bg, border: `1px solid ${healthColors.green.border}`, color: healthColors.green.text }}
                >
                  <CheckCircle size={12} />
                  All EPOs on track
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Selected Supervisor Detail */}
      {selectedMember && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-medium text-text1">
              {selectedMember.full_name}&apos;s EPOs
              <span className="text-text3 text-sm ml-2">
                {selectedMember.communities.join(", ")}
              </span>
            </h2>
            <button
              onClick={() => setSelectedMember(null)}
              className="text-xs text-text3 hover:text-text1 transition-colors"
            >
              Close
            </button>
          </div>

          <div className="card p-0 overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border">
                  {["Builder", "Community", "Lot", "Description", "Amount", "Status", "Age"].map((h) => (
                    <th key={h} className="text-left px-4 py-3 label">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {memberEpos.map((e: any) => (
                  <tr key={e.id} className="border-b border-border hover:bg-surface transition-colors">
                    <td className="px-4 py-3 text-text1 font-medium">{e.vendor_name}</td>
                    <td className="px-4 py-3 text-text2">{e.community}</td>
                    <td className="px-4 py-3">
                      <span className="font-mono text-xs px-2 py-0.5 rounded bg-[rgba(144,191,249,0.1)] text-[rgb(144,191,249)] border border-[rgba(144,191,249,0.2)]">
                        {e.lot_number}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-text3 max-w-[200px] truncate">{e.description}</td>
                    <td className="px-4 py-3 font-mono text-text1">{e.amount != null ? `$${e.amount}` : "—"}</td>
                    <td className="px-4 py-3">
                      <span
                        className="inline-flex items-center gap-1.5 text-xs px-2 py-0.5 rounded-md border"
                        style={{
                          color: statusColor(e.status),
                          background: statusColor(e.status).replace("rgb", "rgba").replace(")", ",0.12)"),
                          borderColor: statusColor(e.status).replace("rgb", "rgba").replace(")", ",0.25)"),
                        }}
                      >
                        <span className="w-1.5 h-1.5 rounded-full" style={{ background: statusColor(e.status) }} />
                        {e.status.charAt(0).toUpperCase() + e.status.slice(1)}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <span className="font-mono text-xs" style={{ color: (e.days_open || 0) >= 7 ? "rgb(248,113,113)" : (e.days_open || 0) >= 4 ? "rgb(251,191,36)" : "rgba(255,255,255,0.3)" }}>
                        {e.days_open || 0}d
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Empty state if no member selected */}
      {!selectedMember && members.length > 0 && (
        <div className="card p-12 text-center">
          <Users size={32} className="mx-auto mb-3 text-text3" />
          <p className="text-text2 text-sm">Select a supervisor above to view their EPOs</p>
        </div>
      )}
    </div>
  );
}

