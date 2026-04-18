"use client";

import { useState, useEffect } from "react";
import {
  Mail,
  Sheet,
  Zap,
  ExternalLink,
  RefreshCw,
  Loader2,
  Unplug,
  CheckCircle,
  AlertTriangle,
} from "lucide-react";
import {
  startGmailOAuth,
  getEmailStatus,
  triggerEmailSync,
  disconnectEmail,
} from "@/lib/api";

export default function IntegrationsPage() {
  const [emailStatus, setEmailStatus] = useState<any>(null);
  const [connectingGmail, setConnectingGmail] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [disconnecting, setDisconnecting] = useState<number | null>(null);
  const [banner, setBanner] = useState<{
    type: "success" | "error";
    msg: string;
  } | null>(null);

  useEffect(() => {
    loadEmailStatus();

    // Check URL params for OAuth result
    const params = new URLSearchParams(window.location.search);
    if (params.get("success") === "gmail_connected") {
      setBanner({ type: "success", msg: "Gmail connected successfully!" });
      loadEmailStatus();
    } else if (params.get("error")) {
      setBanner({
        type: "error",
        msg: `Connection failed: ${params.get("error")?.replace(/_/g, " ")}`,
      });
    }
  }, []);

  const loadEmailStatus = async () => {
    try {
      const status = await getEmailStatus();
      setEmailStatus(status);
    } catch {
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
      setBanner({
        type: "error",
        msg: err.message || "Failed to start Gmail connection",
      });
      setConnectingGmail(false);
    }
  };

  const handleSync = async () => {
    setSyncing(true);
    try {
      const result = await triggerEmailSync();
      setBanner({ type: "success", msg: result.message || "Sync complete" });
      loadEmailStatus();
    } catch (err: any) {
      setBanner({ type: "error", msg: err.message || "Sync failed" });
    } finally {
      setSyncing(false);
    }
  };

  const handleDisconnect = async (connectionId: number) => {
    setDisconnecting(connectionId);
    try {
      await disconnectEmail(connectionId);
      setBanner({ type: "success", msg: "Gmail disconnected" });
      loadEmailStatus();
    } catch (err: any) {
      setBanner({ type: "error", msg: err.message || "Disconnect failed" });
    } finally {
      setDisconnecting(null);
    }
  };

  // Show ALL Gmail connections for this company (active + inactive)
  const allGmailConnections = emailStatus?.connections?.filter(
    (c: any) => c.provider === "gmail"
  ) || [];
  const gmailConnections = allGmailConnections.filter((c: any) => c.is_active);
  const inactiveGmailConnections = allGmailConnections.filter((c: any) => !c.is_active);
  const gmailConnection = gmailConnections[0]; // primary for the card
  const hasGmail = gmailConnections.length > 0;
  const needsReconnect = inactiveGmailConnections.length > 0 && !hasGmail;

  const integrations = [
    {
      name: "Gmail",
      description: needsReconnect
        ? "Connection expired — reconnect to resume syncing"
        : "Sync EPOs directly from Gmail",
      icon: Mail,
      active: hasGmail,
      needsReconnect,
      connectionInfo: gmailConnection,
      comingSoon: false,
    },
    {
      name: "Google Sheets",
      description: "Export data to Google Sheets",
      icon: Sheet,
      active: false,
      comingSoon: true,
    },
    {
      name: "Outlook",
      description: "Sync EPOs from Outlook",
      icon: Mail,
      active: false,
      comingSoon: true,
    },
    {
      name: "QuickBooks",
      description: "Sync with QuickBooks Online",
      icon: Zap,
      active: false,
      comingSoon: true,
    },
  ];

  return (
    <div className="p-8 space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-3xl font-semibold mb-2">Integrations</h1>
        <p className="text-text2">
          Connect your tools to streamline EPO management
        </p>
      </div>

      {/* Banner */}
      {banner && (
        <div
          className={`card p-4 flex items-center gap-3 ${
            banner.type === "success"
              ? "bg-green-dim border-green-bdr"
              : "bg-red-dim border-red-bdr"
          }`}
        >
          {banner.type === "success" ? (
            <CheckCircle className="text-green flex-shrink-0" size={18} />
          ) : (
            <AlertTriangle className="text-red flex-shrink-0" size={18} />
          )}
          <span className="text-sm">{banner.msg}</span>
          <button
            onClick={() => setBanner(null)}
            className="ml-auto text-text3 hover:text-text1 text-sm"
          >
            Dismiss
          </button>
        </div>
      )}

      {/* Integration Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {integrations.map((integration) => {
          const Icon = integration.icon;
          const borderClass = integration.active
            ? "border-green-bdr"
            : (integration as any).needsReconnect
            ? "border-amber-bdr"
            : "border-card-border";
          const bgClass = integration.active
            ? "bg-green-dim"
            : (integration as any).needsReconnect
            ? "bg-amber-dim"
            : "";

          return (
            <div
              key={integration.name}
              className={`card p-6 ${bgClass} border-2 ${borderClass} flex flex-col`}
            >
              <div className="flex items-start justify-between mb-4">
                <div className="flex items-center gap-4">
                  <div className="w-12 h-12 rounded-lg bg-surface flex items-center justify-center">
                    <Icon
                      size={24}
                      className={
                        integration.active ? "text-green" : "text-text3"
                      }
                    />
                  </div>
                  <div>
                    <h3 className="font-semibold text-text1">
                      {integration.name}
                    </h3>
                    <p className="text-sm text-text3">
                      {integration.description}
                    </p>
                  </div>
                </div>
                {integration.active ? (
                  <div className="w-2 h-2 rounded-full bg-green flex-shrink-0 mt-2" />
                ) : (integration as any).needsReconnect ? (
                  <AlertTriangle size={16} className="text-amber flex-shrink-0 mt-1" />
                ) : null}
              </div>

              {/* Connection details for Gmail — show all team connections */}
              {integration.name === "Gmail" && gmailConnections.length > 0 && (
                <div className="mb-4 space-y-2">
                  {gmailConnections.map((conn: any) => (
                    <div key={conn.id} className="p-3 bg-surface rounded-lg flex items-center justify-between">
                      <div>
                        <p className="text-sm text-text1">{conn.email_address}</p>
                        {conn.last_sync_at && (
                          <p className="text-xs text-text3 font-mono">
                            Last synced: {new Date(conn.last_sync_at).toLocaleString()}
                          </p>
                        )}
                      </div>
                      <button
                        onClick={() => handleDisconnect(conn.id)}
                        disabled={disconnecting === conn.id}
                        className="text-xs text-red hover:bg-red-dim px-2 py-1 rounded flex items-center gap-1"
                      >
                        {disconnecting === conn.id ? (
                          <Loader2 size={12} className="animate-spin" />
                        ) : (
                          <Unplug size={12} />
                        )}
                      </button>
                    </div>
                  ))}
                </div>
              )}

              {/* Expired/inactive connections that need reconnect */}
              {integration.name === "Gmail" && inactiveGmailConnections.length > 0 && (
                <div className="mb-4 space-y-2">
                  {inactiveGmailConnections.map((conn: any) => (
                    <div key={conn.id} className="p-3 bg-surface rounded-lg flex items-center justify-between border border-amber-bdr">
                      <div>
                        <p className="text-sm text-text1">{conn.email_address}</p>
                        <p className="text-xs text-amber">
                          Expired — click &quot;Reconnect Gmail&quot; below
                        </p>
                      </div>
                      <button
                        onClick={() => handleDisconnect(conn.id)}
                        disabled={disconnecting === conn.id}
                        className="text-xs text-red hover:bg-red-dim px-2 py-1 rounded flex items-center gap-1"
                        title="Remove this connection"
                      >
                        {disconnecting === conn.id ? (
                          <Loader2 size={12} className="animate-spin" />
                        ) : (
                          <Unplug size={12} />
                        )}
                      </button>
                    </div>
                  ))}
                </div>
              )}

              <div className="mt-auto pt-4 border-t border-card-border">
                {integration.comingSoon ? (
                  <button
                    disabled
                    className="btn-secondary w-full text-center opacity-50"
                  >
                    Coming Soon
                  </button>
                ) : integration.name === "Gmail" ? (
                  <div className="flex gap-3">
                    {hasGmail && (
                      <button
                        onClick={handleSync}
                        disabled={syncing}
                        className="btn-secondary flex-1 text-center flex items-center justify-center gap-2"
                      >
                        {syncing ? (
                          <Loader2 size={14} className="animate-spin" />
                        ) : (
                          <RefreshCw size={14} />
                        )}
                        {syncing ? "Syncing..." : "Sync Now"}
                      </button>
                    )}
                    <button
                      onClick={handleConnectGmail}
                      disabled={connectingGmail}
                      className={`${hasGmail ? 'btn-secondary' : 'btn-primary'} flex-1 text-center flex items-center justify-center gap-2`}
                    >
                      {connectingGmail ? (
                        <Loader2 size={14} className="animate-spin" />
                      ) : (
                        <ExternalLink size={14} />
                      )}
                      {connectingGmail ? "Connecting..." : hasGmail ? "Add Another Gmail" : needsReconnect ? "Reconnect Gmail" : "Connect Gmail"}
                    </button>
                  </div>
                ) : (
                  <button className="btn-primary w-full text-center">
                    Connect
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
