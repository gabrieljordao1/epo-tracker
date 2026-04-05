import { getToastInstance } from "@/lib/toastInstance";

export type HttpMethod = "GET" | "POST" | "PUT" | "DELETE" | "PATCH";

export interface ApiResponse<T = unknown> {
  success: boolean;
  data?: T;
  error?: string;
  status: number;
}

export interface ApiErrorResponse {
  message?: string;
  error?: string;
}

const DEFAULT_TIMEOUT = 30000; // 30 seconds
const MAX_RETRIES = 3;
const RETRY_DELAY_BASE = 1000; // 1 second base delay

let isOffline = false;
let offlineToastShown = false;

// --- Offline detection ---
if (typeof window !== "undefined") {
  window.addEventListener("online", () => {
    isOffline = false;
    offlineToastShown = false;
    const toast = getToastInstance();
    if (toast) {
      toast.success("Connection restored.");
    }
  });

  window.addEventListener("offline", () => {
    isOffline = true;
    const toast = getToastInstance();
    if (toast && !offlineToastShown) {
      toast.error("You are offline. Changes may not be saved.");
      offlineToastShown = true;
    }
  });
}

// --- Helpers ---

function shouldRetry(status: number, attempt: number): boolean {
  if (attempt >= MAX_RETRIES) return false;
  // Retry on server errors (5xx) and 408 (Request Timeout) and 429 (Rate Limited)
  return status >= 500 || status === 408 || status === 429;
}

function getRetryDelay(attempt: number): number {
  // Exponential backoff with jitter
  const delay = RETRY_DELAY_BASE * Math.pow(2, attempt);
  const jitter = delay * 0.2 * Math.random();
  return delay + jitter;
}

async function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function fetchWithTimeout(
  url: string,
  options: RequestInit,
  timeout: number
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);

  return fetch(url, {
    ...options,
    signal: controller.signal,
  }).finally(() => clearTimeout(timer));
}

const getApiBaseUrl = () => {
  if (typeof window !== "undefined") {
    return process.env.NEXT_PUBLIC_API_URL || "http://localhost:3001";
  }
  return process.env.API_URL || "http://localhost:3001";
};

async function handleApiError(
  response: Response,
  body: unknown
): Promise<never> {
  const toast = getToastInstance();

  if (response.status === 401) {
    if (typeof window !== "undefined") {
      window.location.href = "/login";
    }
    throw new Error("Unauthorized");
  }

  if (response.status === 429) {
    if (toast) {
      toast.warning("Rate limited. Please try again shortly.");
    }
    throw new Error("Rate limited");
  }

  if (response.status >= 500) {
    if (toast) {
      toast.error("Server error. Please try again later.");
    }
    throw new Error("Server error");
  }

  const errorMessage =
    typeof body === "object" && body !== null && "message" in body
      ? (body as ApiErrorResponse).message ||
        (body as ApiErrorResponse).error ||
        `HTTP ${response.status}`
      : `HTTP ${response.status}`;

  throw new Error(errorMessage);
}

async function apiRequest<T = unknown>(
  method: HttpMethod,
  endpoint: string,
  options: {
    body?: unknown;
    headers?: Record<string, string>;
    token?: string;
    timeout?: number;
    retries?: number;
  } = {}
): Promise<T> {
  const {
    body,
    headers: customHeaders = {},
    token,
    timeout = DEFAULT_TIMEOUT,
    retries = MAX_RETRIES,
  } = options;

  // Check offline status
  if (isOffline) {
    const toast = getToastInstance();
    if (toast && !offlineToastShown) {
      toast.error("You are offline. Please check your connection.");
      offlineToastShown = true;
    }
    throw new Error("No internet connection");
  }

  const baseUrl = getApiBaseUrl();
  const url = `${baseUrl}${endpoint}`;

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...customHeaders,
  };

  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }

  let lastError: Error | null = null;

  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const response = await fetchWithTimeout(
        url,
        {
          method,
          headers,
          body: body ? JSON.stringify(body) : undefined,
          credentials: "include",
        },
        timeout
      );

      let responseBody: unknown;
      const contentType = response.headers.get("content-type");

      if (contentType?.includes("application/json")) {
        responseBody = await response.json();
      } else {
        responseBody = await response.text();
      }

      if (!response.ok) {
        // Don't retry 401 or 4xx (except 408, 429)
        if (!shouldRetry(response.status, attempt)) {
          await handleApiError(response, responseBody);
        }

        // Retry eligible - wait and try again
        if (attempt < retries && shouldRetry(response.status, attempt)) {
          const delay = getRetryDelay(attempt);
          console.warn(
            `[API] Retrying ${method} ${endpoint} (attempt ${attempt + 1}/${retries}) after ${Math.round(delay)}ms`
          );
          await sleep(delay);
          continue;
        }

        await handleApiError(response, responseBody);
      }

      return responseBody as T;
    } catch (error) {
      lastError = error as Error;

      // Abort errors (timeout)
      if (error instanceof DOMException && error.name === "AbortError") {
        if (attempt < retries) {
          const delay = getRetryDelay(attempt);
          console.warn(
            `[API] Request timeout, retrying ${method} ${endpoint} (attempt ${attempt + 1}/${retries})`
          );
          await sleep(delay);
          continue;
        }
        const toast = getToastInstance();
        if (toast) {
          toast.error("Request timed out. Please try again.");
        }
        throw new Error("Request timed out");
      }

      // Network errors - retry
      if (
        error instanceof TypeError &&
        (error.message.includes("fetch") || error.message.includes("network"))
      ) {
        if (attempt < retries) {
          const delay = getRetryDelay(attempt);
          console.warn(
            `[API] Network error, retrying ${method} ${endpoint} (attempt ${attempt + 1}/${retries})`
          );
          await sleep(delay);
          continue;
        }
        const toast = getToastInstance();
        if (toast) {
          toast.error("Connection lost. Please check your internet connection.");
        }
        throw error;
      }

      // Non-retryable error (like 401, 404, etc.)
      throw error;
    }
  }

  throw lastError || new Error("Request failed after retries");
}

export const apiClient = {
  get: <T = unknown>(endpoint: string, options?: any) =>
    apiRequest<T>("GET", endpoint, options),

  post: <T = unknown>(endpoint: string, body?: unknown, options?: any) =>
    apiRequest<T>("POST", endpoint, { ...options, body }),

  put: <T = unknown>(endpoint: string, body?: unknown, options?: any) =>
    apiRequest<T>("PUT", endpoint, { ...options, body }),

  delete: <T = unknown>(endpoint: string, options?: any) =>
    apiRequest<T>("DELETE", endpoint, options),

  patch: <T = unknown>(endpoint: string, body?: unknown, options?: any) =>
    apiRequest<T>("PATCH", endpoint, { ...options, body }),
};
