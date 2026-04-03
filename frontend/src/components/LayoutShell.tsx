"use client";

import { usePathname } from "next/navigation";
import { Sidebar } from "@/components/Sidebar";
import { Topbar } from "@/components/Topbar";

export function LayoutShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();

  // Standalone pages — no sidebar or topbar
  if (pathname.startsWith("/vendor") || pathname.startsWith("/login")) {
    return <>{children}</>;
  }

  return (
    <div className="flex h-screen overflow-hidden">
      <Sidebar />
      <div className="flex-1 flex flex-col overflow-hidden">
        <Topbar />
        <main className="flex-1 overflow-auto">{children}</main>
      </div>
    </div>
  );
}
