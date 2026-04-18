"use client";

import { useState, useRef, useEffect } from "react";
import { Search, Bell, ChevronDown, Users, Eye, AlertTriangle, CheckCircle2, Mail, Clock, Flame, X } from "lucide-react";
import { useUser } from "@/lib/user-context";
import { getEPOs, getEmailStatus } from "@/lib/api";
import type { EPO } from "@/lib/api";
import { CommandPalette } from "@/components/CommandPalette";

export function Topbar() {
  const { activeUser, setActiveUser, teamMembers, isBossView, currentUser } = useUser();
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  const fieldMembers = teamMembers.filter((m) => m.role !== "admin");

  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setDropdownOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, []);

  const [notifOpen, setNotifOpen] = useState(false);
  const notifRef = useRef<HTMLDivElement>(null);
  const [alerts, setAlerts] = useState<{ id: string; type: string; title: string; description: string; icon: any; color: string; time: string }[]>([]);
  const [dismissedIds, setDismissedIds] = useState<Set<string>>(new Set());
  const [emailSyncStatus, setEmailSyncStatus] = useState<"active" | "expired" | "none" | "loading">("loading");

  // Check actual email sync status
  useEffect(() => {
    const checkSync = async () => {
      try {
        const status = await getEmailStatus();
        if (status.active_connections > 0) {
          setEmailSyncStatus("active");
        } else if (status.total_connections > 0) {
          setEmailSyncStatus("expired");
        } else {
          setEmailSyncStatus("none");
        }
      } catch {
        setEmailSyncStatus("none");
      }
    };
    checkSync();
  }, []);

  // Build alerts from live EPO data
  useEffect(() => {
    const buildAlerts = async () => {
      try {
        const epos: EPO[] = await getEPOs();
        const newAlerts: typeof alerts = [];

        // Overdue EPOs (7+ days pending)
        const overdue = epos.filter((e) => e.status === "pending" && (e.days_open || 0) >= 7);
        if (overdue.length > 0) {
          newAlerts.push({
            id: "overdue",
            type: "urgent",
            title: `${overdue.length} Overdue EPO${overdue.length > 1 ? "s" : ""}`,
            description: `${overdue.map((e) => `${e.vendor_name} Lot ${e.lot_number}`).slice(0, 2).join(", ")}${overdue.length > 2 ? ` +${overdue.length - 2} more` : ""}`,
            icon: Flame,
            color: "text-red-400",
            time: "Now",
          });
        }

        // Needs follow-up (4-6 days)
        const needsFollowup = epos.filter((e) => e.status === "pending" && (e.days_open || 0) >= 4 && (e.days_open || 0) < 7);
        if (needsFollowup.length > 0) {
          newAlerts.push({
            id: "followup",
            type: "warning",
            title: `${needsFollowup.length} Need${needsFollowup.length > 1 ? "" : "s"} Follow-up`,
            description: `Pending 4+ days without response`,
            icon: Clock,
            color: "text-amber-400",
            time: "Today",
          });
        }

        // Recent confirmations (last 24h)
        const recentConfirmed = epos.filter((e) => {
          if (e.status !== "confirmed") return false;
          const updated = new Date(e.created_at);
          const hoursAgo = (Date.now() - updated.getTime()) / (1000 * 60 * 60);
          return hoursAgo < 24;
        });
        if (recentConfirmed.length > 0) {
          newAlerts.push({
            id: "confirmed",
            type: "success",
            title: `${recentConfirmed.length} EPO${recentConfirmed.length > 1 ? "s" : ""} Confirmed`,
            description: `${recentConfirmed.map((e) => e.vendor_name).slice(0, 2).join(", ")} confirmed recently`,
            icon: CheckCircle2,
            color: "text-emerald-400",
            time: "Recently",
          });
        }

        // Needs review (AI flagged)
        const needsReview = epos.filter((e) => e.needs_review);
        if (needsReview.length > 0) {
          newAlerts.push({
            id: "review",
            type: "info",
            title: `${needsReview.length} Need${needsReview.length > 1 ? "" : "s"} Review`,
            description: "AI flagged for manual review",
            icon: AlertTriangle,
            color: "text-blue-400",
            time: "Today",
          });
        }

        setAlerts(newAlerts);
      } catch {
        // Silently fail
      }
    };
    buildAlerts();
    const interval = setInterval(buildAlerts, 60000); // Refresh every minute
    return () => clearInterval(interval);
  }, []);

  const visibleAlerts = alerts.filter((a) => !dismissedIds.has(a.id));
  const alertCount = visibleAlerts.filter((a) => a.type === "urgent" || a.type === "warning").length;

  useEffect(() => {
    const handleNotifClick = (e: MouseEvent) => {
      if (notifRef.current && !notifRef.current.contains(e.target as Node)) {
        setNotifOpen(false);
      }
    };
    document.addEventListener("mousedown", handleNotifClick);
    return () => document.removeEventListener("mousedown", handleNotifClick);
  }, []);

  const viewLabel = isBossView
    ? "All Communities"
    : `${activeUser?.full_name ?? "User"} — ${(activeUser?.communities ?? []).join(", ") || "No communities"}`;

  return (
    <div className="h-16 bg-bg border-b border-card-border px-8 flex items-center justify-between">
      {/* Search */}
      <div className="flex-1 max-w-sm">
        <div className="relative">
          <Search size={18} className="absolute left-3 top-1/2 -translate-y-1/2 text-text3" />
          <input
            type="text"
            placeholder="Search EPOs..."
            className="w-full pl-10 pr-4 py-2 bg-surface border border-card-border rounded-lg text-text1 placeholder-text3 focus:outline-none focus:border-border-lt focus:ring-1 focus:ring-green/20"
          />
        </div>
      </div>

      {/* Right side */}
      <div className="flex items-center gap-5 ml-8">
        {/* Command Palette Trigger */}
        <CommandPalette />

        {/* View Switcher */}
        <div className="relative" ref={dropdownRef}>
          <button
            onClick={() => setDropdownOpen(!dropdownOpen)}
            className="flex items-center gap-2 px-3 py-1.5 rounded-lg border border-card-border hover:border-border-lt transition-colors text-sm"
          >
            <Eye size={14} className="text-text3" />
            <span className="text-text2 max-w-[220px] truncate">{viewLabel}</span>
            <ChevronDown size={14} className="text-text3" />
          </button>

          {dropdownOpen && (
            <div className="absolute right-0 top-full mt-2 w-72 bg-[#141414] border border-card-border rounded-xl shadow-2xl z-50 overflow-hidden">
              <div className="px-4 py-3 border-b border-card-border">
                <p className="text-xs text-text3 uppercase tracking-wider font-medium">Viewing as</p>
              </div>

              {/* Boss / All view */}
              <button
                onClick={() => { setActiveUser(null); setDropdownOpen(false); }}
                className={`w-full flex items-center gap-3 px-4 py-3 text-left transition-colors ${
                  isBossView ? "bg-surface" : "hover:bg-surface/50"
                }`}
              >
                <div className="w-8 h-8 rounded-lg bg-[rgba(52,211,153,0.12)] border border-[rgba(52,211,153,0.25)] flex items-center justify-center">
                  <Users size={14} className="text-green" />
                </div>
                <div>
                  <div className="text-sm font-medium text-text1">All Communities</div>
                  <div className="text-xs text-text3">Boss view — see everything</div>
                </div>
                {isBossView && <div className="ml-auto w-2 h-2 rounded-full bg-green" />}
              </button>

              {/* Divider */}
              <div className="px-4 py-2 border-t border-card-border">
                <p className="text-xs text-text3 uppercase tracking-wider font-medium">Supervisors</p>
              </div>

              {/* Individual supervisors */}
              {fieldMembers.map((member) => {
                const isActive = activeUser?.id === member.id;
                const initials = (member.full_name || "?").split(" ").map((n) => n[0] || "").join("");
                return (
                  <button
                    key={member.id}
                    onClick={() => { setActiveUser(member); setDropdownOpen(false); }}
                    className={`w-full flex items-center gap-3 px-4 py-3 text-left transition-colors ${
                      isActive ? "bg-surface" : "hover:bg-surface/50"
                    }`}
                  >
                    <div className="w-8 h-8 rounded-lg bg-[rgba(144,191,249,0.12)] border border-[rgba(144,191,249,0.25)] flex items-center justify-center text-xs font-semibold text-[rgb(144,191,249)]">
                      {initials}
                    </div>
                    <div>
                      <div className="text-sm font-medium text-text1">{member.full_name}</div>
                      <div className="text-xs text-text3">{(member.communities ?? []).join(", ") || "No communities"}</div>
                    </div>
                    {isActive && <div className="ml-auto w-2 h-2 rounded-full bg-[rgb(144,191,249)]" />}
                  </button>
                );
              })}
            </div>
          )}
        </div>

        {/* Email sync status — reflects actual connection state */}
        {emailSyncStatus === "active" ? (
          <div className="flex items-center gap-2">
            <div className="w-2 h-2 rounded-full bg-green"></div>
            <span className="text-sm text-text2">Email sync active</span>
          </div>
        ) : emailSyncStatus === "expired" ? (
          <button
            onClick={() => window.location.href = "/integrations"}
            className="flex items-center gap-2 hover:opacity-80 transition-opacity"
          >
            <div className="w-2 h-2 rounded-full bg-amber animate-pulse"></div>
            <span className="text-sm text-amber">Gmail disconnected</span>
          </button>
        ) : emailSyncStatus === "none" ? (
          <button
            onClick={() => window.location.href = "/integrations"}
            className="flex items-center gap-2 hover:opacity-80 transition-opacity"
          >
            <div className="w-2 h-2 rounded-full bg-text3"></div>
            <span className="text-sm text-text3">No email connected</span>
          </button>
        ) : null}

        {/* Notifications */}
        <div className="relative" ref={notifRef}>
          <button
            onClick={() => setNotifOpen(!notifOpen)}
            className="relative text-text2 hover:text-text1 transition-colors"
          >
            <Bell size={20} />
            {alertCount > 0 && (
              <span className="absolute -top-1 -right-1 w-4 h-4 bg-red-500 rounded-full text-[10px] font-bold text-white flex items-center justify-center">
                {alertCount}
              </span>
            )}
          </button>

          {notifOpen && (
            <div className="absolute right-0 top-full mt-2 w-80 bg-[#141414] border border-card-border rounded-xl shadow-2xl z-50 overflow-hidden">
              <div className="px-4 py-3 border-b border-card-border flex items-center justify-between">
                <p className="text-sm font-medium text-text1">Notifications</p>
                {visibleAlerts.length > 0 && (
                  <button
                    onClick={() => setDismissedIds(new Set(alerts.map((a) => a.id)))}
                    className="text-xs text-text3 hover:text-text1 transition-colors"
                  >
                    Clear all
                  </button>
                )}
              </div>
              {visibleAlerts.length === 0 ? (
                <div className="px-4 py-8 text-center">
                  <Bell size={24} className="mx-auto mb-2 text-text3" />
                  <p className="text-sm text-text3">All caught up!</p>
                  <p className="text-xs text-text3 mt-1">No alerts right now</p>
                </div>
              ) : (
                <div className="max-h-[320px] overflow-y-auto">
                  {visibleAlerts.map((alert) => {
                    const Icon = alert.icon;
                    return (
                      <div
                        key={alert.id}
                        className="px-4 py-3 border-b border-card-border/50 hover:bg-surface/50 transition-colors group"
                      >
                        <div className="flex items-start gap-3">
                          <Icon size={16} className={`mt-0.5 shrink-0 ${alert.color}`} />
                          <div className="flex-1 min-w-0">
                            <p className="text-sm font-medium text-text1">{alert.title}</p>
                            <p className="text-xs text-text3 mt-0.5 truncate">{alert.description}</p>
                          </div>
                          <div className="flex items-center gap-2 shrink-0">
                            <span className="text-[10px] text-text3">{alert.time}</span>
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                setDismissedIds((prev) => new Set([...prev, alert.id]));
                              }}
                              className="opacity-0 group-hover:opacity-100 text-text3 hover:text-text1 transition-all"
                            >
                              <X size={12} />
                            </button>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
