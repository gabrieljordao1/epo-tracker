"use client";

import { useState, useEffect, Suspense } from "react";
import { useSearchParams } from "next/navigation";
import {
  ChevronRight,
  Mail,
  CheckCircle,
  AlertTriangle,
  ExternalLink,
  RefreshCw,
  Loader2,
} from "lucide-react";
import {
  startGmailOAuth,
  getEmailStatus,
  triggerEmailSync,
  disconnectEmail,
} from "@/lib/api";

export default function SettingsPage() {
  return (
    <Suspense fallback={<div className="p-8">Loading settings...</div>}>
      <SettingsContent />
    </Suspense>
  );
}

function SettingsContent() {
  const searchParams = useSearchParams();
  const oauthSuccess = searchParams.get("success");
  const oauthError = searchParams.get("error");

  const [settings, setSettings] = useState({
    emailNotifications: true,
    slackNotifications: false,
    dailyDigest: true,
    followUpReminders: true,
  });

  const [emailStatus, setEmailStatus] = useState<any>(null);
  const [connectingGmail, setConnectingGmail] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [syncResult, setSyncResult] = useState<string | null>(null);
  const [disconnecting, setDisconnecting] = useState<number | null>(null);
  const [oauthBanner, setOauthBanner] = useState<{
    type: "success" | "error";
    msg: string;
  } | null>(null);

  useEffect(() => {
    loadEmailStatus();

    if (oauthSuccess === "gmail_connected") {
      setOauthBanner({ type: "success", msg: "Gmail connected successfully!" });
      loadEmailStatus();
    } else if (oauthError) {
      setOauthBanner({
        type: "error",
        msg: `OAuth failed: ${oauthError.replace(/_/g, " ")}`,
      });
    }
  }, [oauthSuccess, oauthError]);

  const loadEmailStatus = async () => {
    try {
      const status = await getEmailStatus();
      setEmailStatus(status);
    } catch {
      // Not authenticated or no connections
      setEmailStatus(null);
    }
  };

  const handleConnectGmail = async () => {
    setConnectingGmail(true);
    try {
      const data = await startGmailOAuth();
      if (data.auth_url) {
        window.location.href = data.auth_url;
      }
    } catch (err: any) {
      setOauthBanner({
        type: "error",
        msg: err.message || "Failed to start Gmail connection",
      });
      setConnectingGmail(false);
    }
  };

  const handleSync = async () => {
    setSyncing(true);
    setSyncResult(null);
    try {
      const result = await triggerEmailSync();
      setSyncResult(result.message || "Sync complete");
      loadEmailStatus();
    } catch (err: any) {
      setSyncResult(err.message || "Sync failed");
    } finally {
      setSyncing(false);
      setTimeout(() => setSyncResult(null), 5000);
    }
  };

  const handleDisconnect = async (connectionId: number) => {
    setDisconnecting(connectionId);
    try {
      await disconnectEmail(connectionId);
      setOauthBanner({ type: "success", msg: "Gmail disconnected" });
      loadEmailStatus();
    } catch (err: any) {
      setOauthBanner({
        type: "error",
        msg: err.message || "Failed to disconnect",
      });
    } finally {
      setDisconnecting(null);
    }
  };

  const handleToggle = (key: keyof typeof settings) => {
    setSettings((prev) => ({
      ...prev,
      [key]: !prev[key],
    }));
  };

  const SettingItem = ({
    label,
    description,
    enabled,
    onChange,
  }: {
    label: string;
    description: string;
    enabled: boolean;
    onChange: () => void;
  }) => (
    <div className="card p-6 flex items-center justify-between">
      <div>
        <h3 className="font-semibold text-text1 mb-1">{label}</h3>
        <p className="text-sm text-text3">{description}</p>
      </div>
      <button
        onClick={onChange}
        className={`w-12 h-6 rounded-full transition-all ${
          enabled ? "bg-green" : "bg-surface"
        }`}
      >
        <div
          className={`w-5 h-5 rounded-full bg-bg transition-all ${
            enabled ? "translate-x-6" : "translate-x-0.5"
          }`}
        ></div>
      </button>
    </div>
  );

  const hasActiveConnection =
    emailStatus?.active_connections && emailStatus.active_connections > 0;

  return (
    <div className="p-8 space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-3xl font-semibold mb-2">Settings</h1>
        <p className="text-text2">Manage your account and preferences</p>
      </div>

      {/* OAuth Banner */}
      {oauthBanner && (
        <div
          className={`card p-4 flex items-center gap-3 ${
            oauthBanner.type === "success"
              ? "bg-green-dim border-green-bdr"
              : "bg-red-dim border-red-bdr"
          }`}
        >
          {oauthBanner.type === "success" ? (
            <CheckCircle className="text-green flex-shrink-0" size={18} />
          ) : (
            <AlertTriangle className="text-red flex-shrink-0" size={18} />
          )}
          <span className="text-sm">{oauthBanner.msg}</span>
          <button
            onClick={() => setOauthBanner(null)}
            className="ml-auto text-text3 hover:text-text1 text-sm"
          >
            Dismiss
          </button>
        </div>
      )}

      {/* Email Integration Section */}
      <div className="space-y-3">
        <h2 className="label">Email Integration</h2>

        {/* Gmail Connection Card */}
        <div className="card p-6">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-4">
              <div className="w-10 h-10 rounded-lg bg-surface flex items-center justify-center">
                <Mail
                  size={20}
                  className={hasActiveConnection ? "text-green" : "text-text3"}
                />
              </div>
              <div>
                <h3 className="font-semibold text-text1 mb-0.5">
                  Gmail Connection
                </h3>
                {hasActiveConnection ? (
                  <p className="text-sm text-green">Connected and active</p>
                ) : (
                  <p className="text-sm text-text3">
                    Connect your Gmail to auto-sync EPO emails
                  </p>
                )}
              </div>
            </div>

            <div className="flex items-center gap-3">
              {hasActiveConnection && (
                <>
                  {syncResult && (
                    <span className="text-xs text-text2">{syncResult}</span>
                  )}
                  <button
                    onClick={handleSync}
                    disabled={syncing}
                    className="btn-secondary text-sm flex items-center gap-2"
                  >
                    {syncing ? (
                      <Loader2 size={14} className="animate-spin" />
                    ) : (
                      <RefreshCw size={14} />
                    )}
                    {syncing ? "Syncing..." : "Sync Now"}
                  </button>
                </>
              )}
              {!hasActiveConnection && (
                <button
                  onClick={handleConnectGmail}
                  disabled={connectingGmail}
                  className="btn-primary text-sm flex items-center gap-2"
                >
                  {connectingGmail ? (
                    <Loader2 size={14} className="animate-spin" />
                  ) : (
                    <ExternalLink size={14} />
                  )}
                  {connectingGmail ? "Connecting..." : "Connect Gmail"}
                </button>
              )}
            </div>
          </div>

          {/* Connection details */}
          {emailStatus?.connections?.length > 0 && (
            <div className="mt-4 pt-4 border-t border-card-border">
              <p className="label mb-3">Active Connections</p>
              <div className="space-y-2">
                {emailStatus.connections.map((conn: any) => (
                  <div
                    key={conn.id}
                    className="flex items-center justify-between py-2"
                  >
                    <div className="flex items-center gap-3">
                      <div
                        className={`w-2 h-2 rounded-full ${
                          conn.is_active ? "bg-green" : "bg-red"
                        }`}
                      />
                      <span className="text-sm">{conn.email_address}</span>
                      <span className="text-xs text-text3 capitalize">
                        {conn.provider}
                      </span>
                    </div>
                    <div className="flex items-center gap-3">
                      {conn.last_sync_at && (
                        <span className="text-xs text-text3 font-mono">
                          Last sync:{" "}
                          {new Date(conn.last_sync_at).toLocaleString()}
                        </span>
                      )}
                      <button
                        onClick={() => handleDisconnect(conn.id)}
                        disabled={disconnecting === conn.id}
                        className="text-xs text-red hover:text-red/80 flex items-center gap-1"
                      >
                        {disconnecting === conn.id ? (
                          <Loader2 size={12} className="animate-spin" />
                        ) : null}
                        Disconnect
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Outlook / Other (Coming Soon) */}
        <div className="card p-6 opacity-50">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-4">
              <div className="w-10 h-10 rounded-lg bg-surface flex items-center justify-center">
                <Mail size={20} className="text-text3" />
              </div>
              <div>
                <h3 className="font-semibold text-text1 mb-0.5">
                  Outlook / Office 365
                </h3>
                <p className="text-sm text-text3">Coming soon</p>
              </div>
            </div>
            <span className="text-xs text-text3 bg-surface px-3 py-1 rounded-full">
              Coming Soon
            </span>
          </div>
        </div>
      </div>

      {/* Account Section */}
      <div className="space-y-3">
        <h2 className="label">Account</h2>
        <div className="card p-6 flex items-center justify-between cursor-pointer hover:bg-surface/50">
          <div>
            <h3 className="font-semibold text-text1 mb-1">Profile</h3>
            <p className="text-sm text-text3">Update your name and avatar</p>
          </div>
          <ChevronRight className="text-text3" size={20} />
        </div>
        <div className="card p-6 flex items-center justify-between cursor-pointer hover:bg-surface/50">
          <div>
            <h3 className="font-semibold text-text1 mb-1">Company</h3>
            <p className="text-sm text-text3">
              Manage company information
            </p>
          </div>
          <ChevronRight className="text-text3" size={20} />
        </div>
        <div className="card p-6 flex items-center justify-between cursor-pointer hover:bg-surface/50">
          <div>
            <h3 className="font-semibold text-text1 mb-1">Team Members</h3>
            <p className="text-sm text-text3">
              Invite and manage team access
            </p>
          </div>
          <ChevronRight className="text-text3" size={20} />
        </div>
      </div>

      {/* Notifications Section */}
      <div className="space-y-3">
        <h2 className="label">Notifications</h2>
        <SettingItem
          label="Email Notifications"
          description="Receive notifications via email"
          enabled={settings.emailNotifications}
          onChange={() => handleToggle("emailNotifications")}
        />
        <SettingItem
          label="Slack Notifications"
          description="Send alerts to your Slack workspace"
          enabled={settings.slackNotifications}
          onChange={() => handleToggle("slackNotifications")}
        />
        <SettingItem
          label="Daily Digest"
          description="Get a summary of today's activity"
          enabled={settings.dailyDigest}
          onChange={() => handleToggle("dailyDigest")}
        />
        <SettingItem
          label="Follow-Up Reminders"
          description="Be reminded about pending EPOs"
          enabled={settings.followUpReminders}
          onChange={() => handleToggle("followUpReminders")}
        />
      </div>

      {/* Billing Section */}
      <div className="space-y-3">
        <h2 className="label">Billing</h2>
        <div className="card p-6 flex items-center justify-between cursor-pointer hover:bg-surface/50">
          <div>
            <h3 className="font-semibold text-text1 mb-1">Subscription</h3>
            <p className="text-sm text-text3">
              Professional - Renews on May 3, 2026
            </p>
          </div>
          <ChevronRight className="text-text3" size={20} />
        </div>
        <div className="card p-6 flex items-center justify-between cursor-pointer hover:bg-surface/50">
          <div>
            <h3 className="font-semibold text-text1 mb-1">Billing History</h3>
            <p className="text-sm text-text3">View invoices and receipts</p>
          </div>
          <ChevronRight className="text-text3" size={20} />
        </div>
      </div>

      {/* Danger Zone */}
      <div className="space-y-3">
        <h2 className="label">Danger Zone</h2>
        <div className="card p-6 border-red-bdr bg-red-dim flex items-center justify-between cursor-pointer hover:bg-red-dim/80">
          <div>
            <h3 className="font-semibold text-red mb-1">Delete Account</h3>
            <p className="text-sm text-text3">
              Permanently delete your account and all data
            </p>
          </div>
          <ChevronRight className="text-red" size={20} />
        </div>
      </div>
    </div>
  );
}
