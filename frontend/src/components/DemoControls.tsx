"use client";

import { useState, useEffect } from "react";
import { simulateEmail, seedData, resetData, getEPOs, getStats } from "@/lib/api";
import { X, Mail, RotateCcw } from "lucide-react";

interface Toast {
  id: string;
  message: string;
  type: "success" | "error";
}

export function DemoControls({ onDataUpdated }: { onDataUpdated: () => void }) {
  const [isOpen, setIsOpen] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [toasts, setToasts] = useState<Toast[]>([]);

  // Keyboard shortcut to toggle
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.ctrlKey && e.key === "d") {
        setIsOpen((prev) => !prev);
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

  const showToast = (message: string, type: "success" | "error" = "success") => {
    const id = Math.random().toString();
    setToasts((prev) => [...prev, { id, message, type }]);
    setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
    }, 4000);
  };

  const handleSimulateEmail = async () => {
    setIsLoading(true);
    const emailData = {
      email_subject: "EPO - Touch up paint needed Lot 142 Mallard Park",
      email_body: "Hi,\n\nWe need touch-up paint on the master bedroom ceiling at Lot 142, Mallard Park. Damage from drywall repair.\n\nAmount: $285.00\n\nThanks,\nMike Johnson\nSummit Builders",
      vendor_email: "mike@summitbuilders.com"
    };

    try {
      const result = await simulateEmail(emailData.email_subject, emailData.email_body);
      if (result) {
        showToast("New EPO detected: $285 from Summit Builders - Lot 142", "success");
        // Refresh data
        setTimeout(() => {
          onDataUpdated();
        }, 500);
      } else {
        showToast("Failed to simulate email", "error");
      }
    } catch (error) {
      showToast("Error simulating email", "error");
    } finally {
      setIsLoading(false);
    }
  };

  const handleSeedData = async () => {
    setIsLoading(true);
    try {
      await seedData();
      showToast("Demo data seeded successfully", "success");
      setTimeout(() => {
        onDataUpdated();
      }, 500);
    } catch (error) {
      showToast("Error seeding data", "error");
    } finally {
      setIsLoading(false);
    }
  };

  const handleResetData = async () => {
    if (confirm("Are you sure you want to reset all data?")) {
      setIsLoading(true);
      try {
        await resetData();
        showToast("Data reset successfully", "success");
        setTimeout(() => {
          onDataUpdated();
        }, 500);
      } catch (error) {
        showToast("Error resetting data", "error");
      } finally {
        setIsLoading(false);
      }
    }
  };

  return (
    <>
      {/* Floating Panel */}
      <div
        className={`fixed bottom-6 right-6 transition-all duration-300 ${
          isOpen ? "scale-100 opacity-100" : "scale-0 opacity-0 pointer-events-none"
        }`}
      >
        <div className="card p-6 w-80 space-y-4">
          <div className="flex items-center justify-between mb-4">
            <h3 className="font-semibold text-text1">Demo Controls</h3>
            <button
              onClick={() => setIsOpen(false)}
              className="text-text3 hover:text-text2"
            >
              <X size={20} />
            </button>
          </div>

          <button
            onClick={handleSimulateEmail}
            disabled={isLoading}
            className="btn-primary w-full flex items-center gap-2 justify-center disabled:opacity-50"
          >
            <Mail size={16} />
            Simulate Email
          </button>

          <button
            onClick={handleSeedData}
            disabled={isLoading}
            className="btn-secondary w-full disabled:opacity-50"
          >
            Seed Data
          </button>

          <button
            onClick={handleResetData}
            disabled={isLoading}
            className="btn-secondary w-full flex items-center gap-2 justify-center disabled:opacity-50"
          >
            <RotateCcw size={16} />
            Reset
          </button>

          <p className="text-xs text-text3 text-center pt-2">
            Tip: Press <span className="font-mono">Ctrl+D</span> to toggle
          </p>
        </div>
      </div>

      {/* Toggle Button */}
      <button
        onClick={() => setIsOpen(!isOpen)}
        className={`fixed bottom-6 right-6 w-14 h-14 rounded-full transition-all duration-300 flex items-center justify-center ${
          isOpen ? "scale-0 opacity-0 pointer-events-none" : "scale-100 opacity-100"
        } ${
          isLoading
            ? "bg-surface text-text2"
            : "bg-green text-black hover:bg-green/90"
        }`}
      >
        {isLoading ? (
          <div className="animate-spin">
            <Mail size={20} />
          </div>
        ) : (
          <Mail size={20} />
        )}
      </button>

      {/* Toast Notifications */}
      <div className="fixed bottom-24 right-6 space-y-2 z-50">
        {toasts.map((toast) => (
          <div
            key={toast.id}
            className={`card px-4 py-3 text-sm font-medium max-w-sm animate-in fade-in slide-in-from-bottom-4 ${
              toast.type === "success"
                ? "bg-green-dim border-green-bdr text-green"
                : "bg-red-dim border-red-bdr text-red"
            }`}
          >
            {toast.message}
          </div>
        ))}
      </div>
    </>
  );
}
