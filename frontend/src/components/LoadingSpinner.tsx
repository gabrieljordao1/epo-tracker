import { motion } from "framer-motion";

export function LoadingSpinner() {
  return (
    <div className="flex items-center justify-center h-full">
      <div className="text-center">
        <motion.div
          animate={{ rotate: 360 }}
          transition={{ duration: 2, repeat: Infinity, ease: "linear" }}
          className="w-12 h-12 border-2 border-emerald-500/30 border-t-emerald-400 rounded-full mx-auto mb-4"
        />
        <p className="text-gray-400">Loading...</p>
      </div>
    </div>
  );
}
