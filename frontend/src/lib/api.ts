// ─── API Configuration ───────────────────────────
// Use empty string for relative URLs — Next.js rewrites in next.config.js
// proxy /api/* requests to the backend, avoiding CORS issues entirely.
// Only use the full URL for server-side or local dev without rewrites.
import { apiClient } from "./apiClient";

const API_BASE = typeof window !== "undefined" ? "" : (process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000");

// ─── Token Management ────────────────────────────
let authToken: string | null = null;
let storedRefreshToken: string | null = null;

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

export function setRefreshToken(token: string | null) {
  storedRefreshToken = token;
  if (token) {
    if (typeof window !== "undefined") localStorage.setItem("epo_refresh_token", token);
  } else {
    if (typeof window !== "undefined") localStorage.removeItem("epo_refresh_token");
  }
}

export function getRefreshToken(): string | null {
  if (storedRefreshToken) return storedRefreshToken;
  if (typeof window !== "undefined") {
    storedRefreshToken = localStorage.getItem("epo_refresh_token");
  }
  return storedRefreshToken;
}

/** Decode JWT and check if expired */
function isTokenExpired(token: string): boolean {
  try {
    const payload = JSON.parse(atob(token.split(".")[1]));
    const exp = payload.exp;
    if (!exp) return false;
    // Check if expired (with 30 second buffer)
    return Date.now() >= (exp * 1000 - 30000);
  } catch {
    return false;
  }
}

// Mutex for token refresh — prevents multiple concurrent refresh calls
let refreshPromise: Promise<void> | null = null;

/** Refresh the access token using the refresh token.
 *  Uses a shared promise so concurrent callers deduplicate into one request. */
async function refreshAccessToken(): Promise<void> {
  // If a refresh is already in-flight, piggyback on it
  if (refreshPromise) return refreshPromise;

  refreshPromise = _doRefresh().finally(() => {
    refreshPromise = null;
  });
  return refreshPromise;
}

async function _doRefresh(): Promise<void> {
  const refresh = getRefreshToken();
  if (!refresh) {
    // No refresh token, redirect to login
    if (typeof window !== "undefined") {
      setAuthToken(null);
      setRefreshToken(null);
      window.location.href = "/login";
    }
    throw new Error("No refresh token available");
  }

  try {
    const response = await fetch(`${API_BASE}/api/auth/refresh`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ refresh_token: refresh }),
    });

    if (!response.ok) {
      throw new Error("Token refresh failed");
    }

    const data: AuthResponse = await response.json();
    setAuthToken(data.access_token);
    if ("refresh_token" in data) {
      setRefreshToken((data as any).refresh_token);
    }
  } catch (error) {
    // Refresh failed, clear tokens and redirect to login
    if (typeof window !== "undefined") {
      setAuthToken(null);
      setRefreshToken(null);
      window.location.href = "/login";
    }
    throw error;
  }
}

function authHeaders(): HeadersInit {
  const token = getAuthToken();
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (token) headers["Authorization"] = `Bearer ${token}`;
  return headers;
}

/** Check and refresh token if needed before making requests */
async function ensureTokenValid(): Promise<void> {
  const token = getAuthToken();
  if (token && isTokenExpired(token)) {
    await refreshAccessToken();
  }
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
  if ("refresh_token" in data) {
    setRefreshToken((data as any).refresh_token);
  }
  return data;
}

