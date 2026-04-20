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
    if (typeof window !== "undefined") {
      localStorage.setItem("epo_token", token);
      // Set a cookie so Next.js middleware can detect auth state
      document.cookie = "epo_auth=1; path=/; max-age=2592000; SameSite=Lax";
    }
  } else {
    if (typeof window !== "undefined") {
      localStorage.removeItem("epo_token");
      // Clear the auth cookie
      document.cookie = "epo_auth=; path=/; max-age=0";
    }
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
  email_date: string | null;
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
  avg_days_open: number;
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

export async function updateProfile(fullName: string): Promise<{ success: boolean; full_name: string }> {
  await ensureTokenValid();
  const res = await fetch(`${API_BASE}/api/auth/profile`, {
    method: "PUT",
    headers: authHeaders(),
    body: JSON.stringify({ full_name: fullName }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: "Update failed" }));
    throw new Error(err.detail || "Failed to update profile");
  }
  return res.json();
}

export async function updateNotifications(prefs: Record<string, any>): Promise<any> {
  await ensureTokenValid();
  const res = await fetch(`${API_BASE}/api/auth/notifications`, {
    method: "PUT",
    headers: authHeaders(),
    body: JSON.stringify(prefs),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: "Update failed" }));
    throw new Error(err.detail || "Failed to update notifications");
  }
  return res.json();
}

export async function getNotificationPrefs(): Promise<any> {
  await ensureTokenValid();
  const res = await fetch(`${API_BASE}/api/auth/notifications`, {
    headers: authHeaders(),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: "Fetch failed" }));
    throw new Error(err.detail || "Failed to get notification preferences");
  }
  return res.json();
}

export async function exportData(): Promise<Blob> {
  await ensureTokenValid();
  const res = await fetch(`${API_BASE}/api/auth/export-data`, {
    method: "POST",
    headers: authHeaders(),
  });
  if (!res.ok) {
    throw new Error("Failed to export data");
  }
  return res.blob();
}

export async function deleteAccount(): Promise<{ success: boolean }> {
  await ensureTokenValid();
  const res = await fetch(`${API_BASE}/api/auth/account`, {
    method: "DELETE",
    headers: authHeaders(),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: "Delete failed" }));
    throw new Error(err.detail || "Failed to delete account");
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
    avg_days_open: s.avg_days_open || 0,
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

export async function backfillEPOAmounts(): Promise<{
  total_checked: number;
  updated_total: number;
  updated_regex: number;
  updated_ai: number;
  updated_gmail_refetch: number;
  skipped: number;
  errors: string[];
  details: string[];
}> {
  await ensureTokenValid();
  const res = await fetch(`${API_BASE}/api/epos/backfill-amounts`, {
    method: "POST",
    headers: authHeaders(),
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Backfill failed: ${err}`);
  }
  return res.json();
}

export async function syncRecentGmail(days: number = 14): Promise<{
  success: boolean;
  total_fetched: number;
  new_epos_created: number;
  replies_processed: number;
  skipped_already_ingested: number;
  errors: string[];
}> {
  await ensureTokenValid();
  const res = await fetch(`${API_BASE}/api/webhook/gmail/sync-recent?days=${days}`, {
    method: "POST",
    headers: authHeaders(),
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Sync failed: ${err}`);
  }
  return res.json();
}

// ─── Sub Payments / Profit Tracker ─────────────
export interface SubPayment {
  id: number;
  epo_id: number;
  sub_name: string;
  sub_trade: string;
  amount: number;
  paid_date: string | null;
  notes: string | null;
  created_at: string;
}

export interface EPOProfitSummary {
  epo_id: number;
  vendor_name: string;
  community: string;
  lot_number: string;
  description: string;
  epo_amount: number;
  total_paid_subs: number;
  net_profit: number;
  profit_margin: number;
  payments: SubPayment[];
  status: string;
  created_at: string;
}

export interface ProfitOverview {
  total_revenue: number;
  total_paid_subs: number;
  total_net_profit: number;
  avg_profit_margin: number;
  epo_count: number;
  payment_count: number;
}

