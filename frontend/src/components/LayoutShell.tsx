"use client";

import { usePathname } from "next/navigation";
import { Sidebar } from "@/components/Sidebar";
import { Topbar } from "@/components/Topbar";
import { MobileNav } from "@/components/MobileNav";

export function LayoutShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();

  // Standalone pages — no sidebar or topbar
  if (pathname.startsWith("/vendor") || pathname.startsWith("/login")) {
    return <>{children}</>;
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
