"use client";

import { useEffect, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { Sidebar } from "@/components/Sidebar";
import { Topbar } from "@/components/Topbar";
import { MobileNav } from "@/components/MobileNav";
import { getAuthToken } from "@/lib/api";

/** Routes that don't require authentication */
const PUBLIC_ROUTES = ["/login", "/vendor", "/early-access", "/reset-password"];

export function LayoutShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const [authChecked, setAuthChecked] = useState(false);

  const isPublicRoute = PUBLIC_ROUTES.some((r) => pathname.startsWith(r));

  // Client-side auth check (backup — middleware handles the primary redirect)
  useEffect(() => {
    if (isPublicRoute) {
      setAuthChecked(true);
      return;
    }
    const token = getAuthToken();
    if (!token) {
      // Clear any stale auth cookie and redirect
      document.cookie = "epo_auth=; path=/; max-age=0";
      router.replace("/login");
    } else {
      // Sync cookie for existing sessions (users who logged in before cookie was added)
      if (!document.cookie.includes("epo_auth")) {
        document.cookie = "epo_auth=1; path=/; max-age=2592000; SameSite=Lax";
      }
      setAuthChecked(true);
    }
  }, [pathname, isPublicRoute, router]);

  // Standalone pages — no sidebar or topbar
  if (isPublicRoute) {
    return <>{children}</>;
  }

  // Show nothing until auth check completes (prevents flash of dashboard)
  if (!authChecked) {
    return null;
  }

  return (
    <div className="flex h-screen overflow-hidden">
      {/* Desktop sidebar — hidden on mobile */}
      <div className="hidden md:block">
        <Sidebar />
      </div>

      <div className="flex-1 flex flex-col overflow-hidden">
        {/* Desktop topbar — hidden on mobile */}
        <div className="hidden md:block">
          <Topbar />
        </div>

        {/* Mobile nav (top header + bottom tabs) */}
        <MobileNav />

        {/* Main content — add padding for mobile header/footer */}
        <main className="flex-1 overflow-auto pt-14 pb-20 md:pt-0 md:pb-0">
          {children}
        </main>
      </div>
    </div>
  );
}
