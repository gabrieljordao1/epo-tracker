// ─── API Configuration ───────────────────────────
const API_BASE = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";

// ─── Token Management ────────────────────────────
let authToken: string | null = null;

export function setAuthToken(token: string | null) {
  authToken = token;
  if (token) {
    if (typeof window !== "undefined") localStorage.setItem("epo_token", token);
  } else {
    if (typeof window !== "undefined") localStorage.removeItem("epo_token");
  }
}

export function getAuthToken(): string | null {
  if (authToken) return authToken;
  if (typeof window !== "undefined") {
    authToken = localStorage.getItem("epo_token");
  }
  return authToken;
}

function authHeaders(): HeadersInit {
  const token = getAuthToken();
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (token) headers["Authorization"] = `Bearer ${token}`;
  return headers;
}

// ─── Types ───────────────────────────────────────
export interface EPO {
  id: number;
  vendor_name: string;
  vendor_email: string;
  community: string;
  lot_number: string;
  description: string;
  amount: number;
  status: "pending" | "confirmed" | "denied" | "discount";
  confirmation_number: string | null;
  days_open: number;
  needs_review: boolean;
  confidence_score: number;
  parse_model: string;
  synced_from_email: boolean;
  created_at: string;
}

export interface Stats {
  total: number;
  confirmed: number;
  pending: number;
  denied: number;
  discount: number;
  total_value: number;
  capture_rate: number;
  needs_followup: number;
  avg_amount: number;
}

export interface User {
  id: number;
  email: string;
  full_name: string;
  company_id: number;
  role: string;
  is_active: boolean;
}

export interface AuthResponse {
  access_token: string;
  token_type: string;
  user: User;
}

// ─── Auth API ────────────────────────────────────
export async function login(email: string, password: string): Promise<AuthResponse> {
  const res = await fetch(`${API_BASE}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: "Login failed" }));
    throw new Error(err.detail || "Login failed");
  }
  const data: AuthResponse = await res.json();
  setAuthToken(data.access_token);
  return data;
}

export async function register(
  email: string,
  password: string,
  fullName: string,
  companyName: string,
  industry: string,
): Promise<AuthResponse> {
  const res = await fetch(`${API_BASE}/api/auth/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      email,
      password,
      full_name: fullName,
      company_name: companyName,
      industry,
    }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: "Registration failed" }));
    throw new Error(err.detail || "Registration failed");
  }
  const data: AuthResponse = await res.json();
  setAuthToken(data.access_token);
  return data;
}

export async function getMe(): Promise<User> {
  const res = await fetch(`${API_BASE}/api/auth/me`, { headers: authHeaders() });
  if (!res.ok) throw new Error("Not authenticated");
  return res.json();
}

export function logout() {
  setAuthToken(null);
}

// ─── EPO API ─────────────────────────────────────
export async function getEPOs(status?: string, supervisorId?: number): Promise<EPO[]> {
  const token = getAuthToken();

  // If authenticated, use real API
  if (token) {
    try {
      const params = new URLSearchParams();
      if (status && status !== "all") params.set("status_filter", status);
      if (supervisorId) params.set("supervisor_id", supervisorId.toString());
      const qs = params.toString();
      const res = await fetch(`${API_BASE}/api/epos${qs ? `?${qs}` : ""}`, {
        headers: authHeaders(),
      });
      if (!res.ok) throw new Error("API error");
      const data = await res.json();
      return Array.isArray(data) ? data : data.epos || [];
    } catch {
      // Fall through to demo
    }
  }

  // Demo mode — use /api/demo endpoints (no auth)
  try {
    const params = new URLSearchParams();
    if (status && status !== "all") params.set("status", status);
    if (supervisorId) params.set("supervisor_id", supervisorId.toString());
    const qs = params.toString();
    const url = `${API_BASE}/api/demo/epos${qs ? `?${qs}` : ""}`;
    const response = await fetch(url);
    if (!response.ok) return getDemoEPOs();
    const data = await response.json();
    return data.epos || [];
  } catch {
    return getDemoEPOs();
  }
}

