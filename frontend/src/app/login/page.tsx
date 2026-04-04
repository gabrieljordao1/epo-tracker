"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowRight, Loader2, HardHat, BarChart3 } from "lucide-react";
import { OnyxLogo } from "@/components/OnyxLogo";
import { login, register } from "@/lib/api";

export default function LoginPage() {
  const router = useRouter();
  const [mode, setMode] = useState<"login" | "register">("login");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  // Login fields
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");

  // Register fields
  const [fullName, setFullName] = useState("");
  const [companyName, setCompanyName] = useState("");
  const [industry, setIndustry] = useState("paint_drywall");
  const [role, setRole] = useState<"field" | "manager">("field");

  const industries = [
    { value: "paint_drywall", label: "Paint & Drywall" },
    { value: "plumbing", label: "Plumbing" },
    { value: "electrical", label: "Electrical" },
    { value: "hvac", label: "HVAC" },
    { value: "flooring", label: "Flooring" },
    { value: "roofing", label: "Roofing" },
    { value: "landscaping", label: "Landscaping" },
    { value: "concrete", label: "Concrete" },
    { value: "insulation", label: "Insulation" },
    { value: "cabinets", label: "Cabinets" },
    { value: "countertops", label: "Countertops" },
    { value: "windows", label: "Windows & Doors" },
    { value: "gutters", label: "Gutters" },
    { value: "framing", label: "Framing" },
    { value: "general", label: "General Contractor" },
    { value: "other", label: "Other" },
  ];

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      const data = await login(email, password);
      // Redirect based on role
      if (data.user.role === "field") {
        router.push("/epos");
      } else {
        router.push("/");
      }
    } catch (err: any) {
      setError(err.message || "Login failed. Check your email and password.");
    } finally {
      setLoading(false);
    }
  };

  const handleRegister = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    if (password.length < 6) {
      setError("Password must be at least 6 characters");
      return;
    }
    setLoading(true);
    try {
      await register(email, password, fullName, companyName, industry, role);
      // Redirect based on role
      if (role === "field") {
        router.push("/epos");
      } else {
        router.push("/");
      }
    } catch (err: any) {
      setError(err.message || "Registration failed. Try a different email.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-[#0a0a0a] flex">
      {/* Left side — branding */}
      <div className="hidden lg:flex flex-1 items-center justify-center bg-gradient-to-br from-[#0a0a0a] to-[#0f1a15] border-r border-white/5">
        <div className="max-w-md px-12">
          <div className="flex items-center gap-3 mb-8">
            <OnyxLogo size={36} />
            <span className="text-2xl font-semibold text-white tracking-tight">
              Onyx
            </span>
          </div>
          <h2 className="text-3xl font-semibold text-white mb-4 leading-tight">
            Stop losing money on unconfirmed EPOs
          </h2>
          <p className="text-white/40 leading-relaxed">
            Track extra purchase orders across all your builders.
            Auto-sync emails, send follow-ups with one click, and let builders
            confirm through a simple link — no portal login needed.
          </p>
          <div className="mt-10 space-y-4">
            {[
              "Email-first intake — EPOs sync automatically",
              "Builder self-service — no login required",
              "One-click batch follow-ups",
              "Export to CSV anytime",
            ].map((feature, i) => (
              <div key={i} className="flex items-center gap-3">
                <div className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
                <span className="text-sm text-white/50">{feature}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Right side — form */}
      <div className="flex-1 flex items-center justify-center px-6">
        <div className="w-full max-w-md">
          {/* Mobile logo */}
          <div className="flex items-center gap-3 mb-8 lg:hidden">
            <OnyxLogo size={32} />
            <span className="text-xl font-semibold text-white">Onyx</span>
          </div>

          <h1 className="text-2xl font-semibold text-white mb-2">
            {mode === "login" ? "Welcome back" : "Create your account"}
          </h1>
          <p className="text-white/40 mb-8">
            {mode === "login"
              ? "Sign in to your Onyx account"
              : "Start tracking EPOs for your team in minutes"}
          </p>

          {error && (
            <div className="mb-6 p-4 rounded-xl bg-red-500/10 border border-red-500/20 text-red-400 text-sm">
              {error}
            </div>
          )}

          <form onSubmit={mode === "login" ? handleLogin : handleRegister}>
            <div className="space-y-4">
              {mode === "register" && (
                <>
                  {/* Role Selector */}
                  <div>
                    <label className="text-xs text-white/30 uppercase tracking-wider font-medium block mb-3">
                      I am a...
                    </label>
                    <div className="grid grid-cols-2 gap-3">
                      <button
                        type="button"
                        onClick={() => setRole("field")}
                        className={`flex flex-col items-center gap-2 p-4 rounded-xl border transition-all ${
                          role === "field"
                            ? "border-emerald-500/60 bg-emerald-500/10 text-emerald-400"
                            : "border-white/10 bg-white/5 text-white/40 hover:border-white/20"
                        }`}
                      >
                        <HardHat size={24} />
                        <span className="text-sm font-medium">Field Manager</span>
                        <span className="text-[11px] text-white/30 leading-tight text-center">
                          Submit EPOs from the field
                        </span>
                      </button>
                      <button
                        type="button"
                        onClick={() => setRole("manager")}
                        className={`flex flex-col items-center gap-2 p-4 rounded-xl border transition-all ${
                          role === "manager"
                            ? "border-emerald-500/60 bg-emerald-500/10 text-emerald-400"
                            : "border-white/10 bg-white/5 text-white/40 hover:border-white/20"
                        }`}
                      >
                        <BarChart3 size={24} />
                        <span className="text-sm font-medium">Operations Manager</span>
                        <span className="text-[11px] text-white/30 leading-tight text-center">
                          Oversee team &amp; analytics
                        </span>
                      </button>
                    </div>
                  </div>

                  <div>
                    <label className="text-xs text-white/30 uppercase tracking-wider font-medium block mb-2">
                      Full Name
                    </label>
                    <input
                      type="text"
                      value={fullName}
                      onChange={(e) => setFullName(e.target.value)}
                      placeholder="Your full name"
                      required
                      className="w-full px-4 py-3 bg-white/5 border border-white/10 rounded-xl text-white placeholder-white/20 focus:outline-none focus:border-emerald-500/40 transition-colors"
                    />
                  </div>
                  <div>
                    <label className="text-xs text-white/30 uppercase tracking-wider font-medium block mb-2">
                      Company Name
                    </label>
                    <input
                      type="text"
                      value={companyName}
                      onChange={(e) => setCompanyName(e.target.value)}
                      placeholder="Your company name"
                      required
                      className="w-full px-4 py-3 bg-white/5 border border-white/10 rounded-xl text-white placeholder-white/20 focus:outline-none focus:border-emerald-500/40 transition-colors"
                    />
                  </div>
                  <div>
                    <label className="text-xs text-white/30 uppercase tracking-wider font-medium block mb-2">
                      Primary Trade
                    </label>
                    <select
                      value={industry}
                      onChange={(e) => setIndustry(e.target.value)}
                      className="w-full px-4 py-3 bg-white/5 border border-white/10 rounded-xl text-white focus:outline-none focus:border-emerald-500/40 transition-colors appearance-none"
                    >
                      {industries.map((ind) => (
                        <option key={ind.value} value={ind.value} className="bg-[#141414]">
                          {ind.label}
                        </option>
                      ))}
                    </select>
                  </div>
                </>
              )}

              <div>
                <label className="text-xs text-white/30 uppercase tracking-wider font-medium block mb-2">
                  Email
                </label>
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="you@company.com"
                  required
                  className="w-full px-4 py-3 bg-white/5 border border-white/10 rounded-xl text-white placeholder-white/20 focus:outline-none focus:border-emerald-500/40 transition-colors"
                />
              </div>

              <div>
                <label className="text-xs text-white/30 uppercase tracking-wider font-medium block mb-2">
                  Password
                </label>
                <input
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder={mode === "register" ? "At least 6 characters" : "Your password"}
                  required
                  minLength={mode === "register" ? 6 : undefined}
                  className="w-full px-4 py-3 bg-white/5 border border-white/10 rounded-xl text-white placeholder-white/20 focus:outline-none focus:border-emerald-500/40 transition-colors"
                />
              </div>
            </div>

            <button
              type="submit"
              disabled={loading}
              className="w-full mt-6 py-3.5 bg-emerald-500 hover:bg-emerald-400 text-white font-semibold rounded-xl transition-colors flex items-center justify-center gap-2 disabled:opacity-50"
            >
              {loading ? (
                <Loader2 size={18} className="animate-spin" />
              ) : (
                <>
                  {mode === "login" ? "Sign In" : "Create Account"}
                  <ArrowRight size={18} />
                </>
              )}
            </button>
          </form>

          {/* Toggle login/register */}
          <div className="mt-8 text-center border-t border-white/5 pt-6">
            {mode === "login" ? (
              <p className="text-sm text-white/40">
                New to Onyx?{" "}
                <button
                  onClick={() => { setMode("register"); setError(""); }}
                  className="text-emerald-400 hover:text-emerald-300 font-medium"
                >
                  Create an account
                </button>
              </p>
            ) : (
              <p className="text-sm text-white/40">
                Already have an account?{" "}
                <button
                  onClick={() => { setMode("login"); setError(""); }}
                  className="text-emerald-400 hover:text-emerald-300 font-medium"
                >
                  Sign in
                </button>
              </p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
