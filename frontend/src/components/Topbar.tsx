"use client";

import { useState, useRef, useEffect } from "react";
import { Search, Bell, ChevronDown, Users, Eye } from "lucide-react";
import { useUser } from "@/lib/user-context";

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

        {/* Email sync status */}
        <div className="flex items-center gap-2">
          <div className="w-2 h-2 rounded-full bg-green"></div>
          <span className="text-sm text-text2">Email sync active</span>
        </div>

        {/* Notifications */}
        <div className="relative" ref={notifRef}>
          <button
            onClick={() => setNotifOpen(!notifOpen)}
            className="relative text-text2 hover:text-text1 transition-colors"
          >
            <Bell size={20} />
          </button>

          {notifOpen && (
            <div className="absolute right-0 top-full mt-2 w-72 bg-[#141414] border border-card-border rounded-xl shadow-2xl z-50 overflow-hidden">
              <div className="px-4 py-3 border-b border-card-border">
                <p className="text-sm font-medium text-text1">Notifications</p>
              </div>
              <div className="px-4 py-8 text-center">
                <Bell size={24} className="mx-auto mb-2 text-text3" />
                <p className="text-sm text-text3">No new notifications</p>
                <p className="text-xs text-text3 mt-1">You&apos;re all caught up!</p>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
