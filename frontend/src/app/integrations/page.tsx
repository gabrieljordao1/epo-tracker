"use client";

import { Mail, Sheet, Lock, Zap } from "lucide-react";

export default function IntegrationsPage() {
  const integrations = [
    {
      name: "Gmail",
      description: "Sync EPOs directly from Gmail",
      icon: Mail,
      active: true,
      syncedAt: "3 minutes ago",
    },
    {
      name: "Google Sheets",
      description: "Export data to Google Sheets",
      icon: Sheet,
      active: true,
      syncedAt: "15 minutes ago",
    },
    {
      name: "Outlook",
      description: "Sync EPOs from Outlook",
      icon: Mail,
      active: false,
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
          Connect your favorite tools to streamline EPO management
        </p>
      </div>

      {/* Integration Grid */}
      <div className="grid grid-cols-2 gap-6">
        {integrations.map((integration) => {
          const Icon = integration.icon;
          const borderClass = integration.active
            ? "border-green-bdr"
            : "border-card-border";
          const bgClass = integration.active ? "bg-green-dim" : "";

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
                    <p className="text-sm text-text3">{integration.description}</p>
                  </div>
                </div>
                {integration.active && (
                  <div className="w-2 h-2 rounded-full bg-green flex-shrink-0"></div>
                )}
              </div>

              {integration.active && !integration.comingSoon && (
                <div className="mb-4 p-3 bg-surface rounded-lg">
                  <p className="text-xs text-text3">
                    <span className="font-mono">Last synced</span>: {integration.syncedAt}
                  </p>
                </div>
              )}

              <div className="mt-auto pt-4 border-t border-card-border">
                {integration.comingSoon ? (
                  <button disabled className="btn-secondary w-full text-center opacity-50">
                    Coming Soon
                  </button>
                ) : integration.active ? (
                  <button className="btn-secondary w-full text-center">
                    Configure
                  </button>
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
