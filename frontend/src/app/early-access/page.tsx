"use client";

import { useState } from "react";
import { motion } from "framer-motion";
import { Mail, Zap, Users, BarChart3, CheckCircle, Loader2, ArrowRight } from "lucide-react";
import { OnyxLogo } from "@/components/OnyxLogo";

export default function EarlyAccessPage() {
  const [formState, setFormState] = useState<"form" | "success">("form");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [formData, setFormData] = useState({
    name: "",
    email: "",
    company: "",
  });

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const { name, value } = e.target;
    setFormData((prev) => ({ ...prev, [name]: value }));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setLoading(true);

    try {
      const response = await fetch("/api/waitlist", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(formData),
      });

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || "Failed to join waitlist");
      }

      setFormState("success");
      setFormData({ name: "", email: "", company: "" });
    } catch (err: any) {
      setError(err.message || "Something went wrong. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  const containerVariants = {
    hidden: { opacity: 0 },
    visible: {
      opacity: 1,
      transition: { staggerChildren: 0.2, delayChildren: 0.1 },
    },
  };

  const itemVariants = {
    hidden: { opacity: 0, y: 20 },
    visible: { opacity: 1, y: 0, transition: { duration: 0.6 } },
  };

  const features = [
    {
      icon: Mail,
      title: "Email Capture Automation",
      description: "EPOs you send automatically sync from email. No manual entry, no chasing builders for details.",
    },
    {
      icon: Zap,
      title: "Real-time EPO Dashboard",
      description: "See every EPO you've sent across all your builders and communities in one place.",
    },
    {
      icon: Users,
      title: "Builder Self-Service Confirmation",
      description: "Builders confirm EPOs with one click. No more back-and-forth emails or phone calls.",
    },
    {
      icon: BarChart3,
      title: "Analytics & Reporting",
      description: "Track spending, confirmation rates, and turnaround times across all your projects.",
    },
  ];

  return (
    <div className="min-h-screen bg-bg text-text1 overflow-hidden">
      {/* Animated background gradients */}
      <div className="fixed inset-0 z-0">
        <div className="absolute top-0 left-1/4 w-96 h-96 bg-green/10 rounded-full blur-3xl opacity-20 animate-pulse" />
        <div className="absolute bottom-0 right-1/4 w-96 h-96 bg-purple/5 rounded-full blur-3xl opacity-20 animate-pulse" />
      </div>

      <div className="relative z-10">
        {/* Header / Navigation */}
        <header className="sticky top-0 bg-bg/80 backdrop-blur-md border-b border-border-lt z-50">
          <div className="max-w-7xl mx-auto px-6 py-4 flex items-center justify-between">
            <motion.div
              initial={{ opacity: 0, x: -20 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ duration: 0.5 }}
              className="flex items-center gap-3"
            >
              <OnyxLogo size={32} />
              <span className="text-xl font-semibold text-text1 tracking-tight">Onyx</span>
            </motion.div>
            <motion.a
              initial={{ opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ duration: 0.5, delay: 0.1 }}
              href="/login"
              className="text-sm text-text2 hover:text-green transition-colors"
            >
              Already have access? Sign in
            </motion.a>
          </div>
        </header>

        {/* Hero Section */}
        <section className="max-w-7xl mx-auto px-6 py-24 sm:py-32 lg:py-40">
          <motion.div
            variants={containerVariants}
            initial="hidden"
            animate="visible"
            className="text-center max-w-4xl mx-auto"
          >
            {/* Badge */}
            <motion.div variants={itemVariants} className="mb-6 inline-block">
              <div className="px-4 py-2 rounded-full border border-green/25 bg-green-dim">
                <span className="text-sm font-medium text-green flex items-center gap-2">
                  <span className="w-2 h-2 rounded-full bg-green animate-pulse" />
                  Early Access Available
                </span>
              </div>
            </motion.div>

            {/* Heading */}
            <motion.h1
              variants={itemVariants}
              className="text-5xl sm:text-6xl lg:text-7xl font-bold tracking-tight mb-6 leading-tight"
            >
              <span className="text-text1">EPO tracking </span>
              <span className="bg-gradient-to-r from-green to-emerald-300 bg-clip-text text-transparent">
                built for vendors
              </span>
            </motion.h1>

            {/* Subheading */}
            <motion.p
              variants={itemVariants}
              className="text-lg sm:text-xl text-text2 mb-8 leading-relaxed max-w-2xl mx-auto"
            >
              Stop chasing EPO confirmations. Onyx automatically captures requests from email,
              tracks every EPO you send to builders, and lets them confirm in one click.
            </motion.p>

            {/* CTA Button */}
            <motion.div variants={itemVariants} className="flex justify-center">
              <a
                href="#waitlist"
                className="px-8 py-4 bg-green hover:bg-emerald-300 text-bg font-semibold rounded-xl transition-all flex items-center gap-2 shadow-lg hover:shadow-xl hover:-translate-y-1 duration-200"
              >
                Join the Waitlist
                <ArrowRight size={20} />
              </a>
            </motion.div>
          </motion.div>
        </section>

        {/* Features Section */}
        <section className="max-w-7xl mx-auto px-6 py-20 sm:py-28">
          <motion.div
            initial={{ opacity: 0 }}
            whileInView={{ opacity: 1 }}
            transition={{ duration: 0.6 }}
            viewport={{ once: true, margin: "-100px" }}
            className="text-center mb-16"
          >
            <h2 className="text-4xl sm:text-5xl font-bold mb-4 text-text1">
              Built for Trade Contractors
            </h2>
            <p className="text-text2 text-lg max-w-2xl mx-auto">
              Everything your team needs to track, manage, and get confirmations on EPOs sent to builders across all your communities.
            </p>
          </motion.div>

          <motion.div
            variants={containerVariants}
            initial="hidden"
            whileInView="visible"
            viewport={{ once: true, margin: "-100px" }}
            className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6"
          >
            {features.map((feature, idx) => {
              const Icon = feature.icon;
              return (
                <motion.div
                  key={idx}
                  variants={itemVariants}
                  className="p-6 rounded-2xl bg-card border border-card-border hover:border-green/30 hover:bg-card backdrop-blur-sm transition-all duration-300 group"
                >
                  <div className="mb-4 inline-flex p-3 rounded-xl bg-green-dim group-hover:bg-green/20 transition-colors">
                    <Icon size={24} className="text-green" />
                  </div>
                  <h3 className="text-lg font-semibold text-text1 mb-2">{feature.title}</h3>
                  <p className="text-text3 text-sm leading-relaxed">{feature.description}</p>
                </motion.div>
              );
            })}
          </motion.div>
        </section>

        {/* Waitlist Form Section */}
        <section id="waitlist" className="max-w-4xl mx-auto px-6 py-20 sm:py-28">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6 }}
            viewport={{ once: true, margin: "-100px" }}
            className="rounded-3xl bg-card border border-card-border p-8 sm:p-12 backdrop-blur-sm"
          >
            {formState === "form" ? (
              <>
                <h2 className="text-3xl sm:text-4xl font-bold text-text1 mb-2 text-center">
                  Get Early Access
                </h2>
                <p className="text-text2 text-center mb-8">
                  Join the waitlist to be among the first to use Onyx. We'll email you when your access is ready.
                </p>

                <form onSubmit={handleSubmit} className="space-y-5">
                  <div>
                    <label className="text-sm font-medium text-text2 block mb-2">Full Name</label>
                    <input
                      type="text"
                      name="name"
                      value={formData.name}
                      onChange={handleInputChange}
                      placeholder="John Smith"
                      required
                      disabled={loading}
                      className="w-full px-4 py-3 bg-surface border border-border-lt rounded-xl text-text1 placeholder-text3 focus:outline-none focus:border-green/50 transition-colors disabled:opacity-50"
                    />
                  </div>

                  <div>
                    <label className="text-sm font-medium text-text2 block mb-2">Email</label>
                    <input
                      type="email"
                      name="email"
                      value={formData.email}
                      onChange={handleInputChange}
                      placeholder="you@company.com"
                      required
                      disabled={loading}
                      className="w-full px-4 py-3 bg-surface border border-border-lt rounded-xl text-text1 placeholder-text3 focus:outline-none focus:border-green/50 transition-colors disabled:opacity-50"
                    />
                  </div>

                  <div>
                    <label className="text-sm font-medium text-text2 block mb-2">Company</label>
                    <input
                      type="text"
                      name="company"
                      value={formData.company}
                      onChange={handleInputChange}
                      placeholder="Your company name"
                      required
                      disabled={loading}
                      className="w-full px-4 py-3 bg-surface border border-border-lt rounded-xl text-text1 placeholder-text3 focus:outline-none focus:border-green/50 transition-colors disabled:opacity-50"
                    />
                  </div>

                  {error && (
                    <motion.div
                      initial={{ opacity: 0, y: -10 }}
                      animate={{ opacity: 1, y: 0 }}
                      className="p-4 rounded-xl bg-red-dim border border-red-bdr text-red text-sm"
                    >
                      {error}
                    </motion.div>
                  )}

                  <button
                    type="submit"
                    disabled={loading}
                    className="w-full py-3.5 bg-green hover:bg-emerald-300 text-bg font-semibold rounded-xl transition-all flex items-center justify-center gap-2 disabled:opacity-50 duration-200 hover:-translate-y-0.5"
                  >
                    {loading ? (
                      <>
                        <Loader2 size={18} className="animate-spin" />
                        Joining...
                      </>
                    ) : (
                      <>
                        Join the Waitlist
                        <ArrowRight size={18} />
                      </>
                    )}
                  </button>
                </form>
              </>
            ) : (
              <motion.div
                initial={{ opacity: 0, scale: 0.95 }}
                animate={{ opacity: 1, scale: 1 }}
                transition={{ duration: 0.4 }}
                className="text-center py-12"
              >
                <motion.div
                  initial={{ scale: 0 }}
                  animate={{ scale: 1 }}
                  transition={{ delay: 0.2, type: "spring", stiffness: 200 }}
                  className="inline-flex p-3 rounded-full bg-green-dim mb-6"
                >
                  <CheckCircle size={48} className="text-green" />
                </motion.div>
                <h3 className="text-2xl sm:text-3xl font-bold text-text1 mb-2">You're on the list!</h3>
                <p className="text-text2 mb-6">
                  Thanks for joining. We'll send you an email as soon as your access is ready.
                </p>
                <button
                  onClick={() => {
                    setFormState("form");
                    setFormData({ name: "", email: "", company: "" });
                  }}
                  className="text-green hover:text-emerald-300 font-medium transition-colors"
                >
                  ← Back to form
                </button>
              </motion.div>
            )}
          </motion.div>
        </section>

        {/* Footer */}
        <footer className="border-t border-border-lt bg-bg/50">
          <div className="max-w-7xl mx-auto px-6 py-12">
            <div className="flex flex-col sm:flex-row items-center justify-between gap-4 text-text3 text-sm">
              <div className="flex items-center gap-2">
                <OnyxLogo size={20} />
                <span>Onyx — EPO Tracking for Trade Contractors</span>
              </div>
              <div className="flex items-center gap-6">
                <a href="/login" className="hover:text-text2 transition-colors">
                  Sign In
                </a>
                <a
                  href="mailto:hello@onyxepos.com"
                  className="hover:text-text2 transition-colors"
                >
                  Contact
                </a>
              </div>
            </div>
          </div>
        </footer>
      </div>
    </div>
  );
}
