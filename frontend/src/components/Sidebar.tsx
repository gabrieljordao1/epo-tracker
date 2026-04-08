"use client";

import { useState, useRef, useEffect } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import {
  LayoutDashboard,
  FileText,
  TrendingUp,
  Users,
  Zap,
  Settings,
  LogOut,
  LogIn,
  ChevronUp,
  Activity,
  ClipboardList,
  Hammer,
  Target,
} from "lucide-react";
import { OnyxLogo } from "@/components/OnyxLogo";
import { useUser } from "@/lib/user-context";
import { logout, getAuthToken } from "@/lib/api";

export function Sidebar() {
  const pathname = usePathname();
  const router = useRouter();
  const { currentUser, activeUser, isBossView, isDemoMode } = useUser();
  const [profileOpen, setProfileOpen] = useState(false);
  const profileRef = useRef<HTMLDivElement>(null);

  const displayUser = activeUser || currentUser;
  const displayName = displayUser?.full_name || "Gabriel Jordao";
  const displayCompany = (displayUser as any)?.company_name || "Onyx";
  const initials = displayName.split(" ").map((n) => n[0]).join("");

  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      if (profileRef.current && !profileRef.current.contains(e.target as Node)) {
        setProfileOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, []);

  const navItems = [
    { href: "/", label: "Dashboard", icon: LayoutDashboard },
    { href: "/epos", label: "EPOs", icon: FileText },
    { href: "/analytics", label: "Analytics", icon: TrendingUp },
    { href: "/activity", label: "Activity", icon: Activity },
    { href: "/daily-reports", label: "Daily Reports", icon: ClipboardList },
    { href: "/punch-list", label: "Punch List", icon: Hammer },
    { href: "/budgets", label: "Budgets", icon: Target },
    { href: "/team", label: "Team", icon: Users },
  ];

  const isActive = (href: string) => {
    if (href === "/") return pathname === "/";
    return pathname.startsWith(href);
  };

  return (
    <div className="w-[220px] bg-bg border-r border-card-border flex flex-col">
      {/* Logo */}
      <div className="px-6 py-8 border-b border-card-border flex items-center gap-3">
        <OnyxLogo size={28} />
        <span className="font-semibold text-lg tracking-tight">Onyx</span>
      </div>

      {/* Nav Items */}
      <nav className="flex-1 px-4 py-6 space-y-2">
        {navItems.map((item) => {
          const Icon = item.icon;
          const active = isActive(item.href);
          return (
            <Link
              key={item.href}
              href={item.href}
              className={`flex items-center gap-3 px-4 py-3 rounded-lg transition-all ${
                active
                  ? "bg-surface text-text1"
                  : "text-text2 hover:bg-surface hover:text-text1"
              }`}
            >
              <Icon size={20} />
              <span className="text-sm font-medium">{item.label}</span>
            </Link>
          );
        })}
      </nav>

      {/* User Profile with Dropdown */}
      <div className="px-4 py-6 border-t border-card-border relative" ref={profileRef}>
        {/* Profile dropdown (opens upward) */}
        {profileOpen && (
          <div className="absolute bottom-full left-3 right-3 mb-2 bg-[#141414] border border-card-border rounded-xl shadow-2xl z-50 overflow-hidden">
            <Link
              href="/integrations"
              onClick={() => setProfileOpen(false)}
              className={`flex items-center gap-3 px-4 py-3 text-left transition-colors w-full ${
                pathname.startsWith("/integrations") ? "bg-surface" : "hover:bg-surface/50"
              }`}
            >
              <Zap size={16} className="text-text3" />
              <span className="text-sm text-text1">Integrations</span>
            </Link>
            <Link
              href="/settings"
              onClick={() => setProfileOpen(false)}
              className={`flex items-center gap-3 px-4 py-3 text-left transition-colors w-full ${
                pathname.startsWith("/settings") ? "bg-surface" : "hover:bg-surface/50"
              }`}
            >
              <Settings size={16} className="text-text3" />
              <span className="text-sm text-text1">Settings</span>
            </Link>
            <div className="border-t border-card-border">
              {isDemoMode ? (
                <button
                  onClick={() => { setProfileOpen(false); router.push("/login"); }}
                  className="flex items-center gap-3 px-4 py-3 text-left transition-colors w-full hover:bg-surface/50"
                >
                  <LogIn size={16} className="text-text3" />
                  <span className="text-sm text-green">Sign in</span>
                </button>
              ) : (
                <button
                  onClick={() => { setProfileOpen(false); logout(); router.push("/login"); }}
                  className="flex items-center gap-3 px-4 py-3 text-left transition-colors w-full hover:bg-surface/50"
                >
                  <LogOut size={16} className="text-text3" />
                  <span className="text-sm text-red-400">Sign out</span>
                </button>
              )}
            </div>
          </div>
        )}

        {/* Clickable profile area */}
        <button
          onClick={() => setProfileOpen(!profileOpen)}
          className="flex items-center gap-3 rounded-lg px-1 py-1 -mx-1 hover:bg-surface transition-colors cursor-pointer w-full text-left"
        >
          <div className="w-10 h-10 rounded-full bg-green flex items-center justify-center font-semibold text-black text-sm shrink-0">
            {initials}
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium truncate">{displayName}</p>
            <p className="text-xs text-text3 truncate">{displayCompany}</p>
          </div>
          <ChevronUp
            size={14}
            className={`text-text3 transition-transform shrink-0 ${profileOpen ? "" : "rotate-180"}`}
          />
        </button>
        {!isBossView && (
          <div className="mt-2 px-1">
            <span className="text-xs text-text3 bg-surface px-2 py-0.5 rounded">
              Viewing as supervisor
            </span>
          </div>
        )}
      </div>
    </div>
  );
}