export async function getSubPayments(epoId?: number): Promise<SubPayment[]> {
  await ensureTokenValid();
  const url = epoId
    ? `${API_BASE}/api/sub-payments?epo_id=${epoId}`
    : `${API_BASE}/api/sub-payments`;
  const res = await fetch(url, { headers: authHeaders() });
  if (!res.ok) throw new Error("Failed to load sub payments");
  return res.json();
}

export async function createSubPayment(payment: {
  epo_id: number;
  sub_name: string;
  sub_trade: string;
  amount: number;
  paid_date?: string | null;
  notes?: string | null;
}): Promise<SubPayment> {
  await ensureTokenValid();
  const res = await fetch(`${API_BASE}/api/sub-payments`, {
    method: "POST",
    headers: authHeaders(),
    body: JSON.stringify(payment),
  });
  if (!res.ok) throw new Error("Failed to create sub payment");
  return res.json();
}

export async function updateSubPayment(
  id: number,
  updates: Partial<SubPayment>
): Promise<SubPayment> {
  await ensureTokenValid();
  const res = await fetch(`${API_BASE}/api/sub-payments/${id}`, {
    method: "PUT",
    headers: authHeaders(),
    body: JSON.stringify(updates),
  });
  if (!res.ok) throw new Error("Failed to update sub payment");
  return res.json();
}

export async function deleteSubPayment(id: number): Promise<void> {
  await ensureTokenValid();
  const res = await fetch(`${API_BASE}/api/sub-payments/${id}`, {
    method: "DELETE",
    headers: authHeaders(),
  });
  if (!res.ok) throw new Error("Failed to delete sub payment");
}

export async function getProfitSummary(): Promise<{
  overview: ProfitOverview;
  epos: EPOProfitSummary[];
}> {
  await ensureTokenValid();
  const res = await fetch(`${API_BASE}/api/sub-payments/profit-summary`, {
    headers: authHeaders(),
  });
  if (!res.ok) throw new Error("Failed to load profit summary");
  return res.json();
}

// ─── Lot Items API ──────────────────────────────
export interface LotItem {
  id: number;
  epo_id: number;
  lot_number: string;
  amount: number | null;
  description: string | null;
  notes: string | null;
  created_at: string;
}

export async function getLotItems(epoId: number): Promise<LotItem[]> {
  await ensureTokenValid();
  const res = await fetch(`${API_BASE}/api/epos/${epoId}/lot-items`, {
    headers: authHeaders(),
  });
  if (!res.ok) throw new Error("Failed to load lot items");
  return res.json();
}

export async function createLotItem(epoId: number, item: {
  lot_number: string;
  amount?: number;
  description?: string;
  notes?: string;
}): Promise<LotItem> {
  await ensureTokenValid();
  const res = await fetch(`${API_BASE}/api/epos/${epoId}/lot-items`, {
    method: "POST",
    headers: { ...authHeaders(), "Content-Type": "application/json" },
    body: JSON.stringify(item),
  });
  if (!res.ok) throw new Error("Failed to create lot item");
  return res.json();
}

export async function updateLotItem(itemId: number, updates: Partial<LotItem>): Promise<LotItem> {
  await ensureTokenValid();
  const res = await fetch(`${API_BASE}/api/epos/lot-items/${itemId}`, {
    method: "PUT",
    headers: { ...authHeaders(), "Content-Type": "application/json" },
    body: JSON.stringify(updates),
  });
  if (!res.ok) throw new Error("Failed to update lot item");
  return res.json();
}

export async function deleteLotItem(itemId: number): Promise<void> {
  await ensureTokenValid();
  const res = await fetch(`${API_BASE}/api/epos/lot-items/${itemId}`, {
    method: "DELETE",
    headers: authHeaders(),
  });
  if (!res.ok) throw new Error("Failed to delete lot item");
}

