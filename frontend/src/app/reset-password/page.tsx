"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import {
  Mail,
  Key,
  Lock,
  ArrowLeft,
  Check,
  Eye,
  EyeOff,
  Loader2,
} from "lucide-react";
import { OnyxLogo } from "@/components/OnyxLogo";

type Step = "email" | "code" | "password" | "success";

interface PasswordStrength {
  score: 0 | 1 | 2 | 3;
  label: string;
  color: string;
  bgColor: string;
}

export default function ResetPasswordPage() {
  const router = useRouter();

  // Step state
  const [step, setStep] = useState<Step>("email");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  // Step 1: Email
  const [email, setEmail] = useState("");
  const [emailSubmitted, setEmailSubmitted] = useState(false);

  // Step 2: Code
  const [code, setCode] = useState("");
  const [resendTimer, setResendTimer] = useState(0);
  const [codeVerified, setCodeVerified] = useState(false);

  // Step 3: Password
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);

  // Password strength
  const getPasswordStrength = (): PasswordStrength => {
    if (!password) return { score: 0, label: "", color: "", bgColor: "" };

    let score = 0;
    if (password.length >= 8) score++;
    if (/[A-Z]/.test(password)) score++;
    if (/[a-z]/.test(password)) score++;
    if (/[0-9]/.test(password)) score++;

    const strengths: Record<number, PasswordStrength> = {
      0: { score: 0, label: "Very Weak", color: "text-red-400", bgColor: "bg-red-500/20" },
      1: { score: 1, label: "Weak", color: "text-orange-400", bgColor: "bg-orange-500/20" },
      2: { score: 2, label: "Fair", color: "text-yellow-400", bgColor: "bg-yellow-500/20" },
      3: { score: 3, label: "Good", color: "text-emerald-400", bgColor: "bg-emerald-500/20" },
    };

    return strengths[score] as PasswordStrength;
  };

  // Password requirements
  const requirements = {
    length: password.length >= 8,
    uppercase: /[A-Z]/.test(password),
    lowercase: /[a-z]/.test(password),
    digit: /[0-9]/.test(password),
  };

  const allRequirementsMet = Object.values(requirements).every(Boolean);

  // Resend timer
  useEffect(() => {
    let interval: NodeJS.Timeout;
    if (resendTimer > 0) {
      interval = setInterval(() => {
        setResendTimer((t) => t - 1);
      }, 1000);
    }
    return () => clearInterval(interval);
  }, [resendTimer]);

  // Step 1: Submit email
  const handleSubmitEmail = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setLoading(true);

    try {
      const response = await fetch("/api/auth/forgot-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
      });

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || "Failed to send reset code");
      }

      setEmailSubmitted(true);
      setStep("code");
      setResendTimer(60);
    } catch (err: any) {
      setError(err.message || "Failed to send reset code. Try again.");
    } finally {
      setLoading(false);
    }
  };

  // Step 2: Verify code
  const handleVerifyCode = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");

    if (code.length !== 6 || !/^\d+$/.test(code)) {
      setError("Please enter a valid 6-digit code");
      return;
    }

    setLoading(true);

    try {
      const response = await fetch("/api/auth/verify-reset-code", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, code }),
      });

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || "Invalid code");
      }

      setCodeVerified(true);
      setStep("password");
    } catch (err: any) {
      setError(err.message || "Invalid code. Try again.");
    } finally {
      setLoading(false);
    }
  };

  // Step 2: Resend code
  const handleResendCode = async () => {
    setError("");
    setLoading(true);

    try {
      const response = await fetch("/api/auth/forgot-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
      });

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || "Failed to resend code");
      }

      setCode("");
      setResendTimer(60);
    } catch (err: any) {
      setError(err.message || "Failed to resend code. Try again.");
    } finally {
      setLoading(false);
    }
  };

  // Step 3: Reset password
  const handleResetPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");

    if (!allRequirementsMet) {
      setError("Password does not meet all requirements");
      return;
    }

    if (password !== confirmPassword) {
      setError("Passwords do not match");
      return;
    }

    setLoading(true);

    try {
      const response = await fetch("/api/auth/reset-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, code, password }),
      });

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || "Failed to reset password");
      }

      setStep("success");
      setTimeout(() => {
        router.push("/login");
      }, 3000);
    } catch (err: any) {
      setError(err.message || "Failed to reset password. Try again.");
    } finally {
      setLoading(false);
    }
  };

  // Back buttons
  const handleBackFromCode = () => {
    setStep("email");
    setCode("");
    setError("");
    setResendTimer(0);
  };

  const handleBackFromPassword = () => {
    setStep("code");
    setError("");
  };

  const passwordStrength = getPasswordStrength();

  return (
    <div className="min-h-screen bg-[#0a0a0a] flex items-center justify-center px-6">
      <div className="w-full max-w-md">
        {/* Header */}
        <div className="flex items-center gap-3 mb-8">
          <OnyxLogo size={32} />
          <span className="text-xl font-semibold text-white">Onyx</span>
        </div>

        {/* Success Screen */}
        {step === "success" && (
          <div className="text-center">
            <div className="flex justify-center mb-6">
              <div className="w-16 h-16 rounded-full bg-emerald-500/20 border border-emerald-500/40 flex items-center justify-center">
                <Check size={32} className="text-emerald-400" />
              </div>
            </div>
            <h1 className="text-2xl font-semibold text-white mb-2">
              Password Reset Complete
            </h1>
            <p className="text-white/40 mb-6">
              Your password has been successfully reset. Redirecting to login...
            </p>
            <div className="text-sm text-white/30">
              Redirecting in 3 seconds
            </div>
          </div>
        )}

        {/* Step 1: Email */}
        {step === "email" && (
          <>
            <h1 className="text-2xl font-semibold text-white mb-2">
              Reset your password
            </h1>
            <p className="text-white/40 mb-8">
              Enter your email address and we'll send you a reset code
            </p>

            {error && (
              <div className="mb-6 p-4 rounded-xl bg-red-500/10 border border-red-500/20 text-red-400 text-sm">
                {error}
              </div>
            )}

            <form onSubmit={handleSubmitEmail}>
              <div className="space-y-4 mb-6">
                <div>
                  <label className="text-xs text-white/30 uppercase tracking-wider font-medium block mb-2">
                    Email Address
                  </label>
                  <div className="relative">
                    <Mail
                      size={18}
                      className="absolute left-4 top-1/2 transform -translate-y-1/2 text-white/30"
                    />
                    <input
                      type="email"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      placeholder="you@company.com"
                      required
                      className="w-full pl-11 pr-4 py-3 bg-white/5 border border-white/10 rounded-xl text-white placeholder-white/20 focus:outline-none focus:border-emerald-500/40 transition-colors"
                    />
                  </div>
                </div>
              </div>

              <button
                type="submit"
                disabled={loading || !email}
                className="w-full py-3.5 bg-emerald-500 hover:bg-emerald-400 disabled:bg-emerald-500/50 text-white font-semibold rounded-xl transition-colors flex items-center justify-center gap-2 disabled:opacity-50"
              >
                {loading ? (
                  <Loader2 size={18} className="animate-spin" />
                ) : (
                  <>
                    <Mail size={18} />
                    Send Reset Code
                  </>
                )}
              </button>
            </form>

            <div className="mt-8 text-center border-t border-white/5 pt-6">
              <p className="text-sm text-white/40">
                Remember your password?{" "}
                <button
                  onClick={() => router.push("/login")}
                  className="text-emerald-400 hover:text-emerald-300 font-medium"
                >
                  Back to login
                </button>
              </p>
            </div>
          </>
        )}

        {/* Step 2: Code */}
        {step === "code" && (
          <>
            <div className="flex items-center gap-3 mb-6">
              <button
                onClick={handleBackFromCode}
                className="p-2 hover:bg-white/5 rounded-lg transition-colors"
              >
                <ArrowLeft size={20} className="text-white/40" />
              </button>
              <h1 className="text-2xl font-semibold text-white">Verify code</h1>
            </div>
            <p className="text-white/40 mb-8">
              We sent a 6-digit code to{" "}
              <span className="text-white/60 font-medium">{email}</span>
            </p>

            {error && (
              <div className="mb-6 p-4 rounded-xl bg-red-500/10 border border-red-500/20 text-red-400 text-sm">
                {error}
              </div>
            )}

            <form onSubmit={handleVerifyCode}>
              <div className="space-y-4 mb-6">
                <div>
                  <label className="text-xs text-white/30 uppercase tracking-wider font-medium block mb-2">
                    Verification Code
                  </label>
                  <div className="relative">
                    <Key
                      size={18}
                      className="absolute left-4 top-1/2 transform -translate-y-1/2 text-white/30"
                    />
                    <input
                      type="text"
                      value={code}
                      onChange={(e) => {
                        const val = e.target.value.replace(/\D/g, "").slice(0, 6);
                        setCode(val);
                      }}
                      placeholder="000000"
                      maxLength={6}
                      required
                      className="w-full pl-11 pr-4 py-3 bg-white/5 border border-white/10 rounded-xl text-white placeholder-white/20 focus:outline-none focus:border-emerald-500/40 transition-colors font-mono text-xl tracking-widest text-center"
                    />
                  </div>
                </div>
              </div>

              <button
                type="submit"
                disabled={loading || code.length !== 6}
                className="w-full py-3.5 bg-emerald-500 hover:bg-emerald-400 disabled:bg-emerald-500/50 text-white font-semibold rounded-xl transition-colors flex items-center justify-center gap-2"
              >
                {loading ? (
                  <Loader2 size={18} className="animate-spin" />
                ) : (
                  <>
                    <Check size={18} />
                    Verify Code
                  </>
                )}
              </button>
            </form>

            <div className="mt-6 text-center">
              <p className="text-xs text-white/40 mb-3">
                Didn't receive the code?
              </p>
              <button
                onClick={handleResendCode}
                disabled={resendTimer > 0 || loading}
                className="text-emerald-400 hover:text-emerald-300 font-medium text-sm disabled:text-white/30 disabled:cursor-not-allowed transition-colors"
              >
                {resendTimer > 0 ? `Resend in ${resendTimer}s` : "Resend Code"}
              </button>
            </div>
          </>
        )}

        {/* Step 3: Password */}
        {step === "password" && (
          <>
            <div className="flex items-center gap-3 mb-6">
              <button
                onClick={handleBackFromPassword}
                className="p-2 hover:bg-white/5 rounded-lg transition-colors"
              >
                <ArrowLeft size={20} className="text-white/40" />
              </button>
              <h1 className="text-2xl font-semibold text-white">
                Create new password
              </h1>
            </div>
            <p className="text-white/40 mb-8">
              Enter a strong password for your account
            </p>

            {error && (
              <div className="mb-6 p-4 rounded-xl bg-red-500/10 border border-red-500/20 text-red-400 text-sm">
                {error}
              </div>
            )}

            <form onSubmit={handleResetPassword}>
              <div className="space-y-4 mb-6">
                {/* Password input */}
                <div>
                  <label className="text-xs text-white/30 uppercase tracking-wider font-medium block mb-2">
                    New Password
                  </label>
                  <div className="relative">
                    <Lock
                      size={18}
                      className="absolute left-4 top-1/2 transform -translate-y-1/2 text-white/30"
                    />
                    <input
                      type={showPassword ? "text" : "password"}
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      placeholder="Enter strong password"
                      required
                      className="w-full pl-11 pr-11 py-3 bg-white/5 border border-white/10 rounded-xl text-white placeholder-white/20 focus:outline-none focus:border-emerald-500/40 transition-colors"
                    />
                    <button
                      type="button"
                      onClick={() => setShowPassword(!showPassword)}
                      className="absolute right-4 top-1/2 transform -translate-y-1/2 text-white/40 hover:text-white/60"
                    >
                      {showPassword ? (
                        <EyeOff size={18} />
                      ) : (
                        <Eye size={18} />
                      )}
                    </button>
                  </div>
                </div>

                {/* Confirm password input */}
                <div>
                  <label className="text-xs text-white/30 uppercase tracking-wider font-medium block mb-2">
                    Confirm Password
                  </label>
                  <div className="relative">
                    <Lock
                      size={18}
                      className="absolute left-4 top-1/2 transform -translate-y-1/2 text-white/30"
                    />
                    <input
                      type={showConfirmPassword ? "text" : "password"}
                      value={confirmPassword}
                      onChange={(e) => setConfirmPassword(e.target.value)}
                      placeholder="Re-enter password"
                      required
                      className="w-full pl-11 pr-11 py-3 bg-white/5 border border-white/10 rounded-xl text-white placeholder-white/20 focus:outline-none focus:border-emerald-500/40 transition-colors"
                    />
                    <button
                      type="button"
                      onClick={() =>
                        setShowConfirmPassword(!showConfirmPassword)
                      }
                      className="absolute right-4 top-1/2 transform -translate-y-1/2 text-white/40 hover:text-white/60"
                    >
                      {showConfirmPassword ? (
                        <EyeOff size={18} />
                      ) : (
                        <Eye size={18} />
                      )}
                    </button>
                  </div>
                </div>

                {/* Password strength */}
                {password && (
                  <div>
                    <div className="flex items-center justify-between mb-2">
                      <label className="text-xs text-white/30 uppercase tracking-wider font-medium">
                        Strength
                      </label>
                      <span
                        className={`text-xs font-medium ${passwordStrength.color}`}
                      >
                        {passwordStrength.label}
                      </span>
                    </div>
                    <div className="w-full h-2 bg-white/5 rounded-full overflow-hidden">
                      <div
                        className={`h-full transition-all duration-300 ${
                          passwordStrength.score === 0
                            ? "w-0 bg-red-500"
                            : passwordStrength.score === 1
                              ? "w-1/3 bg-orange-500"
                              : passwordStrength.score === 2
                                ? "w-2/3 bg-yellow-500"
                                : "w-full bg-emerald-500"
                        }`}
                      />
                    </div>
                  </div>
                )}

                {/* Requirements */}
                <div className="space-y-2">
                  <label className="text-xs text-white/30 uppercase tracking-wider font-medium block">
                    Requirements
                  </label>
                  <div className="space-y-1.5">
                    <div
                      className={`flex items-center gap-2 text-sm transition-colors ${
                        requirements.length
                          ? "text-emerald-400"
                          : "text-white/40"
                      }`}
                    >
                      <div
                        className={`w-4 h-4 rounded border flex items-center justify-center transition-colors ${
                          requirements.length
                            ? "border-emerald-500/40 bg-emerald-500/10"
                            : "border-white/20"
                        }`}
                      >
                        {requirements.length && (
                          <Check size={12} className="text-emerald-400" />
                        )}
                      </div>
                      At least 8 characters
                    </div>
                    <div
                      className={`flex items-center gap-2 text-sm transition-colors ${
                        requirements.uppercase
                          ? "text-emerald-400"
                          : "text-white/40"
                      }`}
                    >
                      <div
                        className={`w-4 h-4 rounded border flex items-center justify-center transition-colors ${
                          requirements.uppercase
                            ? "border-emerald-500/40 bg-emerald-500/10"
                            : "border-white/20"
                        }`}
                      >
                        {requirements.uppercase && (
                          <Check size={12} className="text-emerald-400" />
                        )}
                      </div>
                      One uppercase letter (A-Z)
                    </div>
                    <div
                      className={`flex items-center gap-2 text-sm transition-colors ${
                        requirements.lowercase
                          ? "text-emerald-400"
                          : "text-white/40"
                      }`}
                    >
                      <div
                        className={`w-4 h-4 rounded border flex items-center justify-center transition-colors ${
                          requirements.lowercase
                            ? "border-emerald-500/40 bg-emerald-500/10"
                            : "border-white/20"
                        }`}
                      >
                        {requirements.lowercase && (
                          <Check size={12} className="text-emerald-400" />
                        )}
                      </div>
                      One lowercase letter (a-z)
                    </div>
                    <div
                      className={`flex items-center gap-2 text-sm transition-colors ${
                        requirements.digit ? "text-emerald-400" : "text-white/40"
                      }`}
                    >
                      <div
                        className={`w-4 h-4 rounded border flex items-center justify-center transition-colors ${
                          requirements.digit
                            ? "border-emerald-500/40 bg-emerald-500/10"
                            : "border-white/20"
                        }`}
                      >
                        {requirements.digit && (
                          <Check size={12} className="text-emerald-400" />
                        )}
                      </div>
                      One number (0-9)
                    </div>
                  </div>
                </div>
              </div>

              <button
                type="submit"
                disabled={loading || !allRequirementsMet || password !== confirmPassword}
                className="w-full py-3.5 bg-emerald-500 hover:bg-emerald-400 disabled:bg-emerald-500/50 text-white font-semibold rounded-xl transition-colors flex items-center justify-center gap-2"
              >
                {loading ? (
                  <Loader2 size={18} className="animate-spin" />
                ) : (
                  <>
                    <Lock size={18} />
                    Reset Password
                  </>
                )}
              </button>
            </form>
          </>
        )}
      </div>
    </div>
  );
}
