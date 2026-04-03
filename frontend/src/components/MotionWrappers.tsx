"use client";

import { motion } from "framer-motion";
import { ReactNode } from "react";

// Staggered fade-in for card grids
export function StaggerGrid({ children, className = "" }: { children: ReactNode; className?: string }) {
  return (
    <motion.div
      className={className}
      initial="hidden"
      animate="visible"
      variants={{
        hidden: {},
        visible: { transition: { staggerChildren: 0.1 } },
      }}
    >
      {children}
    </motion.div>
  );
}

// Individual card fade-up
export function FadeUp({ children, className = "", delay = 0 }: { children: ReactNode; className?: string; delay?: number }) {
  return (
    <motion.div
      className={className}
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5, ease: [0.16, 1, 0.3, 1], delay }}
    >
      {children}
    </motion.div>
  );
}

// Stagger child variant (use inside StaggerGrid)
export function StaggerChild({ children, className = "" }: { children: ReactNode; className?: string }) {
  return (
    <motion.div
      className={className}
      variants={{
        hidden: { opacity: 0, y: 16 },
        visible: { opacity: 1, y: 0, transition: { duration: 0.45, ease: [0.16, 1, 0.3, 1] } },
      }}
    >
      {children}
    </motion.div>
  );
}

// Slide in from left (for sidebar items, table rows)
export function SlideIn({ children, className = "", delay = 0, direction = "left" }: { children: ReactNode; className?: string; delay?: number; direction?: "left" | "right" }) {
  const x = direction === "left" ? -24 : 24;
  return (
    <motion.div
      className={className}
      initial={{ opacity: 0, x }}
      animate={{ opacity: 1, x: 0 }}
      transition={{ duration: 0.45, ease: [0.16, 1, 0.3, 1], delay }}
    >
      {children}
    </motion.div>
  );
}

// Scale pop (for status badges, alerts)
export function ScalePop({ children, className = "", delay = 0 }: { children: ReactNode; className?: string; delay?: number }) {
  return (
    <motion.div
      className={className}
      initial={{ opacity: 0, scale: 0.85 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={{ duration: 0.35, ease: [0.34, 1.56, 0.64, 1], delay }}
    >
      {children}
    </motion.div>
  );
}

// Animated counter for stats
export function AnimatedNumber({ value, duration = 1.2 }: { value: number; duration?: number }) {
  return (
    <motion.span
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.3 }}
    >
      <motion.span
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
      >
        {value}
      </motion.span>
    </motion.span>
  );
}

// Glow pulse for new items
export function GlowPulse({ children, color = "rgba(52,211,153,0.3)", active = false }: { children: ReactNode; color?: string; active?: boolean }) {
  return (
    <motion.div
      animate={active ? {
        boxShadow: [`0 0 0px ${color}`, `0 0 20px ${color}`, `0 0 0px ${color}`],
      } : {}}
      transition={{ duration: 2, repeat: active ? 2 : 0 }}
      style={{ borderRadius: 12 }}
    >
      {children}
    </motion.div>
  );
}

// Page transition wrapper
export function PageTransition({ children }: { children: ReactNode }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, ease: [0.16, 1, 0.3, 1] }}
    >
      {children}
    </motion.div>
  );
}

// Table row animation
export function AnimatedRow({ children, className = "", index = 0, highlight = false }: { children: ReactNode; className?: string; index?: number; highlight?: boolean }) {
  return (
    <motion.tr
      className={className}
      initial={{ opacity: 0, x: -10 }}
      animate={{
        opacity: 1,
        x: 0,
        backgroundColor: highlight ? ["rgba(52,211,153,0.08)", "rgba(52,211,153,0)", "rgba(52,211,153,0)"] : undefined,
      }}
      transition={{
        duration: 0.35,
        delay: index * 0.04,
        ease: [0.16, 1, 0.3, 1],
        backgroundColor: highlight ? { duration: 3, times: [0, 0.3, 1] } : undefined,
      }}
    >
      {children}
    </motion.tr>
  );
}
