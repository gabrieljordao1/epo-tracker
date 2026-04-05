/**
 * Toast Instance Helper
 *
 * This module provides a way for the apiClient to access the toast context
 * even when useToast() hook cannot be used (e.g., in non-React code).
 *
 * The ToastProvider should call registerToastInstance() during initialization.
 */

type ToastMethods = {
  success: (message: string, duration?: number) => void;
  error: (message: string, duration?: number) => void;
  warning: (message: string, duration?: number) => void;
  info: (message: string, duration?: number) => void;
};

let toastInstance: ToastMethods | null = null;

export function registerToastInstance(toast: ToastMethods) {
  toastInstance = toast;
}

export function getToastInstance(): ToastMethods | null {
  return toastInstance;
}
