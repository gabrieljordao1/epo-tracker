"use client";

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
} from "lucide-react";
import { OnyxLogo } from "@/components/OnyxLogo";
import { useUser } from "@/lib/user-context";
import { logout, getAuthToken } from "@/lib/api";

export function Sidebar() {
  const pathname = usePathname();
  const router = useRouter();
  const { currentUser, activeUser, isBossView, isDemoMode } = useUser();

  const displayUser = activeUser || currentUser;
  const displayName = displayUser?.full_name || "Gabriel Jordao";
  const displayCompany = displayUser?.company_name || "Your Company";
  const initials = displayName.split(" ").map((n) => n[0]).join("");

  const navItems = [
    { href: "/", label: "Dashboard", icon: LayoutDashboard },
    { href: "/epos", label: "EPOs", icon: FileText },
    { href: "/analytics", label: "Analytics", icon: TrendingUp },
    { href: "/team", label: "Team", icon: Users },
    { href: "/integrations", label: "Integrations", icon: Zap },
    { href: "/settings", label: "Settings", icon: Settings },
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

      {/* User Profile */}
      <div className="px-4 py-6 border-t border-card-border">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-full bg-green flex items-center justify-center font-semibold text-black text-sm">
            {initials}
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium truncate">{displayName}</p>
            <p className="text-xs text-text3 truncate">{displayCompany}</p>
          </div>
        </div>
        {!isBossView && (
          <div className="mt-2 px-1">
            <span className="text-xs text-text3 bg-surface px-2 py-0.5 rounded">
              Viewing as supervisor
            </span>
          </div>
        )}
        <div className="mt-3">
          {isDemoMode ? (
            <button
              onClick={() => router.push("/login")}
              className="flex items-center gap-2 text-xs text-text3 hover:text-green transition-colors"
            >
              <LogIn size={14} />
              Sign in
            </button>
          ) : (
            <button
              onClick={() => { logout(); router.push("/login"); }}
              className="flex items-center gap-2 text-xs text-text3 hover:text-red transition-colors"
            >
              <LogOut size={14} />
              Sign out
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