export async function getStats(supervisorId?: number): Promise<Stats> {
  const token = getAuthToken();

  if (token) {
    try {
      const res = await fetch(`${API_BASE}/api/epos/stats/dashboard`, {
        headers: authHeaders(),
      });
      if (!res.ok) throw new Error("API error");
      const data = await res.json();
      const s = data.stats || data;
      return {
        total: s.total_epos || s.total || 0,
        confirmed: s.confirmed_count || s.confirmed || 0,
        pending: s.pending_count || s.pending || 0,
        denied: s.denied_count || s.denied || 0,
        discount: s.discount_count || s.discount || 0,
        total_value: s.total_amount || s.total_value || 0,
        capture_rate: s.total_epos ? Math.round((s.confirmed_count / s.total_epos) * 100) : 0,
        needs_followup: s.needs_review_count || s.needs_followup || 0,
        avg_amount: s.average_amount || s.avg_amount || 0,
      };
    } catch {
      // Fall through to demo
    }
  }

  // Demo mode
  try {
    const params = new URLSearchParams();
    if (supervisorId) params.set("supervisor_id", supervisorId.toString());
    const qs = params.toString();
    const url = `${API_BASE}/api/demo/stats${qs ? `?${qs}` : ""}`;
    const response = await fetch(url);
    if (!response.ok) return getDemoStats();
    return await response.json();
  } catch {
    return getDemoStats();
  }
}

export async function updateEPO(id: number, updates: Partial<EPO>): Promise<EPO> {
  const res = await fetch(`${API_BASE}/api/epos/${id}`, {
    method: "PUT",
    headers: authHeaders(),
    body: JSON.stringify(updates),
  });
  if (!res.ok) throw new Error("Failed to update EPO");
  return res.json();
}

export async function createEPO(epo: Partial<EPO>): Promise<EPO> {
  const res = await fetch(`${API_BASE}/api/epos`, {
    method: "POST",
    headers: authHeaders(),
    body: JSON.stringify(epo),
  });
  if (!res.ok) throw new Error("Failed to create EPO");
  return res.json();
}

// ─── Demo API (no auth) ─────────────────────────
export async function simulateEmail(subject: string, body: string): Promise<any> {
  try {
    const response = await fetch(`${API_BASE}/api/demo/simulate-email`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email_subject: subject, email_body: body, vendor_email: "epo@vendor.com" }),
    });
    if (!response.ok) return null;
    return await response.json();
  } catch {
    return null;
  }
}

export async function seedData(): Promise<any> {
  try {
    const response = await fetch(`${API_BASE}/api/demo/seed`, { method: "POST" });
    if (!response.ok) return null;
    return await response.json();
  } catch {
    return null;
  }
}

export async function resetData(): Promise<any> {
  try {
    const response = await fetch(`${API_BASE}/api/demo/reset`, { method: "POST" });
    if (!response.ok) return null;
    return await response.json();
  } catch {
    return null;
  }
}

// ─── Team API ────────────────────────────────────
export async function getTeamMembers(): Promise<any> {
  const token = getAuthToken();

  if (token) {
    try {
      const res = await fetch(`${API_BASE}/api/team/members`, { headers: authHeaders() });
      if (res.ok) return res.json();
    } catch {}
  }

  // Demo fallback
  try {
    const res = await fetch(`${API_BASE}/api/team/members`);
    if (res.ok) return res.json();
  } catch {}

  return { members: [], total: 0 };
}

// ─── Email API ───────────────────────────────────
export async function getEmailStatus(): Promise<any> {
  const res = await fetch(`${API_BASE}/api/email/status`, { headers: authHeaders() });
  if (!res.ok) throw new Error("Failed to get email status");
  return res.json();
}

export async function connectEmail(emailAddress: string, provider: string): Promise<any> {
  const res = await fetch(`${API_BASE}/api/email/connect`, {
    method: "POST",
    headers: authHeaders(),
    body: JSON.stringify({ email_address: emailAddress, provider }),
  });
  if (!res.ok) throw new Error("Failed to connect email");
  return res.json();
}

export async function triggerEmailSync(): Promise<any> {
  const res = await fetch(`${API_BASE}/api/email/sync`, {
    method: "POST",
    headers: authHeaders(),
  });
  if (!res.ok) throw new Error("Failed to trigger sync");
  return res.json();
}

// ─── Vendor Portal API (no auth — token-based) ──
export interface VendorEPO {
  epo: {
    id: number;
    vendor_name: string;
    community: string;
    lot_number: string;
    description: string;
    amount: number;
    status: string;
    confirmation_number: string | null;
    days_open: number;
    created_at: string;
  };
  company_name: string;
  can_confirm: boolean;
  can_dispute: boolean;
}

