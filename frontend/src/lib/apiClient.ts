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

const getApiBaseUrl = () => {
  if (typeof window !== "undefined") {
    // Client-side
    return process.env.NEXT_PUBLIC_API_URL || "http://localhost:3001";
  }
  // Server-side
  return process.env.API_URL || "http://localhost:3001";
};

async function handleApiError(
  response: Response,
  body: unknown
): Promise<never> {
  const toast = getToastInstance();

  if (response.status === 401) {
    // Unauthorized - redirect to login
    if (typeof window !== "undefined") {
      window.location.href = "/login";
    }
    throw new Error("Unauthorized");
  }

  if (response.status === 429) {
    // Rate limited
    if (toast) {
      toast.warning("Rate limited. Please try again shortly.");
    }
    throw new Error("Rate limited");
  }

  if (response.status >= 500) {
    // Server error
    if (toast) {
      toast.error("Server error. Please try again later.");
    }
    throw new Error("Server error");
  }

  // Generic error handling
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
  } = {}
): Promise<T> {
  const { body, headers: customHeaders = {}, token } = options;

  const baseUrl = getApiBaseUrl();
  const url = `${baseUrl}${endpoint}`;

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...customHeaders,
  };

  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }

  try {
    const response = await fetch(url, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined,
      credentials: "include",
    });

    let responseBody: unknown;
    const contentType = response.headers.get("content-type");

    if (contentType?.includes("application/json")) {
      responseBody = await response.json();
    } else {
      responseBody = await response.text();
    }

    if (!response.ok) {
      await handleApiError(response, responseBody);
    }

    return responseBody as T;
  } catch (error) {
    // Network error or other fetch error
    const toast = getToastInstance();

    if (error instanceof TypeError && error.message.includes("fetch")) {
      if (toast) {
        toast.error("Connection lost. Please check your internet connection.");
      }
    }

    throw error;
  }
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
