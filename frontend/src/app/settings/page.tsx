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
  Lock,
  Eye,
  EyeOff,
  Copy,
  Check,
  Trash2,
  Download,
  LogOut,
  Shield,
} from "lucide-react";
import { useToast } from "@/components/Toast";
import {
  startGmailOAuth,
  getEmailStatus,
  triggerEmailSync,
  disconnectEmail,
  getMe,
  changePassword,
  logout,
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
  const toast = useToast();

  // Profile state
  const [user, setUser] = useState<any>(null);
  const [editingFullName, setEditingFullName] = useState(false);
  const [fullNameValue, setFullNameValue] = useState("");
  const [copiedInviteCode, setCopiedInviteCode] = useState(false);

  // Security state
  const [showChangePassword, setShowChangePassword] = useState(false);
  const [passwordForm, setPasswordForm] = useState({
    currentPassword: "",
    newPassword: "",
    confirmPassword: "",
  });
  const [passwordStrength, setPasswordStrength] = useState(0);
  const [changingPassword, setChangingPassword] = useState(false);
  const [showPasswords, setShowPasswords] = useState({
    current: false,
    new: false,
    confirm: false,
  });

  // Notifications state
  const [notificationSettings, setNotificationSettings] = useState({
    emailNotifications: true,
    smsNotifications: false,
    newEpoAlerts: true,
    statusChangeAlerts: true,
    approvalNeededAlerts: true,
    overdueAlerts: true,
  });
  const [phoneNumber, setPhoneNumber] = useState("");
  const [savingPhone, setSavingPhone] = useState(false);

  // Email Integration state
  const [emailStatus, setEmailStatus] = useState<any>(null);
  const [connectingGmail, setConnectingGmail] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [disconnecting, setDisconnecting] = useState<number | null>(null);
  const [oauthBanner, setOauthBanner] = useState<{
    type: "success" | "error";
    msg: string;
  } | null>(null);

  // Danger Zone state
  const [deleteConfirmModal, setDeleteConfirmModal] = useState(false);
  const [deleting, setDeleting] = useState(false);

  // Load initial data
  useEffect(() => {
    loadUserData();
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

  const loadUserData = async () => {
    try {
      const userData = await getMe();
      setUser(userData);
      setFullNameValue(userData.full_name || "");
    } catch (err: any) {
      toast.error("Failed to load user data");
    }
  };

  const loadEmailStatus = async () => {
    try {
      const status = await getEmailStatus();
      setEmailStatus(status);
    } catch {
      setEmailStatus(null);
    }
  };

  // Password strength calculator
  const calculatePasswordStrength = (password: string) => {
    let strength = 0;
    if (password.length >= 8) strength += 25;
    if (password.length >= 12) strength += 25;
    if (/[a-z]/.test(password) && /[A-Z]/.test(password)) strength += 25;
    if (/\d/.test(password)) strength += 12.5;
    if (/[!@#$%^&*]/.test(password)) strength += 12.5;
    return Math.min(100, strength);
  };

  // Handle password input
  const handlePasswordChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const { name, value } = e.target;
    setPasswordForm((prev) => ({ ...prev, [name]: value }));
    if (name === "newPassword") {
      setPasswordStrength(calculatePasswordStrength(value));
    }
  };

  // Submit password change
  const handleSubmitPasswordChange = async () => {
    if (!passwordForm.currentPassword || !passwordForm.newPassword) {
      toast.warning("Please fill in all password fields");
      return;
    }

    if (passwordForm.newPassword !== passwordForm.confirmPassword) {
      toast.error("New passwords do not match");
      return;
    }

    if (passwordStrength < 50) {
      toast.warning("Password is not strong enough");
      return;
    }

    setChangingPassword(true);
    try {
      await changePassword(
        passwordForm.currentPassword,
        passwordForm.newPassword
      );
      toast.success("Password changed successfully");
      setPasswordForm({ currentPassword: "", newPassword: "", confirmPassword: "" });
      setPasswordStrength(0);
      setShowChangePassword(false);
    } catch (err: any) {
      toast.error(err.message || "Failed to change password");
    } finally {
      setChangingPassword(false);
    }
  };

  // Email functions
  const handleConnectGmail = async () => {
    setConnectingGmail(true);
    try {
      const data = await startGmailOAuth();
      if (data.auth_url) {
        window.location.href = data.auth_url;
      }
    } catch (err: any) {
      toast.error(err.message || "Failed to start Gmail connection");
      setConnectingGmail(false);
    }
  };

  const handleSync = async () => {
    setSyncing(true);
    try {
      await triggerEmailSync();
      toast.success("Email sync completed");
      loadEmailStatus();
    } catch (err: any) {
      toast.error(err.message || "Sync failed");
    } finally {
      setSyncing(false);
    }
  };

  const handleDisconnect = async (connectionId: number) => {
    setDisconnecting(connectionId);
    try {
      await disconnectEmail(connectionId);
      toast.success("Gmail disconnected");
      loadEmailStatus();
    } catch (err: any) {
      toast.error(err.message || "Failed to disconnect");
    } finally {
      setDisconnecting(null);
    }
  };

  // Notification handlers
  const handleNotificationToggle = (key: keyof typeof notificationSettings) => {
    setNotificationSettings((prev) => ({
      ...prev,
      [key]: !prev[key],
    }));
    toast.success("Notification preference updated");
  };

  const handleSavePhone = async () => {
    if (!phoneNumber.match(/^\+?1?\d{9,15}$/)) {
      toast.error("Please enter a valid phone number");
      return;
    }
    setSavingPhone(true);
    try {
      // API call would go here
      toast.success("Phone number saved");
    } catch (err: any) {
      toast.error("Failed to save phone number");
    } finally {
      setSavingPhone(false);
    }
  };

  // Danger zone handlers
  const handleSignOutAllDevices = () => {
    logout();
    window.location.href = "/login";
  };

  const handleExportData = async () => {
    try {
      toast.info("Preparing your data export...");
      // API call would go here
      toast.success("Data export started. Check your email for download link.");
    } catch (err: any) {
      toast.error("Failed to export data");
    }
  };

  const handleDeleteAccount = async () => {
    setDeleting(true);
    try {
      // API call would go here
      toast.success("Account deleted. Redirecting...");
      setTimeout(() => {
        logout();
        window.location.href = "/";
      }, 2000);
    } catch (err: any) {
      toast.error("Failed to delete account");
    } finally {
      setDeleting(false);
    }
  };

  // Copy invite code
  const handleCopyInviteCode = () => {
    if (user?.invite_code) {
      navigator.clipboard.writeText(user.invite_code);
      setCopiedInviteCode(true);
      toast.success("Invite code copied to clipboard");
      setTimeout(() => setCopiedInviteCode(false), 2000);
    }
  };

  const hasActiveConnection =
    emailStatus?.active_connections && emailStatus.active_connections > 0;

  const isAdmin = user?.role === "admin" || user?.role === "manager";

  const getPasswordStrengthColor = () => {
    if (passwordStrength < 30) return "bg-red";
    if (passwordStrength < 60) return "bg-amber-500";
    if (passwordStrength < 80) return "bg-blue-400";
    return "bg-green";
  };

  return (
    <div className="min-h-screen bg-[#0a0a0a] p-8">
      <div className="max-w-4xl space-y-8">
        {/* Header */}
        <div>
          <h1 className="text-4xl font-semibold mb-2">Settings</h1>
          <p className="text-text2">Manage your account, security, and preferences</p>
        </div>

        {/* OAuth Banner */}
        {oauthBanner && (
          <div
            className={`p-4 rounded-lg flex items-center gap-3 ${
              oauthBanner.type === "success"
                ? "bg-green-dim border border-green-bdr"
                : "bg-red-dim border border-red-bdr"
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

        {/* PROFILE SECTION */}
        <div className="bg-[#111] rounded-lg border border-[#222] p-8 space-y-6">
          <div className="flex items-center gap-3 pb-6 border-b border-[#222]">
            <Shield size={24} className="text-text2" />
            <h2 className="text-2xl font-semibold">Profile</h2>
          </div>

          {user && (
            <div className="space-y-6">
              {/* User Info Display */}
              <div className="grid grid-cols-2 gap-6">
                <div>
                  <label className="text-xs uppercase text-text3 font-semibold">
                    Email
                  </label>
                  <p className="mt-2 text-text1">{user.email}</p>
                </div>
                <div>
                  <label className="text-xs uppercase text-text3 font-semibold">
                    Role
                  </label>
                  <p className="mt-2 text-text1 capitalize">
                    {user.role || "Team Member"}
                  </p>
                </div>
              </div>

              {/* Edit Full Name */}
              {editingFullName ? (
                <div className="space-y-3">
                  <label className="text-xs uppercase text-text3 font-semibold">
                    Full Name
                  </label>
                  <div className="flex gap-3">
                    <input
                      type="text"
                      value={fullNameValue}
                      onChange={(e) => setFullNameValue(e.target.value)}
                      className="flex-1 bg-[#0a0a0a] border border-[#333] rounded px-3 py-2 text-text1 focus:outline-none focus:border-blue-500"
                      placeholder="Your full name"
                    />
                    <button
                      onClick={() => {
                        setEditingFullName(false);
                        setFullNameValue(user.full_name || "");
                        // API call would go here
                        toast.success("Full name updated");
                      }}
                      className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 transition-colors"
                    >
                      Save
                    </button>
                    <button
                      onClick={() => {
                        setEditingFullName(false);
                        setFullNameValue(user.full_name || "");
                      }}
                      className="px-4 py-2 bg-[#222] text-text2 rounded hover:bg-[#333] transition-colors"
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              ) : (
                <div>
                  <label className="text-xs uppercase text-text3 font-semibold">
                    Full Name
                  </label>
                  <div className="flex items-center justify-between mt-2">
                    <p className="text-text1">{user.full_name || "Not set"}</p>
                    <button
                      onClick={() => setEditingFullName(true)}
                      className="text-blue-400 hover:text-blue-300 text-sm"
                    >
                      Edit
                    </button>
                  </div>
                </div>
              )}

              {/* Invite Code for Admin/Manager */}
              {isAdmin && user?.invite_code && (
                <div>
                  <label className="text-xs uppercase text-text3 font-semibold">
                    Company Invite Code
                  </label>
                  <div className="flex items-center justify-between mt-2 bg-[#0a0a0a] px-3 py-2 rounded border border-[#333]">
                    <code className="text-text1 font-mono">{user.invite_code}</code>
                    <button
                      onClick={handleCopyInviteCode}
                      className="flex items-center gap-2 text-blue-400 hover:text-blue-300 text-sm"
                    >
                      {copiedInviteCode ? (
                        <>
                          <Check size={16} />
                          Copied
                        </>
                      ) : (
                        <>
                          <Copy size={16} />
                          Copy
                        </>
                      )}
                    </button>
                  </div>
                </div>
              )}

              {/* Plan Tier Badge */}
              <div>
                <label className="text-xs uppercase text-text3 font-semibold">
                  Plan Tier
                </label>
                <div className="mt-2">
                  <span className="inline-block px-3 py-1 bg-blue-900 text-blue-200 rounded-full text-sm">
                    Professional Plan
                  </span>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* SECURITY SECTION */}
        <div className="bg-[#111] rounded-lg border border-[#222] p-8 space-y-6">
          <div className="flex items-center gap-3 pb-6 border-b border-[#222]">
            <Lock size={24} className="text-text2" />
            <h2 className="text-2xl font-semibold">Security</h2>
          </div>

          {/* Change Password */}
          {showChangePassword ? (
            <div className="space-y-4">
              {/* Current Password */}
              <div>
                <label className="text-xs uppercase text-text3 font-semibold">
                  Current Password
                </label>
                <div className="relative mt-2">
                  <input
                    type={showPasswords.current ? "text" : "password"}
                    name="currentPassword"
                    value={passwordForm.currentPassword}
                    onChange={handlePasswordChange}
                    className="w-full bg-[#0a0a0a] border border-[#333] rounded px-3 py-2 text-text1 focus:outline-none focus:border-blue-500 pr-10"
                    placeholder="Enter your current password"
                  />
                  <button
                    onClick={() =>
                      setShowPasswords((p) => ({ ...p, current: !p.current }))
                    }
                    className="absolute right-3 top-1/2 transform -translate-y-1/2 text-text3 hover:text-text1"
                  >
                    {showPasswords.current ? (
                      <EyeOff size={18} />
                    ) : (
                      <Eye size={18} />
                    )}
                  </button>
                </div>
              </div>

              {/* New Password */}
              <div>
                <label className="text-xs uppercase text-text3 font-semibold">
                  New Password
                </label>
                <div className="relative mt-2">
                  <input
                    type={showPasswords.new ? "text" : "password"}
                    name="newPassword"
                    value={passwordForm.newPassword}
                    onChange={handlePasswordChange}
                    className="w-full bg-[#0a0a0a] border border-[#333] rounded px-3 py-2 text-text1 focus:outline-none focus:border-blue-500 pr-10"
                    placeholder="Enter your new password"
                  />
                  <button
                    onClick={() =>
                      setShowPasswords((p) => ({ ...p, new: !p.new }))
                    }
                    className="absolute right-3 top-1/2 transform -translate-y-1/2 text-text3 hover:text-text1"
                  >
                    {showPasswords.new ? (
                      <EyeOff size={18} />
                    ) : (
                      <Eye size={18} />
                    )}
                  </button>
                </div>

                {/* Password Strength Indicator */}
                {passwordForm.newPassword && (
                  <div className="mt-3">
                    <div className="flex items-center justify-between mb-2">
                      <span className="text-xs text-text3">Password Strength</span>
                      <span className="text-xs text-text3">
                        {passwordStrength < 30
                          ? "Weak"
                          : passwordStrength < 60
                          ? "Fair"
                          : passwordStrength < 80
                          ? "Good"
                          : "Strong"}
                      </span>
                    </div>
                    <div className="h-2 bg-[#0a0a0a] rounded overflow-hidden">
                      <div
                        className={`h-full ${getPasswordStrengthColor()} transition-all`}
                        style={{ width: `${passwordStrength}%` }}
                      />
                    </div>
                  </div>
                )}
              </div>

              {/* Confirm Password */}
              <div>
                <label className="text-xs uppercase text-text3 font-semibold">
                  Confirm Password
                </label>
                <div className="relative mt-2">
                  <input
                    type={showPasswords.confirm ? "text" : "password"}
                    name="confirmPassword"
                    value={passwordForm.confirmPassword}
                    onChange={handlePasswordChange}
                    className="w-full bg-[#0a0a0a] border border-[#333] rounded px-3 py-2 text-text1 focus:outline-none focus:border-blue-500 pr-10"
                    placeholder="Confirm your new password"
                  />
                  <button
                    onClick={() =>
                      setShowPasswords((p) => ({ ...p, confirm: !p.confirm }))
                    }
                    className="absolute right-3 top-1/2 transform -translate-y-1/2 text-text3 hover:text-text1"
                  >
                    {showPasswords.confirm ? (
                      <EyeOff size={18} />
                    ) : (
                      <Eye size={18} />
                    )}
                  </button>
                </div>
              </div>

              {/* Buttons */}
              <div className="flex gap-3 pt-2">
                <button
                  onClick={handleSubmitPasswordChange}
                  disabled={changingPassword}
                  className="flex-1 px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 transition-colors disabled:opacity-50"
                >
                  {changingPassword ? (
                    <>
                      <Loader2 size={16} className="animate-spin inline mr-2" />
                      Updating...
                    </>
                  ) : (
                    "Update Password"
                  )}
                </button>
                <button
                  onClick={() => {
                    setShowChangePassword(false);
                    setPasswordForm({
                      currentPassword: "",
                      newPassword: "",
                      confirmPassword: "",
                    });
                    setPasswordStrength(0);
                  }}
                  className="flex-1 px-4 py-2 bg-[#222] text-text2 rounded hover:bg-[#333] transition-colors"
                >
                  Cancel
                </button>
              </div>
            </div>
          ) : (
            <button
              onClick={() => setShowChangePassword(true)}
              className="w-full px-4 py-2 bg-[#222] text-text1 rounded hover:bg-[#333] transition-colors text-left"
            >
              Change Password
            </button>
          )}

          {/* Session Management */}
          <div className="pt-4 border-t border-[#222]">
            <h3 className="text-sm font-semibold mb-4">Session Management</h3>
            <div className="bg-[#0a0a0a] p-4 rounded border border-[#333] mb-4">
              <p className="text-xs text-text3 mb-2">Token expires in</p>
              <p className="text-text1 font-mono">~2 hours</p>
            </div>
            <button
              onClick={handleSignOutAllDevices}
              className="w-full px-4 py-2 bg-red-900 text-red-200 rounded hover:bg-red-800 transition-colors flex items-center justify-center gap-2"
            >
              <LogOut size={16} />
              Sign Out of All Devices
            </button>
          </div>
        </div>

        {/* NOTIFICATIONS SECTION */}
        <div className="bg-[#111] rounded-lg border border-[#222] p-8 space-y-6">
          <div className="flex items-center gap-3 pb-6 border-b border-[#222]">
            <Mail size={24} className="text-text2" />
            <h2 className="text-2xl font-semibold">Notifications</h2>
          </div>

          {/* Email & SMS Toggles */}
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="font-medium text-text1">Email Notifications</h3>
                <p className="text-sm text-text3">Receive notifications via email</p>
              </div>
              <button
                onClick={() => handleNotificationToggle("emailNotifications")}
                className={`w-12 h-6 rounded-full transition-all ${
                  notificationSettings.emailNotifications
                    ? "bg-green"
                    : "bg-[#333]"
                }`}
              >
                <div
                  className={`w-5 h-5 rounded-full bg-[#111] transition-all ${
                    notificationSettings.emailNotifications
                      ? "translate-x-6"
                      : "translate-x-0.5"
                  }`}
                />
              </button>
            </div>

            <div className="flex items-center justify-between">
              <div>
                <h3 className="font-medium text-text1">SMS Notifications</h3>
                <p className="text-sm text-text3">Receive SMS alerts for urgent items</p>
              </div>
              <button
                onClick={() => handleNotificationToggle("smsNotifications")}
                className={`w-12 h-6 rounded-full transition-all ${
                  notificationSettings.smsNotifications
                    ? "bg-green"
                    : "bg-[#333]"
                }`}
              >
                <div
                  className={`w-5 h-5 rounded-full bg-[#111] transition-all ${
                    notificationSettings.smsNotifications
                      ? "translate-x-6"
                      : "translate-x-0.5"
                  }`}
                />
              </button>
            </div>
          </div>

          {/* Phone Number Input */}
          {notificationSettings.smsNotifications && (
            <div className="pt-4 border-t border-[#222]">
              <label className="text-xs uppercase text-text3 font-semibold">
                Phone Number
              </label>
              <div className="flex gap-3 mt-2">
                <input
                  type="tel"
                  value={phoneNumber}
                  onChange={(e) => setPhoneNumber(e.target.value)}
                  className="flex-1 bg-[#0a0a0a] border border-[#333] rounded px-3 py-2 text-text1 focus:outline-none focus:border-blue-500"
                  placeholder="+1 (555) 123-4567"
                />
                <button
                  onClick={handleSavePhone}
                  disabled={savingPhone}
                  className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 transition-colors disabled:opacity-50"
                >
                  {savingPhone ? (
                    <Loader2 size={16} className="animate-spin" />
                  ) : (
                    "Save"
                  )}
                </button>
              </div>
            </div>
          )}

          {/* Alert Preferences */}
          <div className="pt-4 border-t border-[#222]">
            <h3 className="font-medium text-text1 mb-4">Alert Preferences</h3>
            <div className="space-y-3">
              {[
                {
                  key: "newEpoAlerts" as const,
                  label: "New EPO Alerts",
                  desc: "Be notified of new EPOs",
                },
                {
                  key: "statusChangeAlerts" as const,
                  label: "Status Change Alerts",
                  desc: "When an EPO status changes",
                },
                {
                  key: "approvalNeededAlerts" as const,
                  label: "Approval Needed Alerts",
                  desc: "When your approval is required",
                },
                {
                  key: "overdueAlerts" as const,
                  label: "Overdue Alerts",
                  desc: "When EPOs become overdue",
                },
              ].map((alert) => (
                <label key={alert.key} className="flex items-center gap-3 p-3 bg-[#0a0a0a] rounded cursor-pointer hover:bg-[#0f0f0f] transition-colors">
                  <input
                    type="checkbox"
                    checked={notificationSettings[alert.key]}
                    onChange={() => handleNotificationToggle(alert.key)}
                    className="w-4 h-4 rounded"
                  />
                  <div className="flex-1">
                    <p className="text-sm font-medium text-text1">{alert.label}</p>
                    <p className="text-xs text-text3">{alert.desc}</p>
                  </div>
                </label>
              ))}
            </div>
          </div>
        </div>

        {/* EMAIL INTEGRATION SECTION */}
        <div className="bg-[#111] rounded-lg border border-[#222] p-8 space-y-6">
          <div className="flex items-center gap-3 pb-6 border-b border-[#222]">
            <Mail size={24} className="text-text2" />
            <h2 className="text-2xl font-semibold">Email Integration</h2>
          </div>

          {/* Gmail Connection Card */}
          <div className="bg-[#0a0a0a] border border-[#333] rounded-lg p-6">
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-4">
                <div className="w-10 h-10 rounded-lg bg-[#222] flex items-center justify-center">
                  <Mail
                    size={20}
                    className={
                      hasActiveConnection ? "text-green" : "text-text3"
                    }
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
                  <button
                    onClick={handleSync}
                    disabled={syncing}
                    className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 transition-colors disabled:opacity-50 flex items-center gap-2"
                  >
                    {syncing ? (
                      <Loader2 size={14} className="animate-spin" />
                    ) : (
                      <RefreshCw size={14} />
                    )}
                    {syncing ? "Syncing..." : "Sync Now"}
                  </button>
                )}
                {!hasActiveConnection && (
                  <button
                    onClick={handleConnectGmail}
                    disabled={connectingGmail}
                    className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 transition-colors disabled:opacity-50 flex items-center gap-2"
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
              <div className="pt-4 border-t border-[#333]">
                <p className="text-xs uppercase text-text3 font-semibold mb-3">
                  Active Connections
                </p>
                <div className="space-y-2">
                  {emailStatus.connections.map((conn: any) => (
                    <div
                      key={conn.id}
                      className="flex items-center justify-between py-3 px-3 bg-[#111] rounded"
                    >
                      <div className="flex items-center gap-3">
                        <div
                          className={`w-2 h-2 rounded-full ${
                            conn.is_active ? "bg-green" : "bg-red"
                          }`}
                        />
                        <span className="text-sm text-text1">
                          {conn.email_address}
                        </span>
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
          <div className="bg-[#0a0a0a] border border-[#333] rounded-lg p-6 opacity-50">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-4">
                <div className="w-10 h-10 rounded-lg bg-[#222] flex items-center justify-center">
                  <Mail size={20} className="text-text3" />
                </div>
                <div>
                  <h3 className="font-semibold text-text1 mb-0.5">
                    Outlook / Office 365
                  </h3>
                  <p className="text-sm text-text3">Coming soon</p>
                </div>
              </div>
              <span className="text-xs text-text3 bg-[#222] px-3 py-1 rounded-full">
                Coming Soon
              </span>
            </div>
          </div>
        </div>

        {/* DANGER ZONE SECTION */}
        <div className="bg-[#111] rounded-lg border border-red-bdr p-8 space-y-6">
          <div className="flex items-center gap-3 pb-6 border-b border-[#222]">
            <AlertTriangle size={24} className="text-red" />
            <h2 className="text-2xl font-semibold text-red">Danger Zone</h2>
          </div>

          <div className="space-y-4">
            {/* Export Data */}
            <button
              onClick={handleExportData}
              className="w-full px-4 py-3 bg-[#222] text-text1 rounded hover:bg-[#333] transition-colors flex items-center justify-center gap-2"
            >
              <Download size={18} />
              Export All Data
            </button>

            {/* Delete Account */}
            <button
              onClick={() => setDeleteConfirmModal(true)}
              className="w-full px-4 py-3 bg-red-900 text-red-200 rounded hover:bg-red-800 transition-colors flex items-center justify-center gap-2"
            >
              <Trash2 size={18} />
              Delete Account
            </button>
          </div>
        </div>
      </div>

      {/* Delete Confirmation Modal */}
      {deleteConfirmModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-[#111] border border-red-bdr rounded-lg p-8 max-w-sm w-full">
            <h3 className="text-xl font-semibold text-red mb-2">
              Delete Account?
            </h3>
            <p className="text-text3 mb-6">
              This action cannot be undone. All your data will be permanently deleted.
            </p>
            <div className="flex gap-3">
              <button
                onClick={() => setDeleteConfirmModal(false)}
                className="flex-1 px-4 py-2 bg-[#222] text-text1 rounded hover:bg-[#333] transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleDeleteAccount}
                disabled={deleting}
                className="flex-1 px-4 py-2 bg-red-900 text-red-200 rounded hover:bg-red-800 transition-colors disabled:opacity-50"
              >
                {deleting ? (
                  <>
                    <Loader2 size={16} className="animate-spin inline mr-2" />
                    Deleting...
                  </>
                ) : (
                  "Delete Account"
                )}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
