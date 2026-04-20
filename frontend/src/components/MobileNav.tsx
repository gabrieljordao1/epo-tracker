"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import {
  LayoutDashboard,
  FileText,
  TrendingUp,
  Settings,
  LogOut,
  DollarSign,
  Users,
} from "lucide-react";
import { OnyxLogo } from "@/components/OnyxLogo";
import { useUser } from "@/lib/user-context";
import { logout, getStats, getEPOs, getProfitSummary, getTodayStats, getActivityFeed, getDailyReportSummary, getTeamMembers } from "@/lib/api";
import { queryClient } from "@/lib/query-client";

export function MobileNav() {
  const pathname = usePathname();
  const router = useRouter();
  const { currentUser, activeUser, isDemoMode, supervisorId } = useUser();
  const displayUser = activeUser || currentUser;
  const displayName = displayUser?.full_name || "User";

  // Prefetch map: href -> prefetch functions
  const prefetchMap: Record<string, () => void> = {
    "/": () => {
      queryClient.prefetchQuery({ queryKey: ["stats", supervisorId], queryFn: () => getStats(supervisorId) });
      queryClient.prefetchQuery({ queryKey: ["epos", undefined, supervisorId], queryFn: () => getEPOs(undefined, supervisorId) });
      queryClient.prefetchQuery({ queryKey: ["todayStats"], queryFn: () => getTodayStats() });
    },
    "/epos": () => {
      queryClient.prefetchQuery({ queryKey: ["epos", undefined, supervisorId], queryFn: () => getEPOs(undefined, supervisorId) });
      queryClient.prefetchQuery({ queryKey: ["stats", supervisorId], queryFn: () => getStats(supervisorId) });
    },
    "/profit": () => {
      queryClient.prefetchQuery({ queryKey: ["profitSummary"], queryFn: () => getProfitSummary() });
    },
    "/analytics": () => {
      queryClient.prefetchQuery({ queryKey: ["epos", undefined, supervisorId], queryFn: () => getEPOs(undefined, supervisorId) });
      queryClient.prefetchQuery({ queryKey: ["stats", supervisorId], queryFn: () => getStats(supervisorId) });
    },
    "/team": () => {
      queryClient.prefetchQuery({ queryKey: ["teamMembers"], queryFn: () => getTeamMembers() });
    },
    "/settings": () => {
      // Settings page doesn't need prefetch
    },
  };

  const navItems = [
    { href: "/", label: "Home", icon: LayoutDashboard },
    { href: "/epos", label: "EPOs", icon: FileText },
    { href: "/profit", label: "Profit", icon: DollarSign },
    { href: "/team", label: "Team", icon: Users },
    { href: "/analytics", label: "Stats", icon: TrendingUp },
    { href: "/settings", label: "More", icon: Settings },
  ];

  const isActive = (href: string) => {
    if (href === "/") return pathname === "/";
    return pathname.startsWith(href);
  };

  return (
    <>
      {/* Mobile top header */}
      <div className="md:hidden fixed top-0 left-0 right-0 z-40 h-14 bg-bg border-b border-card-border px-4 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <OnyxLogo size={24} />
          <span className="font-semibold text-base tracking-tight text-text1">Onyx</span>
        </div>
        <div className="flex items-center gap-3">
          <div className="w-2 h-2 rounded-full bg-green"></div>
          <span className="text-xs text-text2">Synced</span>
          {!isDemoMode && (
            <button
              onClick={() => { logout(); router.push("/login"); }}
              className="text-text3 hover:text-red transition-colors ml-2"
            >
              <LogOut size={16} />
            </button>
          )}
        </div>
      </div>

      {/* Bottom tab bar */}
      <nav className="md:hidden fixed bottom-0 left-0 right-0 z-40 bg-bg border-t border-card-border px-2 pb-[env(safe-area-inset-bottom)]">
        <div className="flex items-center justify-around h-16">
          {navItems.map((item) => {
            const Icon = item.icon;
            const active = isActive(item.href);
            return (
              <Link
                key={item.href}
                href={item.href}
                onMouseEnter={() => {
                  const prefetch = prefetchMap[item.href];
                  if (prefetch) {
                    prefetch();
                  }
                }}
                className={`flex flex-col items-center gap-1 px-3 py-2 rounded-lg transition-colors min-w-[56px] ${
                  active
                    ? "text-green"
                    : "text-text3"
                }`}
                style={{ minWidth: 0 }}
              >
                <Icon size={18} />
                <span className="text-[10px] font-medium">{item.label}</span>
              </Link>
            );
          })}
        </div>
      </nav>
    </>
  );
}
