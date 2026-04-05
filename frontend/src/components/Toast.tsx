"use client";

import React, { createContext, useContext, useState, useCallback, useEffect } from "react";
import { AlertCircle, CheckCircle, Info, X, AlertTriangle } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { registerToastInstance } from "@/lib/toastInstance";

export type ToastType = "success" | "error" | "warning" | "info";

export interface Toast {
  id: string;
  message: string;
  type: ToastType;
  duration?: number;
}

interface ToastContextType {
  toasts: Toast[];
  addToast: (message: string, type: ToastType, duration?: number) => string;
  removeToast: (id: string) => void;
  success: (message: string, duration?: number) => string;
  error: (message: string, duration?: number) => string;
  warning: (message: string, duration?: number) => string;
  info: (message: string, duration?: number) => string;
}

const ToastContext = createContext<ToastContextType | undefined>(undefined);

const getToastStyles = (type: ToastType) => {
  switch (type) {
    case "success":
      return {
        bg: "bg-green-900",
        border: "border-green-700",
        icon: <CheckCircle className="w-5 h-5 text-green-400" />,
      };
    case "error":
      return {
        bg: "bg-red-900",
        border: "border-red-700",
        icon: <AlertCircle className="w-5 h-5 text-red-400" />,
      };
    case "warning":
      return {
        bg: "bg-amber-900",
        border: "border-amber-700",
        icon: <AlertTriangle className="w-5 h-5 text-amber-400" />,
      };
    case "info":
      return {
        bg: "bg-blue-900",
        border: "border-blue-700",
        icon: <Info className="w-5 h-5 text-blue-400" />,
      };
  }
};

const ToastItem: React.FC<{
  toast: Toast;
  onClose: (id: string) => void;
}> = ({ toast, onClose }) => {
  const styles = getToastStyles(toast.type);

  React.useEffect(() => {
    const duration = toast.duration ?? 5000;
    const timer = setTimeout(() => onClose(toast.id), duration);
    return () => clearTimeout(timer);
  }, [toast.id, toast.duration, onClose]);

  return (
    <motion.div
      initial={{ opacity: 0, y: -20, x: 20 }}
      animate={{ opacity: 1, y: 0, x: 0 }}
      exit={{ opacity: 0, y: -20, x: 20 }}
      transition={{ duration: 0.3 }}
      className={`${styles.bg} ${styles.border} border rounded-lg shadow-lg p-4 flex items-start gap-3 max-w-sm w-full`}
    >
      {styles.icon}
      <div className="flex-1">
        <p className="text-white text-sm font-medium">{toast.message}</p>
      </div>
      <button
        onClick={() => onClose(toast.id)}
        className="flex-shrink-0 text-gray-400 hover:text-gray-200 transition-colors"
      >
        <X className="w-4 h-4" />
      </button>
    </motion.div>
  );
};

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);

  const removeToast = useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const addToast = useCallback(
    (message: string, type: ToastType, duration?: number) => {
      const id = Math.random().toString(36).substr(2, 9);
      const newToast: Toast = { id, message, type, duration };

      setToasts((prev) => {
        const updated = [...prev, newToast];
        // Keep only the last 5 toasts
        if (updated.length > 5) {
          return updated.slice(-5);
        }
        return updated;
      });

      return id;
    },
    []
  );

  const success = useCallback(
    (message: string, duration?: number) =>
      addToast(message, "success", duration),
    [addToast]
  );

  const error = useCallback(
    (message: string, duration?: number) =>
      addToast(message, "error", duration),
    [addToast]
  );

  const warning = useCallback(
    (message: string, duration?: number) =>
      addToast(message, "warning", duration),
    [addToast]
  );

  const info = useCallback(
    (message: string, duration?: number) =>
      addToast(message, "info", duration),
    [addToast]
  );

  // Register the toast instance for use in non-React code
  useEffect(() => {
    registerToastInstance({ success, error, warning, info });
  }, [success, error, warning, info]);

  return (
    <ToastContext.Provider
      value={{ toasts, addToast, removeToast, success, error, warning, info }}
    >
      {children}
      <div className="fixed top-6 right-6 z-50 space-y-3 pointer-events-none">
        <AnimatePresence>
          {toasts.map((toast) => (
            <div key={toast.id} className="pointer-events-auto">
              <ToastItem toast={toast} onClose={removeToast} />
            </div>
          ))}
        </AnimatePresence>
      </div>
    </ToastContext.Provider>
  );
}

export function useToast(): Omit<ToastContextType, "toasts" | "addToast" | "removeToast"> {
  const context = useContext(ToastContext);
  if (!context) {
    throw new Error("useToast must be used within ToastProvider");
  }
  return {
    success: context.success,
    error: context.error,
    warning: context.warning,
    info: context.info,
  };
}
