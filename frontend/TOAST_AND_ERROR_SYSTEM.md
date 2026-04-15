# Toast Notification System & Error Boundary Documentation

## Overview

A professional, production-ready toast notification and error boundary system for the Onyx EPO tracker frontend. Features dark theme styling, smooth animations, automatic error handling, and centralized API error management.

## Components

### 1. Toast System (`src/components/Toast.tsx`)

Professional notification system with context-based hook API.

#### Features
- **Types**: `success` (green), `error` (red), `warning` (amber), `info` (blue)
- **Auto-dismiss**: 5 seconds (configurable per toast)
- **Animations**: Smooth slide-in from top-right with framer-motion
- **Stack limit**: Maximum 5 toasts on screen
- **Icons**: Lucide icons for each toast type
- **Close button**: Manual dismiss with hover states
- **Dark theme**: bg-gray-800+ with colored borders

#### Usage

```typescript
import { useToast } from "@/components/Toast";

export function MyComponent() {
  const toast = useToast();

  const handleSuccess = () => {
    toast.success("Employee record created!");
  };

  const handleError = () => {
    toast.error("Failed to save employee record");
  };

  const handleWarning = () => {
    toast.warning("Changes have not been saved", 7000); // 7 second duration
  };

  const handleInfo = () => {
    toast.info("Processing your request...");
  };

  return (
    <div>
      <button onClick={handleSuccess}>Success</button>
      <button onClick={handleError}>Error</button>
      <button onClick={handleWarning}>Warning</button>
      <button onClick={handleInfo}>Info</button>
    </div>
  );
}
```

#### Hook Signature

```typescript
useToast(): {
  success: (message: string, duration?: number) => string;
  error: (message: string, duration?: number) => string;
  warning: (message: string, duration?: number) => string;
  info: (message: string, duration?: number) => string;
}
```

### 2. Error Boundary (`src/components/ErrorBoundary.tsx`)

Class component that catches React errors and displays a professional error UI.

#### Features
- **Error catching**: Catches all React component errors
- **Fallback UI**: Dark-themed error card with icon and message
- **Try Again**: Resets error state
- **Go to Home**: Navigates to home page
- **Development mode**: Shows error details in dev environment
- **Logging**: Console logging with Sentry integration point

#### Usage

```typescript
import { ErrorBoundary } from "@/components/ErrorBoundary";

// Wrap sections of your app
<ErrorBoundary>
  <ExpensiveComponent />
</ErrorBoundary>

// Or wrap entire app (already done in Providers)
```

### 3. API Client (`src/lib/apiClient.ts`)

Typed fetch wrapper with automatic error handling and toast notifications.

#### Features
- **Methods**: `get()`, `post()`, `put()`, `delete()`, `patch()`
- **Type-safe**: Full TypeScript support with generics
- **Error handling**:
  - 401 → Redirect to login
  - 429 → Toast "Rate limited, try again shortly"
  - 500+ → Toast "Server error"
  - Network errors → Toast "Connection lost"
- **Base URL**: Configurable via environment variables
- **Credentials**: Supports credentials and custom headers
- **Bearer tokens**: Automatic Authorization header

#### Environment Variables

```bash
# .env.local
NEXT_PUBLIC_API_URL=http://localhost:3001
```

#### Usage

```typescript
import { apiClient } from "@/lib/apiClient";

// GET request
const employees = await apiClient.get<Employee[]>("/api/employees");

// POST with body
const newEmployee = await apiClient.post<Employee>(
  "/api/employees",
  { name: "John Doe", email: "john@example.com" }
);

// PUT with token
const updated = await apiClient.put(
  "/api/employees/123",
  { name: "Jane Doe" },
  { token: "your-jwt-token" }
);

// DELETE
await apiClient.delete("/api/employees/123");

// PATCH
const patched = await apiClient.patch("/api/employees/123", {
  status: "active"
});
```

### 4. Toast Instance Helper (`src/lib/toastInstance.ts`)

Internal utility that allows `apiClient` to show toasts even in non-React code.

#### How It Works

1. `ToastProvider` registers itself on mount via `registerToastInstance()`
2. `apiClient` retrieves the instance via `getToastInstance()`
3. API errors automatically trigger toast notifications

No manual configuration needed—automatically wired.

### 5. Updated Providers (`src/components/Providers.tsx`)

Main provider wrapper combining all systems:

```typescript
export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <ErrorBoundary>
      <ToastProvider>
        <UserProvider>{children}</UserProvider>
      </ToastProvider>
    </ErrorBoundary>
  );
}
```

Composition order:
1. **ErrorBoundary** (outermost) — catches all React errors
2. **ToastProvider** — provides toast context
3. **UserProvider** — existing user context
4. **children** (innermost)

## Styling Details

### Color Scheme (Dark Theme)