export interface VendorHistory {
  epo_id: number;
  history: {
    action: string;
    note: string | null;
    confirmation_number: string | null;
    timestamp: string;
  }[];
}

export async function getVendorEPO(token: string): Promise<VendorEPO> {
  const res = await fetch(`${API_BASE}/api/vendor/epo/${token}`);
  if (!res.ok) throw new Error("EPO not found or link expired");
  return res.json();
}

export async function vendorConfirmEPO(
  token: string,
  confirmationNumber?: string,
  note?: string,
): Promise<any> {
  const params = new URLSearchParams();
  if (confirmationNumber) params.set("confirmation_number", confirmationNumber);
  if (note) params.set("vendor_note", note);
  const qs = params.toString();
  const res = await fetch(`${API_BASE}/api/vendor/epo/${token}/confirm${qs ? `?${qs}` : ""}`, {
    method: "POST",
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: "Confirm failed" }));
    throw new Error(err.detail || "Failed to confirm");
  }
  return res.json();
}

export async function vendorDisputeEPO(token: string, note?: string): Promise<any> {
  const params = new URLSearchParams();
  if (note) params.set("vendor_note", note);
  const qs = params.toString();
  const res = await fetch(`${API_BASE}/api/vendor/epo/${token}/dispute${qs ? `?${qs}` : ""}`, {
    method: "POST",
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: "Dispute failed" }));
    throw new Error(err.detail || "Failed to dispute");
  }
  return res.json();
}

export async function getVendorHistory(token: string): Promise<VendorHistory> {
  const res = await fetch(`${API_BASE}/api/vendor/epo/${token}/history`);
  if (!res.ok) throw new Error("Failed to load history");
  return res.json();
}

// ─── Export API ──────────────────────────────────
export function getExportCSVUrl(filters?: {
  status?: string;
  vendor?: string;
  community?: string;
  days?: number;
}): string {
  const params = new URLSearchParams();
  if (filters?.status && filters.status !== "all") params.set("status_filter", filters.status);
  if (filters?.vendor) params.set("vendor", filters.vendor);
  if (filters?.community) params.set("community", filters.community);
  if (filters?.days) params.set("days", filters.days.toString());
  const qs = params.toString();
  return `${API_BASE}/api/exports/epos/csv${qs ? `?${qs}` : ""}`;
}

export async function downloadCSV(filters?: {
  status?: string;
  vendor?: string;
  community?: string;
  days?: number;
}): Promise<void> {
  const url = getExportCSVUrl(filters);
  const res = await fetch(url, { headers: authHeaders() });
  if (!res.ok) throw new Error("Export failed");
  const blob = await res.blob();
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  const disposition = res.headers.get("Content-Disposition");
  const filename = disposition?.match(/filename="(.+)"/)?.[1] || "epo_export.csv";
  a.download = filename;
  a.click();
  URL.revokeObjectURL(a.href);
}

export async function getExportSummary(days: number = 30): Promise<any> {
  const res = await fetch(`${API_BASE}/api/exports/epos/summary?days=${days}`, {
    headers: authHeaders(),
  });
  if (!res.ok) throw new Error("Failed to get summary");
  return res.json();
}

// ─── Activity Feed API ──────────────────────────
export interface ActivityItem {
  type: string;
  timestamp: string;
  title: string;
  description: string;
  status: string;
  epo_id: number;
  icon: string;
}

export async function getActivityFeed(limit: number = 20, days: number = 7): Promise<{
  feed: ActivityItem[];
  total: number;
}> {
  const token = getAuthToken();

  if (token) {
    try {
      const res = await fetch(
        `${API_BASE}/api/activity/feed?limit=${limit}&days=${days}`,
        { headers: authHeaders() },
      );
      if (res.ok) return res.json();
    } catch {}
  }

  // Demo fallback
  return {
    feed: [
      { type: "epo_created", timestamp: new Date().toISOString(), title: "New EPO from Summit Builders", description: "Mallard Park Lot 142 — $285.00", status: "pending", epo_id: 1, icon: "inbox" },
      { type: "followup_sent", timestamp: new Date(Date.now() - 3600000).toISOString(), title: "Follow-up sent to Pulte Homes", description: "EPO Confirmation - Odell Park Lot 67", status: "sent", epo_id: 2, icon: "mail" },
      { type: "epo_created", timestamp: new Date(Date.now() - 7200000).toISOString(), title: "New EPO from DRB Homes", description: "Galloway Lot 33 — $720.00", status: "pending", epo_id: 3, icon: "inbox" },
    ],
    total: 3,
  };
}

