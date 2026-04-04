import type { Metadata } from "next";
import { Sidebar } from "@/components/Sidebar";
import { Topbar } from "@/components/Topbar";
import { Providers } from "@/components/Providers";
import { LayoutShell } from "@/components/LayoutShell";
import "@/globals.css";

export const metadata: Metadata = {
  title: "Onyx",
  description: "EPO tracking for construction trades",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body className="bg-bg text-text1">
        <Providers>
          <LayoutShell>{children}</LayoutShell>
        </Providers>
      </body>
    </html>
  );
}
