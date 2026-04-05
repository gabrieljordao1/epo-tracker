"use client";

import { UserProvider } from "@/lib/user-context";
import { ToastProvider } from "@/components/Toast";
import { ErrorBoundary } from "@/components/ErrorBoundary";

export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <ErrorBoundary>
      <ToastProvider>
        <UserProvider>{children}</UserProvider>
      </ToastProvider>
    </ErrorBoundary>
  );
}