export async function getTodayStats(): Promise<any> {
  const token = getAuthToken();
  if (token) {
    try {
      const res = await fetch(`${API_BASE}/api/activity/stats/today`, { headers: authHeaders() });
      if (res.ok) return res.json();
    } catch {}
  }
  return { today_new: 3, today_value: 1455, needs_attention: 5, needs_attention_value: 4200 };
}

// ─── Follow-up API ──────────────────────────────
export async function sendFollowup(epoId: number): Promise<any> {
  const res = await fetch(`${API_BASE}/api/email/${epoId}/send-followup`, {
    method: "POST",
    headers: authHeaders(),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: "Follow-up failed" }));
    throw new Error(err.detail || "Failed to send follow-up");
  }
  return res.json();
}

export async function batchFollowup(): Promise<any> {
  const res = await fetch(`${API_BASE}/api/email/batch-followup`, {
    method: "POST",
    headers: authHeaders(),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: "Batch follow-up failed" }));
    throw new Error(err.detail || "Failed to send batch follow-ups");
  }
  return res.json();
}

// ─── Gmail OAuth ────────────────────────────────
export async function startGmailOAuth(): Promise<{ auth_url: string }> {
  const res = await fetch(`${API_BASE}/api/email/oauth/gmail/start`, {
    headers: authHeaders(),
  });
  if (!res.ok) throw new Error("Failed to start Gmail OAuth");
  return res.json();
}

// ─── Health Check ────────────────────────────────
export async function healthCheck(): Promise<boolean> {
  try {
    const res = await fetch(`${API_BASE}/api/health`);
    return res.ok;
  } catch {
    return false;
  }
}

// ─── Fallback Demo Data ──────────────────────────
function getDemoStats(): Stats {
  return {
    total: 25, confirmed: 10, pending: 9, denied: 4, discount: 2,
    total_value: 16850, capture_rate: 40, needs_followup: 5, avg_amount: 674,
  };
}

function getDemoEPOs(): EPO[] {
  return [
    { id: 1, vendor_name: "Summit Builders", vendor_email: "epo@summit.com", community: "Mallard Park", lot_number: "142", description: "Touch-up paint after drywall repair, master bedroom ceiling", amount: 285, status: "pending", confirmation_number: null, days_open: 1, needs_review: false, confidence_score: 0.92, parse_model: "regex", synced_from_email: true, created_at: new Date().toISOString() },
    { id: 2, vendor_name: "Pulte Homes", vendor_email: "orders@pulte.com", community: "Odell Park", lot_number: "67", description: "Extra coat exterior trim - color mismatch", amount: 450, status: "confirmed", confirmation_number: "PO-4421", days_open: 6, needs_review: false, confidence_score: 0.95, parse_model: "regex", synced_from_email: true, created_at: new Date(Date.now() - 6 * 86400000).toISOString() },
    { id: 3, vendor_name: "DRB Homes", vendor_email: "sub@drb.com", community: "Galloway", lot_number: "33", description: "Ceiling repair and repaint after plumbing leak", amount: 720, status: "pending", confirmation_number: null, days_open: 9, needs_review: true, confidence_score: 0.88, parse_model: "gemini", synced_from_email: true, created_at: new Date(Date.now() - 9 * 86400000).toISOString() },
    { id: 4, vendor_name: "K. Hovnanian", vendor_email: "extra@khov.com", community: "Cedar Hills", lot_number: "201", description: "Exterior siding paint correction", amount: 890, status: "confirmed", confirmation_number: "PO-4398", days_open: 4, needs_review: false, confidence_score: 0.97, parse_model: "regex", synced_from_email: true, created_at: new Date(Date.now() - 4 * 86400000).toISOString() },
    { id: 5, vendor_name: "Ryan Homes", vendor_email: "epo@ryan.com", community: "Ridgeview", lot_number: "88", description: "Accent wall repaint - homeowner change order", amount: 165, status: "denied", confirmation_number: null, days_open: 16, needs_review: false, confidence_score: 0.91, parse_model: "haiku", synced_from_email: true, created_at: new Date(Date.now() - 16 * 86400000).toISOString() },
  ];
}