| Type | Background | Border | Icon |
|------|-----------|--------|------|
| Success | `bg-green-900` | `border-green-700` | `text-green-400` |
| Error | `bg-red-900` | `border-red-700` | `text-red-400` |
| Warning | `bg-amber-900` | `border-amber-700` | `text-amber-400` |
| Info | `bg-blue-900` | `border-blue-700` | `text-blue-400` |

### Toast Layout

- **Position**: Fixed top-right (6px from edges)
- **Z-index**: 50 (above most content)
- **Max width**: `max-w-sm` (448px)
- **Spacing**: 3px gap between stacked toasts
- **Animation**: 0.3s slide-in from top-right and bottom-right on exit

### Error Boundary Layout

- **Background**: Full screen `bg-gray-950`
- **Card**: Center-aligned, `max-w-md`, `bg-gray-900`
- **Border**: `border-red-700`
- **Icon**: Circular background with `bg-red-900`
- **Buttons**: Red primary, gray secondary with borders

## Implementation Checklist

### Already Completed
- [x] Toast context and useToast hook
- [x] Error boundary class component
- [x] API client with error handling
- [x] Toast instance helper
- [x] Providers.tsx integration
- [x] Dark theme styling
- [x] TypeScript types throughout
- [x] "use client" directives

### Integration Steps (For You)

1. **Environment variables** (if using custom API base URL):
   ```bash
   NEXT_PUBLIC_API_URL=http://your-api-url
   ```

2. **Error tracking setup** (optional Sentry integration):
   ```typescript
   // In ErrorBoundary.tsx, uncomment and configure:
   // import * as Sentry from "@sentry/nextjs";
   // Sentry.captureException(error, { contexts: { react: errorInfo } });
   ```

3. **Use in components**:
   ```typescript
   // For notifications
   import { useToast } from "@/components/Toast";

   // For API calls
   import { apiClient } from "@/lib/apiClient";
   ```

## API Error Response Handling

The API client expects error responses in this format:

```typescript
// Handled automatically by apiClient
{
  message: "Error description",
  error: "Error description (alternative field)"
}
```

HTTP status codes:
- `401`: Unauthorized → Redirect to login
- `429`: Rate limited → Toast warning
- `500+`: Server error → Toast error
- Network error → Toast error

## Development vs Production

### Development
- Error boundary shows error message details in error card
- Console logging for debugging

### Production
- Error details hidden (security)
- Generic "Something went wrong" message
- Sentry integration recommended for error tracking

## Performance Considerations

- **Toast animations**: GPU-accelerated with framer-motion
- **Context optimization**: Only re-renders toast consumers when state changes
- **Error boundary**: Minimal overhead, only renders fallback on error
- **API client**: No caching (implement in components as needed)

## Type Definitions

### useToast Hook

```typescript
interface ToastMethods {
  success: (message: string, duration?: number) => string;
  error: (message: string, duration?: number) => string;
  warning: (message: string, duration?: number) => string;
  info: (message: string, duration?: number) => string;
}
```

### apiClient Methods

```typescript
apiClient.get<T>(endpoint: string, options?: any): Promise<T>
apiClient.post<T>(endpoint: string, body?: unknown, options?: any): Promise<T>
apiClient.put<T>(endpoint: string, body?: unknown, options?: any): Promise<T>
apiClient.delete<T>(endpoint: string, options?: any): Promise<T>
apiClient.patch<T>(endpoint: string, body?: unknown, options?: any): Promise<T>
```

## File Locations

- `/src/components/Toast.tsx` — Toast context and hook
- `/src/components/ErrorBoundary.tsx` — Error boundary class component
- `/src/components/Providers.tsx` — Updated with Toast and Error boundary
- `/src/lib/apiClient.ts` — API wrapper with error handling
- `/src/lib/toastInstance.ts` — Internal toast instance helper

## Future Enhancements

- [ ] Sound notifications for errors
- [ ] Toast action buttons (e.g., "Undo", "Retry")
- [ ] Toast queue priority (errors over info)
- [ ] Custom toast component variants
- [ ] Analytics tracking for errors
- [ ] Sentry integration with sourcemaps
- [ ] A/B testing different toast positions
- [ ] Keyboard shortcuts to dismiss toasts

## Troubleshooting

### Toast not appearing
- Ensure `ToastProvider` wraps your component
- Check Z-index conflicts with other fixed elements
- Verify `"use client"` directive is in Toast.tsx

### API errors not triggering toasts
- Ensure `apiClient` is used for all API calls
- Check `NEXT_PUBLIC_API_URL` environment variable
- Verify error response format from backend

### Error boundary not catching errors
- Only catches React render errors, not async errors
- Use try-catch in async functions
- Verify error happens in child component, not boundary itself

## Support

For questions or issues, refer to:
- React Error Boundary docs: https://react.dev/reference/react/Component#catching-rendering-errors-with-an-error-boundary
- Framer Motion docs: https://www.framer.com/motion/
- Lucide Icons: https://lucide.dev/