export async function autoSplitLotItems(epoId: number, force = false): Promise<LotItem[]> {
  await ensureTokenValid();
  const url = `${API_BASE}/api/epos/${epoId}/lot-items/auto-split${force ? '?force=true' : ''}`;
  const res = await fetch(url, {
    method: "POST",
    headers: authHeaders(),
  });
  if (!res.ok) throw new Error("Failed to auto-split lot items");
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
export async function getTeamMembers(): Promise<any[]> {
  await ensureTokenValid();
  const res = await fetch(`${API_BASE}/api/team/members`, { headers: authHeaders() });
  if (!res.ok) throw new Error("Failed to fetch team members");
  const data = await res.json();
  return data.members || [];
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

// ─── Billing / Stripe ──────────────────────────────
export async function getBillingStatus(): Promise<any> {
  await ensureTokenValid();
  const res = await fetch(`${API_BASE}/api/billing/status`, {
    headers: authHeaders(),
  });
  if (!res.ok) throw new Error("Failed to get billing status");
  return res.json();
}

export async function getBillingPlans(): Promise<any> {
  const res = await fetch(`${API_BASE}/api/billing/plans`);
  if (!res.ok) throw new Error("Failed to get plans");
  return res.json();
}

export async function getBillingConfig(): Promise<{ publishable_key: string }> {
  const res = await fetch(`${API_BASE}/api/billing/config`);
  if (!res.ok) throw new Error("Failed to get billing config");
  return res.json();
}

export async function createCheckoutSession(plan: string): Promise<{ checkout_url: string; session_id: string }> {
  await ensureTokenValid();
  const res = await fetch(`${API_BASE}/api/billing/checkout`, {
    method: "POST",
    headers: { ...authHeaders(), "Content-Type": "application/json" },
    body: JSON.stringify({ plan }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: "Checkout failed" }));
    throw new Error(err.detail || "Checkout failed");
  }
  return res.json();
}

export async function createOneTimePayment(amount_cents: number, description: string): Promise<{ checkout_url: string }> {
  await ensureTokenValid();
  const res = await fetch(`${API_BASE}/api/billing/one-time`, {
    method: "POST",
    headers: { ...authHeaders(), "Content-Type": "application/json" },
    body: JSON.stringify({ amount_cents, description }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: "Payment failed" }));
    throw new Error(err.detail || "Payment failed");
  }
  return res.json();
}

export async function createPortalSession(): Promise<{ portal_url: string }> {
  await ensureTokenValid();
  const res = await fetch(`${API_BASE}/api/billing/portal`, {
    method: "POST",
    headers: authHeaders(),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: "Portal access failed" }));
    throw new Error(err.detail || "Portal access failed");
  }
  return res.json();
}

export async function setupStripeProducts(): Promise<any> {
  await ensureTokenValid();
  const res = await fetch(`${API_BASE}/api/billing/setup-products`, {
    method: "POST",
    headers: authHeaders(),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: "Setup failed" }));
    throw new Error(err.detail || "Setup failed");
  }
  return res.json();
}

// ─── Builder Analytics API ──────────────────────
export interface BuilderScore {
  vendor_name: string;
  vendor_email: string;
  total_epos: number;
  confirmed_count: number;
  denied_count: number;
  pending_count: number;
  discount_count: number;
  total_value: number;
  confirmed_value: number;
  capture_rate: number;
  avg_response_days: number;
  last_epo_date: string | null;
  trend: "up" | "down" | "stable";
}

export interface CommunityScore {
  community_name: string;
  total_epos: number;
  confirmed: number;
  pending: number;
  denied: number;
  total_value: number;
  confirmed_value: number;
  top_vendor: string;
  avg_days_open: number;
}

export interface TrendWeek {
  week: string;
  new_count: number;
  confirmed_count: number;
  denied_count: number;
  total_value: number;
}

export async function getBuilderScores(sortBy?: string, days?: number): Promise<BuilderScore[]> {
  await ensureTokenValid();
  const params = new URLSearchParams();
  if (sortBy) params.set("sort_by", sortBy);
  if (days) params.set("days", days.toString());
  const qs = params.toString();
  const res = await fetch(`${API_BASE}/api/analytics/builders${qs ? `?${qs}` : ""}`, {
    headers: authHeaders(),
  });
  if (!res.ok) throw new Error("Failed to fetch builder scores");
  return res.json();
}

