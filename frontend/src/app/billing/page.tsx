"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import {
  Check,
  CreditCard,
  Loader2,
  ExternalLink,
  Zap,
  Shield,
  Building2,
  Crown,
  AlertTriangle,
} from "lucide-react";
import { useToast } from "@/components/Toast";
import {
  getBillingStatus,
  getBillingPlans,
  createCheckoutSession,
  createPortalSession,
  setupStripeProducts,
  getMe,
} from "@/lib/api";

const PLAN_ICONS: Record<string, any> = {
  starter: Zap,
  pro: Shield,
  business: Building2,
  enterprise: Crown,
};

const PLAN_COLORS: Record<string, string> = {
  starter: "border-blue-500/30 bg-blue-500/5",
  pro: "border-purple-500/30 bg-purple-500/5",
  business: "border-amber-500/30 bg-amber-500/5",
  enterprise: "border-emerald-500/30 bg-emerald-500/5",
};

const PLAN_BADGE_COLORS: Record<string, string> = {
  starter: "bg-blue-500/20 text-blue-400",
  pro: "bg-purple-500/20 text-purple-400",
  business: "bg-amber-500/20 text-amber-400",
  enterprise: "bg-emerald-500/20 text-emerald-400",
};

export default function BillingPage() {
  const router = useRouter();
  const toast = useToast();
  const [loading, setLoading] = useState(true);
  const [billingStatus, setBillingStatus] = useState<any>(null);
  const [plans, setPlans] = useState<any[]>([]);
  const [user, setUser] = useState<any>(null);
  const [checkoutLoading, setCheckoutLoading] = useState<string | null>(null);
  const [portalLoading, setPortalLoading] = useState(false);
  const [setupLoading, setSetupLoading] = useState(false);

  useEffect(() => {
    loadData();
  }, []);

  async function loadData() {
    try {
      const [statusData, plansData, userData] = await Promise.all([
        getBillingStatus(),
        getBillingPlans(),
        getMe(),
      ]);
      setBillingStatus(statusData);
      setPlans(plansData.plans || []);
      setUser(userData);
    } catch (err: any) {
      toast.error("Failed to load billing info");
    } finally {
      setLoading(false);
    }
  }

  async function handleSubscribe(planId: string) {
    setCheckoutLoading(planId);
    try {
      const { checkout_url } = await createCheckoutSession(planId);
      window.location.href = checkout_url;
    } catch (err: any) {
      toast.error(err.message || "Failed to start checkout");
      setCheckoutLoading(null);
    }
  }

  async function handleManageBilling() {
    setPortalLoading(true);
    try {
      const { portal_url } = await createPortalSession();
      window.location.href = portal_url;
    } catch (err: any) {
      toast.error(err.message || "Failed to open billing portal");
      setPortalLoading(false);
    }
  }

  async function handleSetupProducts() {
    setSetupLoading(true);
    try {
      const result = await setupStripeProducts();
      toast.success(`Created ${result.products.length} Stripe products`);
    } catch (err: any) {
      toast.error(err.message || "Failed to setup products");
    } finally {
      setSetupLoading(false);
    }
  }

  const isAdmin = user?.role === "admin";
  const currentPlan = billingStatus?.plan || "starter";
  const subStatus = billingStatus?.stripe_subscription_status;

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <Loader2 className="w-8 h-8 animate-spin text-blue-400" />
      </div>
    );
  }

  return (
    <div className="max-w-6xl mx-auto px-4 py-8">
      {/* Header */}
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-text1">Billing & Plans</h1>
        <p className="text-text3 mt-1">
          Manage your subscription and billing details
        </p>
      </div>

      {/* Current Plan Banner */}
      <div className="bg-[#111] border border-[#333] rounded-lg p-6 mb-8">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-text3 text-sm uppercase font-semibold tracking-wide">
              Current Plan
            </p>
            <p className="text-2xl font-bold text-text1 mt-1 capitalize">
              {currentPlan}
            </p>
            {subStatus && (
              <span
                className={`inline-block mt-2 px-2.5 py-0.5 rounded text-xs font-medium ${
                  subStatus === "active"
                    ? "bg-green-500/20 text-green-400"
                    : subStatus === "past_due"
                    ? "bg-yellow-500/20 text-yellow-400"
                    : "bg-red-500/20 text-red-400"
                }`}
              >
                {subStatus === "active"
                  ? "Active"
                  : subStatus === "past_due"
                  ? "Past Due"
                  : subStatus}
              </span>
            )}
          </div>
          <div className="flex gap-3">
            {billingStatus?.stripe_customer_id && isAdmin && (
              <button
                onClick={handleManageBilling}
                disabled={portalLoading}
                className="flex items-center gap-2 px-4 py-2 bg-[#222] hover:bg-[#333] border border-[#444] rounded-lg text-text1 text-sm transition-colors"
              >
                {portalLoading ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <CreditCard className="w-4 h-4" />
                )}
                Manage Billing
              </button>
            )}
            {isAdmin && !billingStatus?.stripe_customer_id && (
              <button
                onClick={handleSetupProducts}
                disabled={setupLoading}
                className="flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-700 rounded-lg text-white text-sm transition-colors"
              >
                {setupLoading ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <Zap className="w-4 h-4" />
                )}
                Initialize Stripe Products
              </button>
            )}
          </div>
        </div>

        {subStatus === "past_due" && (
          <div className="mt-4 flex items-center gap-2 bg-yellow-500/10 border border-yellow-500/30 rounded-lg p-3 text-yellow-400 text-sm">
            <AlertTriangle className="w-4 h-4 flex-shrink-0" />
            Your payment is past due. Please update your payment method to avoid service interruption.
          </div>
        )}
      </div>

      {/* Plan Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-8">
        {plans.map((plan: any) => {
          const Icon = PLAN_ICONS[plan.id] || Zap;
          const isCurrentPlan = currentPlan === plan.id;
          const isUpgrade =
            ["starter", "pro", "business", "enterprise"].indexOf(plan.id) >
            ["starter", "pro", "business", "enterprise"].indexOf(currentPlan);

          return (
            <div
              key={plan.id}
              className={`relative border rounded-xl p-6 transition-all ${
                isCurrentPlan
                  ? "border-blue-500 bg-blue-500/5 ring-1 ring-blue-500/20"
                  : PLAN_COLORS[plan.id] || "border-[#333] bg-[#111]"
              }`}
            >
              {isCurrentPlan && (
                <div className="absolute -top-3 left-4">
                  <span className="bg-blue-500 text-white text-xs font-semibold px-3 py-1 rounded-full">
                    Current Plan
                  </span>
                </div>
              )}

              <div className="flex items-center gap-3 mb-4 mt-1">
                <div
                  className={`w-10 h-10 rounded-lg flex items-center justify-center ${
                    PLAN_BADGE_COLORS[plan.id] || "bg-[#222] text-text1"
                  }`}
                >
                  <Icon className="w-5 h-5" />
                </div>
                <h3 className="text-lg font-bold text-text1">{plan.name}</h3>
              </div>

              <div className="mb-5">
                {plan.price_monthly !== null ? (
                  <div className="flex items-baseline gap-1">
                    <span className="text-3xl font-bold text-text1">
                      ${plan.price_monthly}
                    </span>
                    <span className="text-text3 text-sm">/mo</span>
                  </div>
                ) : (
                  <p className="text-xl font-bold text-text1">Custom Pricing</p>
                )}
              </div>

              <ul className="space-y-2.5 mb-6">
                {plan.features.map((feature: string, i: number) => (
                  <li key={i} className="flex items-start gap-2 text-sm text-text2">
                    <Check className="w-4 h-4 text-green-400 flex-shrink-0 mt-0.5" />
                    {feature}
                  </li>
                ))}
              </ul>

              {isAdmin && (
                <div className="mt-auto">
                  {isCurrentPlan ? (
                    <button
                      disabled
                      className="w-full py-2.5 rounded-lg bg-[#222] text-text3 text-sm font-medium cursor-not-allowed"
                    >
                      Current Plan
                    </button>
                  ) : plan.id === "enterprise" ? (
                    <a
                      href="mailto:sales@epotracker.com?subject=Enterprise%20Plan%20Inquiry"
                      className="block w-full py-2.5 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-sm font-medium text-center transition-colors"
                    >
                      Contact Sales
                    </a>
                  ) : (
                    <button
                      onClick={() => handleSubscribe(plan.id)}
                      disabled={checkoutLoading === plan.id}
                      className={`w-full py-2.5 rounded-lg text-white text-sm font-medium transition-colors ${
                        isUpgrade
                          ? "bg-blue-600 hover:bg-blue-700"
                          : "bg-[#333] hover:bg-[#444]"
                      }`}
                    >
                      {checkoutLoading === plan.id ? (
                        <Loader2 className="w-4 h-4 animate-spin mx-auto" />
                      ) : isUpgrade ? (
                        "Upgrade"
                      ) : (
                        "Switch Plan"
                      )}
                    </button>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Billing Details */}
      {billingStatus?.billing_email && (
        <div className="bg-[#111] border border-[#333] rounded-lg p-6">
          <h2 className="text-lg font-semibold text-text1 mb-4">Billing Details</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm">
            <div>
              <p className="text-text3">Billing Email</p>
              <p className="text-text1 mt-1">{billingStatus.billing_email}</p>
            </div>
            {billingStatus.stripe_customer_id && (
              <div>
                <p className="text-text3">Customer ID</p>
                <p className="text-text1 mt-1 font-mono text-xs">
                  {billingStatus.stripe_customer_id}
                </p>
              </div>
            )}
          </div>
        </div>
      )}

      {!isAdmin && (
        <div className="bg-yellow-500/10 border border-yellow-500/30 rounded-lg p-4 text-yellow-400 text-sm">
          Only company admins can manage billing. Contact your admin to upgrade
          your plan.
        </div>
      )}
    </div>
  );
}
