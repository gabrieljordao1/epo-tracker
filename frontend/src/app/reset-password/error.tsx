"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle } from "lucide-react";
import { OnyxLogo } from "@/components/OnyxLogo";

export default function ResetPasswordError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const router = useRouter();

  useEffect(() => {
    console.error("[reset-password] Page error caught:", error);
  }, [error]);

  return (
    <div className="min-h-screen bg-[#0a0a0a] flex items-center justify-center px-6">
      <div className="w-full max-w-md">
        <div className="flex items-center gap-3 mb-8">
          <OnyxLogo size={32} />
          <span className="text-xl font-semibold text-white">Onyx</span>
        </div>

        <div className="text-center">
          <div className="flex justify-center mb-6">
            <div className="w-16 h-16 rounded-full bg-red-500/20 border border-red-500/40 flex items-center justify-center">
              <AlertTriangle size={32} className="text-red-400" />
            </div>
          </div>
          <h1 className="text-2xl font-semibold text-white mb-2">
            Something went wrong
          </h1>
          <p className="text-white/40 mb-6">
            There was an issue resetting your password. Please try again.
          </p>

          <div className="flex flex-col gap-3">
            <button
              onClick={reset}
              className="w-full py-3.5 bg-emerald-500 hover:bg-emerald-400 text-white font-semibold rounded-xl transition-colors"
            >
              Try Again
            </button>
            <button
              onClick={() => router.push("/login")}
              className="w-full py-3.5 bg-white/5 hover:bg-white/10 border border-white/10 text-white font-semibold rounded-xl transition-colors"
            >
              Back to Login
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