export async function getCommunityScores(days?: number): Promise<CommunityScore[]> {
  await ensureTokenValid();
  const params = new URLSearchParams();
  if (days) params.set("days", days.toString());
  const qs = params.toString();
  const res = await fetch(`${API_BASE}/api/analytics/communities${qs ? `?${qs}` : ""}`, {
    headers: authHeaders(),
  });
  if (!res.ok) throw new Error("Failed to fetch community scores");
  return res.json();
}

export async function getTrends(weeks?: number): Promise<TrendWeek[]> {
  await ensureTokenValid();
  const params = new URLSearchParams();
  if (weeks) params.set("weeks", weeks.toString());
  const qs = params.toString();
  const res = await fetch(`${API_BASE}/api/analytics/trends${qs ? `?${qs}` : ""}`, {
    headers: authHeaders(),
  });
  if (!res.ok) throw new Error("Failed to fetch trends");
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

// ─── Daily Reports ───────────────────────────────────────────
export interface DailyReport {
  id: number;
  company_id: number;
  created_by_id: number;
  report_date: string;
  community: string;
  lot_number: string | null;
  work_performed: string | null;
  phase: string | null;
  units_completed: number | null;
  percent_complete: number | null;
  crew_size: number | null;
  crew_hours: number | null;
  weather: string | null;
  temperature_high: number | null;
  work_delayed: boolean;
  delay_reason: string | null;
  issues_noted: string | null;
  safety_incidents: boolean;
  safety_notes: string | null;
  materials_needed: string | null;
  materials_delivered: string | null;
  inspections_passed: number | null;
  inspections_failed: number | null;
  rework_needed: string | null;
  status: "draft" | "submitted";
  notes: string | null;
  created_at: string;
  updated_at: string;
  created_by_name?: string;
}

export interface DailyReportSummary {
  reports_this_week: number;
  reports_this_month: number;
  active_communities: number;
  total_crew_hours_this_week: number;
  safety_incidents_this_month: number;
  avg_crew_size: number;
  communities_breakdown: { community: string; count: number }[];
}

export async function getDailyReports(params?: {
  community?: string;
  date_from?: string;
  date_to?: string;
  status?: string;
  page?: number;
  per_page?: number;
}): Promise<{ reports: DailyReport[]; total: number; page: number; per_page: number }> {
  await ensureTokenValid();
  const searchParams = new URLSearchParams();
  if (params?.community) searchParams.set("community", params.community);
  if (params?.date_from) searchParams.set("date_from", params.date_from);
  if (params?.date_to) searchParams.set("date_to", params.date_to);
  if (params?.status) searchParams.set("status", params.status);
  if (params?.page) searchParams.set("page", String(params.page));
  if (params?.per_page) searchParams.set("per_page", String(params.per_page));
  const qs = searchParams.toString();
  const res = await fetch(`${API_BASE}/api/daily-reports${qs ? `?${qs}` : ""}`, {
    headers: authHeaders(),
  });
  if (!res.ok) throw new Error("Failed to fetch daily reports");
  return res.json();
}

export async function getDailyReport(id: number): Promise<DailyReport> {
  await ensureTokenValid();
  const res = await fetch(`${API_BASE}/api/daily-reports/${id}`, {
    headers: authHeaders(),
  });
  if (!res.ok) throw new Error("Failed to fetch daily report");
  return res.json();
}

export async function createDailyReport(data: Partial<DailyReport>): Promise<DailyReport> {
  await ensureTokenValid();
  const res = await fetch(`${API_BASE}/api/daily-reports`, {
    method: "POST",
    headers: authHeaders(),
    body: JSON.stringify(data),
  });
  if (!res.ok) throw new Error("Failed to create daily report");
  return res.json();
}

export async function updateDailyReport(id: number, data: Partial<DailyReport>): Promise<DailyReport> {
  await ensureTokenValid();
  const res = await fetch(`${API_BASE}/api/daily-reports/${id}`, {
    method: "PUT",
    headers: authHeaders(),
    body: JSON.stringify(data),
  });
  if (!res.ok) throw new Error("Failed to update daily report");
  return res.json();
}

export async function deleteDailyReport(id: number): Promise<void> {
  await ensureTokenValid();
  const res = await fetch(`${API_BASE}/api/daily-reports/${id}`, {
    method: "DELETE",
    headers: authHeaders(),
  });
  if (!res.ok) throw new Error("Failed to delete daily report");
}

export async function submitDailyReport(id: number): Promise<DailyReport> {
  await ensureTokenValid();
  const res = await fetch(`${API_BASE}/api/daily-reports/${id}/submit`, {
    method: "POST",
    headers: authHeaders(),
  });
  if (!res.ok) throw new Error("Failed to submit daily report");
  return res.json();
}

export async function getDailyReportSummary(): Promise<DailyReportSummary> {
  await ensureTokenValid();
  const res = await fetch(`${API_BASE}/api/daily-reports/summary`, {
    headers: authHeaders(),
  });
  if (!res.ok) throw new Error("Failed to fetch summary");
  return res.json();
}

// ─── Punch List ──────────────────────────────────────────────
export interface PunchItem {
  id: number;
  company_id: number;
  created_by_id: number;
  assigned_to_id: number | null;
  community: string;
  lot_number: string;
  location: string | null;
  title: string;
  description: string | null;
  category: string;
  priority: "low" | "medium" | "high" | "critical";
  status: "open" | "in_progress" | "completed" | "verified" | "rejected";
  reported_by: string | null;
  builder_name: string | null;
  resolution_notes: string | null;
  completed_by_id: number | null;
  completed_at: string | null;
  verified_by_id: number | null;
  verified_at: string | null;
  due_date: string | null;
  scheduled_date: string | null;
  photo_url: string | null;
  completion_photo_url: string | null;
  created_at: string;
  updated_at: string;
  created_by_name?: string;
  assigned_to_name?: string;
}

export interface PunchSummary {
  total: number;
  open: number;
  in_progress: number;
  completed: number;
  verified: number;
  rejected: number;
  overdue: number;
  avg_resolution_days: number | null;
  by_community: { community: string; open: number; total: number }[];
  by_category: { category: string; count: number }[];
  by_priority: { priority: string; count: number }[];
}

export async function getPunchItems(params?: {
  community?: string;
  lot_number?: string;
  status?: string;
  priority?: string;
  category?: string;
  assigned_to_id?: number;
  page?: number;
  per_page?: number;
}): Promise<{ items: PunchItem[]; total: number; page: number; per_page: number }> {
  await ensureTokenValid();
  const searchParams = new URLSearchParams();
  if (params?.community) searchParams.set("community", params.community);
  if (params?.lot_number) searchParams.set("lot_number", params.lot_number);
  if (params?.status) searchParams.set("status", params.status);
  if (params?.priority) searchParams.set("priority", params.priority);
  if (params?.category) searchParams.set("category", params.category);
  if (params?.assigned_to_id) searchParams.set("assigned_to_id", String(params.assigned_to_id));
  if (params?.page) searchParams.set("page", String(params.page));
  if (params?.per_page) searchParams.set("per_page", String(params.per_page));
  const qs = searchParams.toString();
  const res = await fetch(`${API_BASE}/api/punch-list${qs ? `?${qs}` : ""}`, {
    headers: authHeaders(),
  });
  if (!res.ok) throw new Error("Failed to fetch punch items");
  return res.json();
}

export async function getPunchItem(id: number): Promise<PunchItem> {
  await ensureTokenValid();
  const res = await fetch(`${API_BASE}/api/punch-list/${id}`, {
    headers: authHeaders(),
  });
  if (!res.ok) throw new Error("Failed to fetch punch item");
  return res.json();
}

export async function createPunchItem(data: Partial<PunchItem>): Promise<PunchItem> {
  await ensureTokenValid();
  const res = await fetch(`${API_BASE}/api/punch-list`, {
    method: "POST",
    headers: authHeaders(),
    body: JSON.stringify(data),
  });
  if (!res.ok) throw new Error("Failed to create punch item");
  return res.json();
}

export async function updatePunchItem(id: number, data: Partial<PunchItem>): Promise<PunchItem> {
  await ensureTokenValid();
  const res = await fetch(`${API_BASE}/api/punch-list/${id}`, {
    method: "PUT",
    headers: authHeaders(),
    body: JSON.stringify(data),
  });
  if (!res.ok) throw new Error("Failed to update punch item");
  return res.json();
}

export async function assignPunchItem(id: number, assigned_to_id: number): Promise<PunchItem> {
  await ensureTokenValid();
  const res = await fetch(`${API_BASE}/api/punch-list/${id}/assign`, {
    method: "POST",
    headers: authHeaders(),
    body: JSON.stringify({ assigned_to_id }),
  });
  if (!res.ok) throw new Error("Failed to assign punch item");
  return res.json();
}

export async function completePunchItem(id: number, data?: { resolution_notes?: string; completion_photo_url?: string }): Promise<PunchItem> {
  await ensureTokenValid();
  const res = await fetch(`${API_BASE}/api/punch-list/${id}/complete`, {
    method: "POST",
    headers: authHeaders(),
    body: JSON.stringify(data || {}),
  });
  if (!res.ok) throw new Error("Failed to complete punch item");
  return res.json();
}

export async function verifyPunchItem(id: number, approved: boolean, notes?: string): Promise<PunchItem> {
  await ensureTokenValid();
  const res = await fetch(`${API_BASE}/api/punch-list/${id}/verify`, {
    method: "POST",
    headers: authHeaders(),
    body: JSON.stringify({ approved, notes }),
  });
  if (!res.ok) throw new Error("Failed to verify punch item");
  return res.json();
}

export async function deletePunchItem(id: number): Promise<void> {
  await ensureTokenValid();
  const res = await fetch(`${API_BASE}/api/punch-list/${id}`, {
    method: "DELETE",
    headers: authHeaders(),
  });
  if (!res.ok) throw new Error("Failed to delete punch item");
}

export async function getPunchSummary(): Promise<PunchSummary> {
  await ensureTokenValid();
  const res = await fetch(`${API_BASE}/api/punch-list/summary`, {
    headers: authHeaders(),
  });
  if (!res.ok) throw new Error("Failed to fetch punch summary");
  return res.json();
}

export async function getPunchByLot(community: string, lot_number: string): Promise<{ items: PunchItem[] }> {
  await ensureTokenValid();
  const res = await fetch(`${API_BASE}/api/punch-list/lot/${encodeURIComponent(community)}/${encodeURIComponent(lot_number)}`, {
    headers: authHeaders(),
  });
  if (!res.ok) throw new Error("Failed to fetch punch items by lot");
  return res.json();
}

// ─── Budget Tracking ─────────────────────────────────────────
export interface CommunityBudget {
  id: number;
  company_id: number;
  community: string;
  budget_amount: number;
  period_start: string;
  period_end: string;
  labor_budget: number | null;
  materials_budget: number | null;
  equipment_budget: number | null;
  notes: string | null;
  is_active: boolean;
  created_at: string;
  // Computed fields from API
  actual_spend?: number;
  remaining?: number;
  percent_used?: number;
  epo_count?: number;
  status?: "on_track" | "warning" | "over_budget" | "exceeded";
}

export interface BudgetOverview {
  communities: {
    community: string;
    budget_amount: number;
    actual_spend: number;
    remaining: number;
    percent_used: number;
    epo_count: number;
    status: "on_track" | "warning" | "over_budget" | "exceeded";
  }[];
  unbudgeted: {
    community: string;
    actual_spend: number;
    epo_count: number;
  }[];
  totals: {
    total_budget: number;
    total_spend: number;
    total_remaining: number;
    overall_percent: number;
  };
}

export interface BudgetTrendMonth {
  month: string;
  budget_portion: number;
  actual_spend: number;
  epo_count: number;
}

export async function getBudgets(community?: string): Promise<CommunityBudget[]> {
  await ensureTokenValid();
  const qs = community ? `?community=${encodeURIComponent(community)}` : "";
  const res = await fetch(`${API_BASE}/api/budgets${qs}`, {
    headers: authHeaders(),
  });
  if (!res.ok) throw new Error("Failed to fetch budgets");
  return res.json();
}

export async function getBudget(id: number): Promise<CommunityBudget> {
  await ensureTokenValid();
  const res = await fetch(`${API_BASE}/api/budgets/${id}`, {
    headers: authHeaders(),
  });
  if (!res.ok) throw new Error("Failed to fetch budget");
  return res.json();
}

export async function createBudget(data: Partial<CommunityBudget>): Promise<CommunityBudget> {
  await ensureTokenValid();
  const res = await fetch(`${API_BASE}/api/budgets`, {
    method: "POST",
    headers: authHeaders(),
    body: JSON.stringify(data),
  });
  if (!res.ok) throw new Error("Failed to create budget");
  return res.json();
}

export async function updateBudget(id: number, data: Partial<CommunityBudget>): Promise<CommunityBudget> {
  await ensureTokenValid();
  const res = await fetch(`${API_BASE}/api/budgets/${id}`, {
    method: "PUT",
    headers: authHeaders(),
    body: JSON.stringify(data),
  });
  if (!res.ok) throw new Error("Failed to update budget");
  return res.json();
}

export async function deleteBudget(id: number): Promise<void> {
  await ensureTokenValid();
  const res = await fetch(`${API_BASE}/api/budgets/${id}`, {
    method: "DELETE",
    headers: authHeaders(),
  });
  if (!res.ok) throw new Error("Failed to delete budget");
}

export async function getBudgetOverview(): Promise<BudgetOverview> {
  await ensureTokenValid();
  const res = await fetch(`${API_BASE}/api/budgets/overview`, {
    headers: authHeaders(),
  });
  if (!res.ok) throw new Error("Failed to fetch budget overview");
  return res.json();
}

export async function getBudgetTrends(community: string): Promise<BudgetTrendMonth[]> {
  await ensureTokenValid();
  const res = await fetch(`${API_BASE}/api/budgets/trends/${encodeURIComponent(community)}`, {
    headers: authHeaders(),
  });
  if (!res.ok) throw new Error("Failed to fetch budget trends");
  return res.json();
}

// ─── Work Orders ─────────────────────────────────────────────
export interface WorkOrder {
  id: number;
  company_id: number;
  created_by_id: number;
  assigned_to_id: number | null;
  title: string;
  description: string | null;
  community: string;
  lot_number: string | null;
  work_type: string;
  priority: "low" | "normal" | "high" | "urgent";
  status: "open" | "assigned" | "in_progress" | "on_hold" | "completed" | "cancelled";
  scheduled_date: string | null;
  due_date: string | null;
  started_at: string | null;
  completed_at: string | null;
  estimated_hours: number | null;
  actual_hours: number | null;
  crew_size_needed: number | null;
  estimated_cost: number | null;
  actual_cost: number | null;
  builder_name: string | null;
  builder_contact: string | null;
  epo_id: number | null;
  completion_notes: string | null;
  created_at: string;
  updated_at: string;
  assigned_to_name?: string;
  created_by_name?: string;
}

export interface WorkOrderSummary {
  total: number;
  open: number;
  assigned: number;
  in_progress: number;
  on_hold: number;
  completed: number;
  cancelled: number;
  overdue: number;
  this_week: number;
  by_community: { community: string; count: number }[];
  by_type: { work_type: string; count: number }[];
  estimated_hours_total: number;
  actual_hours_total: number;
}

export interface WeekSchedule {
  [day: string]: WorkOrder[];
}

export async function getWorkOrders(params?: {
  community?: string;
  status?: string;
  priority?: string;
  work_type?: string;
  assigned_to_id?: number;
  page?: number;
  per_page?: number;
}): Promise<{ orders: WorkOrder[]; total: number; page: number; per_page: number }> {
  await ensureTokenValid();
  const searchParams = new URLSearchParams();
  if (params?.community) searchParams.set("community", params.community);
  if (params?.status) searchParams.set("status", params.status);
  if (params?.priority) searchParams.set("priority", params.priority);
  if (params?.work_type) searchParams.set("work_type", params.work_type);
  if (params?.assigned_to_id) searchParams.set("assigned_to_id", String(params.assigned_to_id));
  if (params?.page) searchParams.set("page", String(params.page));
  if (params?.per_page) searchParams.set("per_page", String(params.per_page));
  const qs = searchParams.toString();
  const res = await fetch(`${API_BASE}/api/work-orders${qs ? `?${qs}` : ""}`, {
    headers: authHeaders(),
  });
  if (!res.ok) throw new Error("Failed to fetch work orders");
  return res.json();
}

export async function getWorkOrder(id: number): Promise<WorkOrder> {
  await ensureTokenValid();
  const res = await fetch(`${API_BASE}/api/work-orders/${id}`, {
    headers: authHeaders(),
  });
  if (!res.ok) throw new Error("Failed to fetch work order");
  return res.json();
}

export async function createWorkOrder(data: Partial<WorkOrder>): Promise<WorkOrder> {
  await ensureTokenValid();
  const res = await fetch(`${API_BASE}/api/work-orders`, {
    method: "POST",
    headers: authHeaders(),
    body: JSON.stringify(data),
  });
  if (!res.ok) throw new Error("Failed to create work order");
  return res.json();
}

export async function updateWorkOrder(id: number, data: Partial<WorkOrder>): Promise<WorkOrder> {
  await ensureTokenValid();
  const res = await fetch(`${API_BASE}/api/work-orders/${id}`, {
    method: "PUT",
    headers: authHeaders(),
    body: JSON.stringify(data),
  });
  if (!res.ok) throw new Error("Failed to update work order");
  return res.json();
}

export async function assignWorkOrder(id: number, assigned_to_id: number): Promise<WorkOrder> {
  await ensureTokenValid();
  const res = await fetch(`${API_BASE}/api/work-orders/${id}/assign`, {
    method: "POST",
    headers: authHeaders(),
    body: JSON.stringify({ assigned_to_id }),
  });
  if (!res.ok) throw new Error("Failed to assign work order");
  return res.json();
}

export async function startWorkOrder(id: number): Promise<WorkOrder> {
  await ensureTokenValid();
  const res = await fetch(`${API_BASE}/api/work-orders/${id}/start`, {
    method: "POST",
    headers: authHeaders(),
  });
  if (!res.ok) throw new Error("Failed to start work order");
  return res.json();
}

export async function completeWorkOrder(id: number, data?: { actual_hours?: number; completion_notes?: string }): Promise<WorkOrder> {
  await ensureTokenValid();
  const res = await fetch(`${API_BASE}/api/work-orders/${id}/complete`, {
    method: "POST",
    headers: authHeaders(),
    body: JSON.stringify(data || {}),
  });
  if (!res.ok) throw new Error("Failed to complete work order");
  return res.json();
}

export async function holdWorkOrder(id: number, reason?: string): Promise<WorkOrder> {
  await ensureTokenValid();
  const res = await fetch(`${API_BASE}/api/work-orders/${id}/hold`, {
    method: "POST",
    headers: authHeaders(),
    body: JSON.stringify({ reason }),
  });
  if (!res.ok) throw new Error("Failed to hold work order");
  return res.json();
}

export async function cancelWorkOrder(id: number, reason?: string): Promise<WorkOrder> {
  await ensureTokenValid();
  const res = await fetch(`${API_BASE}/api/work-orders/${id}/cancel`, {
    method: "POST",
    headers: authHeaders(),
    body: JSON.stringify({ reason }),
  });
  if (!res.ok) throw new Error("Failed to cancel work order");
  return res.json();
}

export async function deleteWorkOrder(id: number): Promise<void> {
  await ensureTokenValid();
  const res = await fetch(`${API_BASE}/api/work-orders/${id}`, {
    method: "DELETE",
    headers: authHeaders(),
  });
  if (!res.ok) throw new Error("Failed to delete work order");
}

export async function getWorkOrderSummary(): Promise<WorkOrderSummary> {
  await ensureTokenValid();
  const res = await fetch(`${API_BASE}/api/work-orders/summary/stats`, {
    headers: authHeaders(),
  });
  if (!res.ok) throw new Error("Failed to fetch work order summary");
  return res.json();
}

export async function getWeekSchedule(weekStart?: string): Promise<WeekSchedule> {
  await ensureTokenValid();
  const qs = weekStart ? `?week_start=${weekStart}` : "";
  const res = await fetch(`${API_BASE}/api/work-orders/schedule/week${qs}`, {
    headers: authHeaders(),
  });
  if (!res.ok) throw new Error("Failed to fetch week schedule");
  return res.json();
}

