"use client";

import { ReactNode, useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";

interface ColdStartBoundaryProps {
  children: ReactNode;
  timeout?: number; // milliseconds before showing "waking up" message (default 3000)
  queryName?: string; // optional name for debugging
}

export function ColdStartBoundary({
  children,
  timeout = 3000,
  queryName = "query",
}: ColdStartBoundaryProps) {
  const [showTimeout, setShowTimeout] = useState(false);
  const [showNetworkError, setShowNetworkError] = useState(false);
  const [timeoutTimer, setTimeoutTimer] = useState<NodeJS.Timeout | null>(null);

  useEffect(() => {
    // Start the timeout timer on mount
    const timer = setTimeout(() => {
      setShowTimeout(true);
    }, timeout);

    setTimeoutTimer(timer);

    return () => {
      if (timer) clearTimeout(timer);
    };
  }, [timeout]);

  // Monitor for network errors in the console and show appropriate message
  useEffect(() => {
    const handleError = (event: ErrorEvent) => {
      if (
        event.message.includes("Failed to fetch") ||
        event.message.includes("Network error") ||
        event.message.includes("503") ||
        event.message.includes("502")
      ) {
        setShowNetworkError(true);
        setShowTimeout(false);
        if (timeoutTimer) clearTimeout(timeoutTimer);
      }
    };

    window.addEventListener("error", handleError);
    return () => window.removeEventListener("error", handleError);
  }, [timeoutTimer]);

  return (
    <>
      {children}

      {/* Timeout message - shows if query takes >3 seconds */}
      <AnimatePresence>
        {showTimeout && !showNetworkError && (
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 10 }}
            transition={{ duration: 0.3 }}
            className="fixed bottom-4 right-4 z-40 bg-[#111] border border-[#222] rounded-lg p-4 shadow-lg max-w-xs"
          >
            <div className="flex items-center gap-3">
              <Loader2 size={16} className="text-text2 animate-spin" />
              <span className="text-sm text-text2">
                Waking up the server, give us a moment...
              </span>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Network error message - shows if network error occurs */}
      <AnimatePresence>
        {showNetworkError && (
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 10 }}
            transition={{ duration: 0.3 }}
            className="fixed bottom-4 right-4 z-40 bg-[#111] border border-red-bdr rounded-lg p-4 shadow-lg max-w-xs"
          >
            <div className="flex items-center gap-3">
              <Loader2 size={16} className="text-red animate-spin" />
              <span className="text-sm text-red">
                Server is starting up... retrying
              </span>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}