export async function register(
  email: string,
  password: string,
  fullName: string,
  companyName: string,
  industry: string,
  role: string = "field",
  inviteCode?: string,
): Promise<AuthResponse> {
  const body: Record<string, string> = {
    email,
    password,
    full_name: fullName,
    role,
  };
  if (inviteCode) {
    body.invite_code = inviteCode;
  } else {
    body.company_name = companyName;
    body.industry = industry;
  }
  const res = await fetch(`${API_BASE}/api/auth/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: "Registration failed" }));
    throw new Error(err.detail || "Registration failed");
  }
  const data: AuthResponse = await res.json();
  setAuthToken(data.access_token);
  if ("refresh_token" in data) {
    setRefreshToken((data as any).refresh_token);
  }
  return data;
}

export async function getMe(): Promise<User> {
  await ensureTokenValid();
  const res = await fetch(`${API_BASE}/api/auth/me`, { headers: authHeaders() });
  if (!res.ok) throw new Error("Not authenticated");
  return res.json();
}

export function logout() {
  setAuthToken(null);
  setRefreshToken(null);
}

export async function joinTeam(inviteCode: string): Promise<any> {
  await ensureTokenValid();
  const res = await fetch(`${API_BASE}/api/auth/join-team`, {
    method: "POST",
    headers: authHeaders(),
    body: JSON.stringify({ invite_code: inviteCode }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: "Failed to join team" }));
    throw new Error(err.detail || "Failed to join team");
  }
  return res.json();
}

export async function forgotPassword(email: string): Promise<{ message: string }> {
  const res = await fetch(`${API_BASE}/api/auth/forgot-password`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: "Request failed" }));
    throw new Error(err.detail || "Failed to send password reset email");
  }
  return res.json();
}

export async function resetPassword(
  email: string,
  code: string,
  newPassword: string,
): Promise<{ message: string }> {
  const res = await fetch(`${API_BASE}/api/auth/reset-password`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, code, new_password: newPassword }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: "Reset failed" }));
    throw new Error(err.detail || "Failed to reset password");
  }
  return res.json();
}

export async function changePassword(
  currentPassword: string,
  newPassword: string,
): Promise<{ message: string }> {
  await ensureTokenValid();
  const res = await fetch(`${API_BASE}/api/auth/change-password`, {
    method: "POST",
    headers: authHeaders(),
    body: JSON.stringify({ current_password: currentPassword, new_password: newPassword }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: "Change failed" }));
    throw new Error(err.detail || "Failed to change password");
  }
  return res.json();
}

export async function refreshToken(): Promise<AuthResponse> {
  const refresh = getRefreshToken();
  if (!refresh) {
    throw new Error("No refresh token available");
  }
  const res = await fetch(`${API_BASE}/api/auth/refresh`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ refresh_token: refresh }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: "Refresh failed" }));
    throw new Error(err.detail || "Failed to refresh token");
  }
  const data: AuthResponse = await res.json();
  setAuthToken(data.access_token);
  if ("refresh_token" in data) {
    setRefreshToken((data as any).refresh_token);
  }
  return data;
}

// ─── EPO API ─────────────────────────────────────
export async function getEPOs(status?: string, supervisorId?: number): Promise<EPO[]> {
  await ensureTokenValid();
  const params = new URLSearchParams();
  if (status && status !== "all") params.set("status_filter", status);
  if (supervisorId) params.set("supervisor_id", supervisorId.toString());
  const qs = params.toString();
  const res = await fetch(`${API_BASE}/api/epos${qs ? `?${qs}` : ""}`, {
    headers: authHeaders(),
  });
  if (!res.ok) throw new Error("Failed to fetch EPOs");
  const data = await res.json();
  return Array.isArray(data) ? data : data.epos || [];
}

export async function getStats(supervisorId?: number): Promise<Stats> {
  await ensureTokenValid();
  const res = await fetch(`${API_BASE}/api/epos/stats/dashboard`, {
    headers: authHeaders(),
  });
  if (!res.ok) throw new Error("Failed to fetch stats");
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
}

export async function updateEPO(id: number, updates: Partial<EPO>): Promise<EPO> {
  await ensureTokenValid();
  const res = await fetch(`${API_BASE}/api/epos/${id}`, {
    method: "PUT",
    headers: authHeaders(),
    body: JSON.stringify(updates),
  });
  if (!res.ok) throw new Error("Failed to update EPO");
  return res.json();
}

export async function createEPO(epo: Partial<EPO>): Promise<EPO> {
  await ensureTokenValid();
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
  await ensureTokenValid();
  const res = await fetch(`${API_BASE}/api/team/members`, { headers: authHeaders() });
  if (!res.ok) throw new Error("Failed to fetch team members");
  return res.json();
}

// ─── Email API ───────────────────────────────────
export async function getEmailStatus(): Promise<any> {
  await ensureTokenValid();
  const res = await fetch(`${API_BASE}/api/email/status`, { headers: authHeaders() });
  if (!res.ok) throw new Error("Failed to get email status");
  return res.json();
}

export async function connectEmail(emailAddress: string, provider: string): Promise<any> {
  await ensureTokenValid();
  const res = await fetch(`${API_BASE}/api/email/connect`, {
    method: "POST",
    headers: authHeaders(),
    body: JSON.stringify({ email_address: emailAddress, provider }),
  });
  if (!res.ok) throw new Error("Failed to connect email");
  return res.json();
}

export async function disconnectEmail(connectionId: number): Promise<any> {
  await ensureTokenValid();
  const res = await fetch(`${API_BASE}/api/email/disconnect/${connectionId}`, {
    method: "DELETE",
    headers: authHeaders(),
  });
  if (!res.ok) throw new Error("Failed to disconnect email");
  return res.json();
}

export async function triggerEmailSync(): Promise<any> {
  await ensureTokenValid();
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
  await ensureTokenValid();
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
  await ensureTokenValid();
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
  await ensureTokenValid();
  const res = await fetch(
    `${API_BASE}/api/activity/feed?limit=${limit}&days=${days}`,
    { headers: authHeaders() },
  );
  if (!res.ok) throw new Error("Failed to fetch activity feed");
  return res.json();
}

export async function getTodayStats(): Promise<any> {
  await ensureTokenValid();
  const res = await fetch(`${API_BASE}/api/activity/stats/today`, { headers: authHeaders() });
  if (!res.ok) throw new Error("Failed to fetch today stats");
  return res.json();
}

// ─── Follow-up API ──────────────────────────────
export async function sendFollowup(epoId: number): Promise<any> {
  await ensureTokenValid();
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
  await ensureTokenValid();
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
  await ensureTokenValid();
  const res = await fetch(`${API_BASE}/api/email/oauth/gmail/start`, {
    headers: authHeaders(),
  });
  if (res.status === 401 && typeof window !== "undefined") {
    setAuthToken(null);
    setRefreshToken(null);
    window.location.href = "/login";
  }
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

