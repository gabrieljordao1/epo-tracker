"use client";

import React from "react";
import { AlertTriangle } from "lucide-react";

interface ErrorBoundaryProps {
  children: React.ReactNode;
}

interface ErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
}

export class ErrorBoundary extends React.Component<
  ErrorBoundaryProps,
  ErrorBoundaryState
> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    console.error("ErrorBoundary caught an error:", error, errorInfo);
    // TODO: Send to Sentry or error tracking service
    // Sentry.captureException(error, { contexts: { react: errorInfo } });
  }

  resetError = () => {
    this.setState({ hasError: false, error: null });
  };

  render() {
    if (this.state.hasError) {
      return (
        <div className="flex items-center justify-center min-h-screen bg-gray-950">
          <div className="bg-gray-900 border border-red-700 rounded-lg shadow-lg p-8 max-w-md w-full">
            {/* Icon */}
            <div className="flex justify-center mb-4">
              <div className="bg-red-900 rounded-full p-3">
                <AlertTriangle className="w-8 h-8 text-red-400" />
              </div>
            </div>

            {/* Title */}
            <h1 className="text-center text-xl font-bold text-white mb-2">
              Something Went Wrong
            </h1>

            {/* Error Message */}
            <p className="text-center text-gray-300 text-sm mb-6">
              We encountered an unexpected error. Please try again.
            </p>

            {/* Error Details (Development only) */}
            {process.env.NODE_ENV === "development" && this.state.error && (
              <div className="bg-gray-800 border border-gray-700 rounded p-3 mb-6">
                <p className="text-xs text-gray-400 font-mono break-words">
                  {this.state.error.message}
                </p>
              </div>
            )}

            {/* Action Buttons */}
            <div className="flex flex-col gap-3">
              <button
                onClick={this.resetError}
                className="w-full bg-red-600 hover:bg-red-700 text-white font-semibold py-2 px-4 rounded-lg transition-colors duration-200"
              >
                Try Again
              </button>
              <button
                onClick={() => {
                  window.location.href = "/";
                }}
                className="w-full bg-gray-800 hover:bg-gray-700 text-white font-semibold py-2 px-4 rounded-lg transition-colors duration-200 border border-gray-700"
              >
                Go to Home
              </button>
            </div>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
