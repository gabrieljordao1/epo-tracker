"use client";

import { useState, useEffect } from "react";
import { Users, ChevronRight, AlertTriangle, CheckCircle, Copy, Check, Trophy, Medal, ArrowUp, UserPlus, Zap, Crown } from "lucide-react";

const API_BASE = typeof window !== "undefined" ? "" : (process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000");

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

const rankColors = [
  { bg: "rgba(250,204,21,0.15)", border: "rgba(250,204,21,0.3)", text: "rgb(250,204,21)" },   // 1st - gold
  { bg: "rgba(192,192,192,0.15)", border: "rgba(192,192,192,0.3)", text: "rgb(192,192,192)" }, // 2nd - silver
  { bg: "rgba(205,127,50,0.15)", border: "rgba(205,127,50,0.3)", text: "rgb(205,127,50)" },    // 3rd - bronze
];

export default function TeamPage() {
  const [members, setMembers] = useState<TeamMember[]>([]);
  const [selectedMember, setSelectedMember] = useState<TeamMember | null>(null);
  const [memberEpos, setMemberEpos] = useState<any[]>([]);
  const [inviteCode, setInviteCode] = useState<string | null>(null);
  const [companyName, setCompanyName] = useState<string>("");
  const [copied, setCopied] = useState(false);
  const [hasGmail, setHasGmail] = useState<boolean | null>(null);
  const [joinCode, setJoinCode] = useState("");
  const [joinLoading, setJoinLoading] = useState(false);
  const [joinError, setJoinError] = useState("");
  const [joinSuccess, setJoinSuccess] = useState("");

  useEffect(() => {
    const token = typeof window !== "undefined" ? localStorage.getItem("epo_token") : null;
    if (!token) return;

    const headers = { Authorization: `Bearer ${token}` };

    // Fetch team members (include all roles — admins are company owners and should appear)
    fetch(`${API_BASE}/api/team/members`, { headers })
      .then((r) => r.json())
      .then((d) => setMembers(d.members || []))
      .catch(() => setMembers([]));

    // Fetch invite code + company name
    fetch(`${API_BASE}/api/auth/invite-code`, { headers })
      .then((r) => r.json())
      .then((d) => {
        setInviteCode(d.invite_code);
        setCompanyName(d.company_name || "");
      })
      .catch(() => {});

    // Check if Gmail is connected
    fetch(`${API_BASE}/api/email/status`, { headers })
      .then((r) => r.json())
      .then((d) => {
        setHasGmail((d.active_connections || 0) > 0);
      })
      .catch(() => setHasGmail(false));
  }, []);

  const handleCopyInvite = () => {
    if (inviteCode) {
      navigator.clipboard.writeText(inviteCode);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  const handleJoinTeam = async () => {
    if (!joinCode.trim()) return;
    setJoinLoading(true);
    setJoinError("");
    setJoinSuccess("");
    try {
      const token = typeof window !== "undefined" ? localStorage.getItem("epo_token") : null;
      const res = await fetch(`${API_BASE}/api/auth/join-team`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ invite_code: joinCode.trim().toUpperCase() }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.detail || "Failed to join team");
      setJoinSuccess(data.message || "Successfully joined the team!");
      // Reload page after a moment so they see the new company
      setTimeout(() => window.location.reload(), 1500);
    } catch (err: any) {
      setJoinError(err.message || "Failed to join team");
    } finally {
      setJoinLoading(false);
    }
  };

  const handleSelectMember = async (member: TeamMember) => {
    setSelectedMember(member);
    try {
      const token = typeof window !== "undefined" ? localStorage.getItem("epo_token") : null;
      const res = await fetch(`${API_BASE}/api/team/members/${member.id}/epos`, {
        headers: { Authorization: `Bearer ${token}` },
      });
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

  // Leaderboard: rank by capture rate, then by total EPOs as tiebreaker
  const ranked = [...members]
    .filter((m) => (m.stats?.total ?? 0) > 0)
    .sort((a, b) => {
      const bRate = b.stats?.capture_rate ?? 0;
      const aRate = a.stats?.capture_rate ?? 0;
      if (bRate !== aRate) return bRate - aRate;
      return (b.stats?.total ?? 0) - (a.stats?.total ?? 0);
    });

  return (
    <div className="p-8 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-semibold mb-2">Team</h1>
          <p className="text-text2">Monitor supervisor performance across communities</p>
        </div>
      </div>

      {/* ═══ Invite Code — always show for admins/managers ═══ */}
      {inviteCode && (
        <div className="card p-4 bg-surface flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Users size={18} className="text-text3" />
            <div>
              <span className="text-sm text-text2">Invite code for your team: </span>
              <span className="font-mono font-bold text-text1 tracking-widest text-lg ml-2">{inviteCode}</span>
            </div>
          </div>
          <button
            onClick={handleCopyInvite}
            className="btn-secondary text-sm flex items-center gap-2 px-3 py-1.5"
          >
            {copied ? <Check size={14} className="text-green" /> : <Copy size={14} />}
            {copied ? "Copied!" : "Copy"}
          </button>
        </div>
      )}

      {/* ═══ Join Team — always available (collapsible) ═══ */}
      {members.length <= 1 && (
        <div className="card p-5 bg-surface space-y-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-lg flex items-center justify-center" style={{ background: "rgba(144,191,249,0.12)", border: "1px solid rgba(144,191,249,0.25)" }}>
              <UserPlus size={18} style={{ color: "rgb(144,191,249)" }} />
            </div>
            <div>
              <div className="text-sm font-medium text-text1">Join a Team</div>
              <div className="text-xs text-text3">
                Have an invite code? Enter it below to join your manager&apos;s company.
                {hasGmail === false && (
                  <span> Or go to <a href="/integrations" className="underline" style={{ color: "rgb(144,191,249)" }}>Integrations</a> to set up Gmail.</span>
                )}
              </div>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <input
              type="text"
              value={joinCode}
              onChange={(e) => {
                setJoinCode(e.target.value.toUpperCase());
                setJoinError("");
              }}
              placeholder="Enter invite code (e.g. 6C2D11BA)"
              maxLength={8}
              className="flex-1 px-4 py-2.5 rounded-lg text-sm font-mono tracking-widest uppercase"
              style={{
                background: "rgba(255,255,255,0.06)",
                border: "1px solid rgba(255,255,255,0.1)",
                color: "white",
                outline: "none",
              }}
              onKeyDown={(e) => e.key === "Enter" && handleJoinTeam()}
            />
            <button
              onClick={handleJoinTeam}
              disabled={joinLoading || joinCode.length < 6}
              className="btn-primary text-sm flex items-center gap-2 px-5 py-2.5"
              style={{
                opacity: joinLoading || joinCode.length < 6 ? 0.5 : 1,
              }}
            >
              {joinLoading ? "Joining..." : "Join Team"}
            </button>
          </div>
          {joinError && (
            <div className="text-xs px-3 py-2 rounded-md" style={{ color: "rgb(248,113,113)", background: "rgba(248,113,113,0.1)", border: "1px solid rgba(248,113,113,0.2)" }}>
              {joinError}
            </div>
          )}
          {joinSuccess && (
            <div className="text-xs px-3 py-2 rounded-md" style={{ color: "rgb(52,211,153)", background: "rgba(52,211,153,0.1)", border: "1px solid rgba(52,211,153,0.2)" }}>
              {joinSuccess}
            </div>
          )}
        </div>
      )}

      {/* ═══ LEADERBOARD ═══ */}
      {ranked.length > 0 && (
        <div className="card p-0 overflow-hidden">
          <div className="px-5 py-4 flex items-center gap-3" style={{ borderBottom: "1px solid rgba(255,255,255,0.06)" }}>
            <Trophy size={18} style={{ color: "rgb(250,204,21)" }} />
            <div>
              <div className="text-sm font-semibold text-text1">Capture Rate Leaderboard</div>
              <div className="text-xs text-text3">Ranked by EPO capture rate — keep it competitive!</div>
            </div>
          </div>
          <div>
            {ranked.map((m, idx) => {
              const isTop3 = idx < 3;
              const rc = isTop3 ? rankColors[idx] : null;
              const isSelected = selectedMember?.id === m.id;
              return (
                <div
                  key={m.id}
                  onClick={() => handleSelectMember(m)}
                  className="flex items-center gap-4 px-5 py-3.5 cursor-pointer transition-all duration-100"
                  style={{
                    borderBottom: "1px solid rgba(255,255,255,0.04)",
                    background: isSelected ? "rgba(255,255,255,0.06)" : "transparent",
                  }}
                  onMouseEnter={(e) => { if (!isSelected) e.currentTarget.style.background = "rgba(255,255,255,0.03)"; }}
                  onMouseLeave={(e) => { if (!isSelected) e.currentTarget.style.background = "transparent"; }}
                >
                  {/* Rank number */}
                  <div
                    className="w-8 h-8 rounded-lg flex items-center justify-center text-sm font-bold shrink-0"
                    style={
                      rc
                        ? { background: rc.bg, border: `1px solid ${rc.border}`, color: rc.text }
                        : { background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.08)", color: "rgba(255,255,255,0.4)" }
                    }
                  >
                    {idx === 0 ? <Crown size={16} /> : idx + 1}
                  </div>

                  {/* Name + communities */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium text-text1 truncate">{m.full_name}</span>
                      {idx === 0 && (
                        <span className="text-[10px] px-1.5 py-0.5 rounded font-medium" style={{ background: "rgba(250,204,21,0.15)", color: "rgb(250,204,21)", border: "1px solid rgba(250,204,21,0.3)" }}>
                          TOP
                        </span>
                      )}
                    </div>
                    <div className="text-xs text-text3 truncate">{(m.communities ?? []).join(", ") || "No communities assigned"}</div>
                  </div>

                  {/* Capture Rate — the main metric */}
                  <div className="text-right shrink-0" style={{ minWidth: "80px" }}>
                    <div
                      className="text-lg font-mono font-bold"
                      style={{
                        color: (m.stats?.capture_rate ?? 0) >= 70 ? "rgb(52,211,153)" : (m.stats?.capture_rate ?? 0) >= 40 ? "rgb(251,191,36)" : "rgb(248,113,113)",
                      }}
                    >
                      {m.stats?.capture_rate ?? 0}%
                    </div>
                    <div className="text-[10px] text-text3 uppercase tracking-wide">capture</div>
                  </div>

                  {/* EPOs count */}
                  <div className="text-right shrink-0" style={{ minWidth: "50px" }}>
                    <div className="text-sm font-mono text-text1">{m.stats?.total ?? 0}</div>
                    <div className="text-[10px] text-text3 uppercase tracking-wide">EPOs</div>
                  </div>

                  {/* Value */}
                  <div className="text-right shrink-0" style={{ minWidth: "70px" }}>
                    <div className="text-sm font-mono text-text1">
                      ${(m.stats?.total_value ?? 0) >= 1000 ? ((m.stats?.total_value ?? 0) / 1000).toFixed(1) + "K" : (m.stats?.total_value ?? 0)}
                    </div>
                    <div className="text-[10px] text-text3 uppercase tracking-wide">value</div>
                  </div>

                  {/* Health */}
                  <div className="shrink-0">
                    {m.health === "green" ? (
                      <CheckCircle size={16} style={{ color: "rgb(52,211,153)" }} />
                    ) : m.health === "amber" ? (
                      <AlertTriangle size={16} style={{ color: "rgb(251,191,36)" }} />
                    ) : (
                      <AlertTriangle size={16} style={{ color: "rgb(248,113,113)" }} />
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Members with 0 EPOs — not ranked */}
      {members.filter((m) => (m.stats?.total ?? 0) === 0).length > 0 && (
        <div className="card p-4">
          <div className="text-xs text-text3 uppercase tracking-wide mb-3">Not yet ranked (0 EPOs)</div>
          <div className="flex flex-wrap gap-2">
            {members
              .filter((m) => (m.stats?.total ?? 0) === 0)
              .map((m) => (
                <div
                  key={m.id}
                  className="flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs"
                  style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.06)" }}
                >
                  <div
                    className="w-5 h-5 rounded flex items-center justify-center text-[10px] font-semibold"
                    style={{ background: "rgba(255,255,255,0.08)", color: "rgba(255,255,255,0.4)" }}
                  >
                    {(m.full_name || "?").split(" ").map((n) => n[0] || "").join("")}
                  </div>
                  <span className="text-text2">{m.full_name}</span>
                </div>
              ))}
          </div>
        </div>
      )}

      {/* ═══ Selected Supervisor Detail ═══ */}
      {selectedMember && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-medium text-text1">
              {selectedMember.full_name}&apos;s EPOs
              <span className="text-text3 text-sm ml-2">
                {(selectedMember.communities ?? []).join(", ")}
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
                {memberEpos.length === 0 && (
                  <tr>
                    <td colSpan={7} className="px-4 py-8 text-center text-text3 text-sm">No EPOs found for this supervisor</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Empty state */}
      {!selectedMember && members.length === 0 && hasGmail !== null && (
        <div className="card p-12 text-center">
          <Users size={32} className="mx-auto mb-3 text-text3" />
          <p className="text-text2 text-sm">
            {hasGmail
              ? "No team members yet. Share the invite code above to get your team on board!"
              : "Join a team using an invite code, or set up Gmail integration to get started."
            }
          </p>
        </div>
      )}
    </div>
  );
}
