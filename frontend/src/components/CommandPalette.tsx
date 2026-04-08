"use client";

import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { useRouter } from "next/navigation";
import { motion, AnimatePresence } from "framer-motion";
import {
  Search,
  LayoutDashboard,
  FileText,
  TrendingUp,
  Users,
  Activity,
  Settings,
  Plus,
  Download,
  BarChart3,
  Command,
  ArrowRight,
  Keyboard,
  X,
} from "lucide-react";

interface CommandItem {
  id: string;
  label: string;
  description?: string;
  icon: React.ReactNode;
  action: () => void;
  keywords: string[];
  shortcut?: string;
  category: "navigation" | "action" | "quick";
}

export function CommandPalette() {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [selectedIndex, setSelectedIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const router = useRouter();

  const commands: CommandItem[] = useMemo(
    () => [
      // Navigation
      {
        id: "nav-dashboard",
        label: "Go to Dashboard",
        description: "Overview of all EPOs",
        icon: <LayoutDashboard size={18} />,
        action: () => router.push("/"),
        keywords: ["dashboard", "home", "overview"],
        shortcut: "G D",
        category: "navigation",
      },
      {
        id: "nav-epos",
        label: "Go to EPOs",
        description: "View and manage EPOs",
        icon: <FileText size={18} />,
        action: () => router.push("/epos"),
        keywords: ["epos", "orders", "list"],
        shortcut: "G E",
        category: "navigation",
      },
      {
        id: "nav-analytics",
        label: "Go to Analytics",
        description: "Charts and insights",
        icon: <TrendingUp size={18} />,
        action: () => router.push("/analytics"),
        keywords: ["analytics", "charts", "stats", "reports"],
        shortcut: "G A",
        category: "navigation",
      },
      {
        id: "nav-builders",
        label: "Go to Builder Scorecards",
        description: "Builder performance metrics",
        icon: <BarChart3 size={18} />,
        action: () => router.push("/analytics/builders"),
        keywords: ["builders", "scorecards", "vendors", "performance"],
        shortcut: "G B",
        category: "navigation",
      },
      {
        id: "nav-activity",
        label: "Go to Activity Feed",
        description: "Real-time event log",
        icon: <Activity size={18} />,
        action: () => router.push("/activity"),
        keywords: ["activity", "feed", "log", "events", "timeline"],
        shortcut: "G F",
        category: "navigation",
      },
      {
        id: "nav-team",
        label: "Go to Team",
        description: "Manage team members",
        icon: <Users size={18} />,
        action: () => router.push("/team"),
        keywords: ["team", "members", "people"],
        shortcut: "G T",
        category: "navigation",
      },
      {
        id: "nav-settings",
        label: "Go to Settings",
        description: "App configuration",
        icon: <Settings size={18} />,
        action: () => router.push("/settings"),
        keywords: ["settings", "config", "preferences"],
        shortcut: "G S",
        category: "navigation",
      },
      // Actions
      {
        id: "action-new-epo",
        label: "Create New EPO",
        description: "Add a new extra purchase order",
        icon: <Plus size={18} />,
        action: () => {
          router.push("/epos");
          // Dispatch custom event to open the modal
          setTimeout(() => window.dispatchEvent(new CustomEvent("open-add-epo")), 300);
        },
        keywords: ["new", "create", "add", "epo"],
        shortcut: "N",
        category: "action",
      },
      {
        id: "action-export",
        label: "Export CSV",
        description: "Download EPO data as CSV",
        icon: <Download size={18} />,
        action: () => {
          router.push("/analytics");
        },
        keywords: ["export", "download", "csv", "report"],
        category: "action",
      },
    ],
    [router]
  );

  const filtered = useMemo(() => {
    if (!query.trim()) return commands;
    const q = query.toLowerCase();
    return commands.filter(
      (cmd) =>
        cmd.label.toLowerCase().includes(q) ||
        cmd.description?.toLowerCase().includes(q) ||
        cmd.keywords.some((k) => k.includes(q))
    );
  }, [query, commands]);

  // Reset selection when filter changes
  useEffect(() => {
    setSelectedIndex(0);
  }, [query]);

  // Open with Cmd+K / Ctrl+K
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Cmd+K or Ctrl+K
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        setOpen((prev) => !prev);
        return;
      }

      // Escape to close
      if (e.key === "Escape" && open) {
        e.preventDefault();
        setOpen(false);
        return;
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [open]);

  // Focus input when opened
  useEffect(() => {
    if (open) {
      setQuery("");
      setSelectedIndex(0);
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }, [open]);

  const runCommand = useCallback(
    (cmd: CommandItem) => {
      setOpen(false);
      cmd.action();
    },
    []
  );

  // Keyboard navigation within palette
  const handleInputKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setSelectedIndex((i) => Math.min(i + 1, filtered.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setSelectedIndex((i) => Math.max(i - 1, 0));
    } else if (e.key === "Enter" && filtered[selectedIndex]) {
      e.preventDefault();
      runCommand(filtered[selectedIndex]);
    }
  };

  // Scroll selected item into view
  useEffect(() => {
    if (listRef.current) {
      const selected = listRef.current.querySelector(`[data-index="${selectedIndex}"]`);
      selected?.scrollIntoView({ block: "nearest" });
    }
  }, [selectedIndex]);

  // Group by category
  const grouped = useMemo(() => {
    const groups: Record<string, CommandItem[]> = {};
    for (const cmd of filtered) {
      if (!groups[cmd.category]) groups[cmd.category] = [];
      groups[cmd.category].push(cmd);
    }
    return groups;
  }, [filtered]);

  const categoryLabels: Record<string, string> = {
    navigation: "Navigation",
    action: "Actions",
    quick: "Quick Actions",
  };

  // Track flat index across groups
  let flatIndex = -1;

  return (
    <>
      {/* Keyboard shortcut hint in topbar */}
      <button
        onClick={() => setOpen(true)}
        className="hidden md:flex items-center gap-2 px-3 py-1.5 rounded-lg bg-white/5 border border-white/10 text-xs text-gray-400 hover:bg-white/10 hover:text-gray-300 transition-colors"
      >
        <Search size={14} />
        <span>Search...</span>
        <kbd className="ml-2 px-1.5 py-0.5 rounded bg-white/10 text-[10px] font-mono">
          {typeof navigator !== "undefined" && navigator.platform?.includes("Mac") ? "⌘" : "Ctrl+"}K
        </kbd>
      </button>

      <AnimatePresence>
        {open && (
          <>
            {/* Backdrop */}
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.15 }}
              className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm"
              onClick={() => setOpen(false)}
            />

            {/* Palette */}
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: -20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: -20 }}
              transition={{ duration: 0.15 }}
              className="fixed top-[20%] left-1/2 -translate-x-1/2 z-50 w-full max-w-lg"
            >
              <div className="bg-[#0C1B2A] border border-white/15 rounded-2xl shadow-2xl overflow-hidden">
                {/* Search Input */}
                <div className="flex items-center gap-3 px-4 py-3 border-b border-white/10">
                  <Search size={18} className="text-gray-400 shrink-0" />
                  <input
                    ref={inputRef}
                    type="text"
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    onKeyDown={handleInputKeyDown}
                    placeholder="Type a command or search..."
                    className="flex-1 bg-transparent text-white text-sm placeholder-gray-500 outline-none"
                  />
                  <button
                    onClick={() => setOpen(false)}
                    className="text-gray-500 hover:text-gray-300 transition-colors"
                  >
                    <X size={16} />
                  </button>
                </div>

                {/* Results */}
                <div ref={listRef} className="max-h-[320px] overflow-y-auto py-2">
                  {filtered.length === 0 ? (
                    <div className="px-4 py-8 text-center text-gray-500 text-sm">
                      No commands found for &ldquo;{query}&rdquo;
                    </div>
                  ) : (
                    Object.entries(grouped).map(([category, items]) => (
                      <div key={category}>
                        <div className="px-4 py-1.5 text-[10px] font-semibold uppercase tracking-wider text-gray-500">
                          {categoryLabels[category] || category}
                        </div>
                        {items.map((cmd) => {
                          flatIndex++;
                          const idx = flatIndex;
                          const isSelected = idx === selectedIndex;
                          return (
                            <button
                              key={cmd.id}
                              data-index={idx}
                              onClick={() => runCommand(cmd)}
                              onMouseEnter={() => setSelectedIndex(idx)}
                              className={`w-full flex items-center gap-3 px-4 py-2.5 text-left transition-colors ${
                                isSelected
                                  ? "bg-emerald-500/10 text-white"
                                  : "text-gray-300 hover:bg-white/5"
                              }`}
                            >
                              <span
                                className={`shrink-0 ${
                                  isSelected ? "text-emerald-400" : "text-gray-500"
                                }`}
                              >
                                {cmd.icon}
                              </span>
                              <div className="flex-1 min-w-0">
                                <div className="text-sm font-medium truncate">
                                  {cmd.label}
                                </div>
                                {cmd.description && (
                                  <div className="text-xs text-gray-500 truncate">
                                    {cmd.description}
                                  </div>
                                )}
                              </div>
                              {cmd.shortcut && (
                                <div className="flex items-center gap-1 shrink-0">
                                  {cmd.shortcut.split(" ").map((key, i) => (
                                    <kbd
                                      key={i}
                                      className="px-1.5 py-0.5 rounded bg-white/10 text-[10px] font-mono text-gray-400"
                                    >
                                      {key}
                                    </kbd>
                                  ))}
                                </div>
                              )}
                              {isSelected && (
                                <ArrowRight size={14} className="text-emerald-400 shrink-0" />
                              )}
                            </button>
                          );
                        })}
                      </div>
                    ))
                  )}
                </div>

                {/* Footer */}
                <div className="px-4 py-2.5 border-t border-white/10 flex items-center justify-between text-[10px] text-gray-500">
                  <div className="flex items-center gap-3">
                    <span className="flex items-center gap-1">
                      <kbd className="px-1 py-0.5 rounded bg-white/10 font-mono">↑↓</kbd> navigate
                    </span>
                    <span className="flex items-center gap-1">
                      <kbd className="px-1 py-0.5 rounded bg-white/10 font-mono">↵</kbd> select
                    </span>
                    <span className="flex items-center gap-1">
                      <kbd className="px-1 py-0.5 rounded bg-white/10 font-mono">esc</kbd> close
                    </span>
                  </div>
                  <span className="flex items-center gap-1">
                    <Command size={10} /> Onyx
                  </span>
                </div>
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </>
  );
}
