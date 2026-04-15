# Toast & Error System - Integration Guide

## Overview

Your Onyx EPO tracker now has a professional toast notification system and error boundary. Everything is already installed and configured. This guide explains what was built and how to use it.

## What Was Built

### 1. Toast Notification System
- Display notifications (success, error, warning, info)
- Auto-dismiss after 5 seconds (configurable)
- Stack up to 5 toasts
- Smooth slide-in animations
- Dark theme matching your app

### 2. Error Boundary
- Catches React component errors
- Shows professional error UI
- "Try Again" button to reset
- "Go to Home" button
- Development mode shows error details

### 3. API Client Wrapper
- Replaces raw `fetch()` calls
- Automatic error handling and toasts
- Full TypeScript support
- Handles 401, 429, 500, network errors
- Bearer token support

## Files Created/Modified

| File | Change | Purpose |
|------|--------|---------|
| `src/components/Toast.tsx` | Created | Toast context and hook |
| `src/components/ErrorBoundary.tsx` | Created | Error boundary component |
| `src/components/Providers.tsx` | Updated | Now wraps with Toast + Error boundary |
| `src/lib/apiClient.ts` | Created | Fetch wrapper with error handling |
| `src/lib/toastInstance.ts` | Created | Internal toast registration |
| `src/components/ExampleToastUsage.tsx` | Created | Example component (optional) |
| `TOAST_AND_ERROR_SYSTEM.md` | Created | Full technical documentation |
| `QUICK_REFERENCE.md` | Created | Quick code examples |

## How to Use

### Show Toast Notifications

```typescript
import { useToast } from "@/components/Toast";

export function MyComponent() {
  const toast = useToast();

  const handleSave = () => {
    // Do something...
    toast.success("Saved successfully!");
  };

  return <button onClick={handleSave}>Save</button>;
}
```

### Make API Calls

Replace `fetch()` with `apiClient`:

```typescript
import { apiClient } from "@/lib/apiClient";

// Instead of:
// const response = await fetch("/api/employees");

// Use:
const employees = await apiClient.get<Employee[]>("/api/employees");
```

### Combined: API + Toast

```typescript
const toast = useToast();

try {
  const result = await apiClient.post("/api/employees", newEmployee);
  toast.success("Employee created!");
} catch (error) {
  // apiClient already showed an error toast for HTTP errors
  console.error(error);
}
```

## Error Handling Behavior

The `apiClient` automatically handles these scenarios:

| Scenario | Action |
|----------|--------|
| **401 Unauthorized** | Redirect to `/login` |
| **429 Rate Limited** | Show warning toast |
| **500+ Server Error** | Show error toast |
| **Network Error** | Show "Connection lost" toast |
| **Other Errors** | Re-throw for component to handle |

## Configuration

### API Base URL

Set in `.env.local`:

```bash
NEXT_PUBLIC_API_URL=http://your-api-domain.com
```

Default: `http://localhost:3001`

### Toast Duration

```typescript
// Default: 5 seconds
toast.success("Message!");

// Custom duration (7 seconds)
toast.success("Message!", 7000);

// No auto-dismiss
toast.info("Message!", Infinity);
```

### Error Tracking (Sentry)

Edit `src/components/ErrorBoundary.tsx`:

```typescript
import * as Sentry from "@sentry/nextjs";

componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
  console.error("ErrorBoundary caught an error:", error, errorInfo);

  // Uncomment to send to Sentry:
  // Sentry.captureException(error, { contexts: { react: errorInfo } });
}
```

## Migration Checklist

If you have existing code using raw `fetch()`:

- [ ] Find all `fetch()` calls in your codebase
- [ ] Replace with `apiClient` methods
- [ ] Remove manual error handling for HTTP errors
- [ ] Test that error toasts appear correctly
- [ ] Remove `fetch()` based error handling

Example before/after:

**Before:**
```typescript
const response = await fetch("/api/employees");
if (!response.ok) {
  if (response.status === 401) {
    // redirect to login
  }
  throw new Error("Failed to load");
}
const data = await response.json();
```

**After:**
```typescript
const data = await apiClient.get("/api/employees");
// Error handling happens automatically!
```

## Testing Error Scenarios

### Test 401 Unauthorized
```typescript
// apiClient redirects to /login automatically
const data = await apiClient.get("/api/protected-endpoint");
```

### Test 429 Rate Limit
```typescript
// Shows toast: "Rate limited. Please try again shortly."
const data = await apiClient.get("/api/endpoint-with-rate-limit");
```

### Test 500 Server Error
```typescript
// Shows toast: "Server error. Please try again later."
const data = await apiClient.get("/api/broken-endpoint");
```

### Test Network Error
```typescript
// Shows toast: "Connection lost..."
// Disconnect internet and try API call
```

## Component Structure

Your app now has this wrapper structure:

```
<RootLayout>
  <Providers>
    <ErrorBoundary>          {/* Catches React errors */}
      <ToastProvider>        {/* Provides toast context */}
        <UserProvider>       {/* Your existing provider */}
          <LayoutShell>      {/* Sidebar, topbar, etc */}
            <children />     {/* Your pages/components */}
          </LayoutShell>
        </UserProvider>
      </ToastProvider>
    </ErrorBoundary>
  </Providers>
</RootLayout>
```

## Common Patterns

### Form Submission

```typescript
const [loading, setLoading] = useState(false);
const toast = useToast();

const handleSubmit = async (formData: FormData) => {
  try {
    setLoading(true);
    await apiClient.post("/api/employees", {
      name: formData.get("name"),
      email: formData.get("email"),
    });
    toast.success("Employee created!");
    resetForm();
  } catch (error) {
    // apiClient already showed error toast
  } finally {
    setLoading(false);
  }
};
```

### List with CRUD Operations

```typescript
const [employees, setEmployees] = useState<Employee[]>([]);
const [loading, setLoading] = useState(false);
const toast = useToast();

// Load
useEffect(() => {
  (async () => {
    try {
      const data = await apiClient.get<Employee[]>("/api/employees");
      setEmployees(data);
    } catch (error) {
      // toast already shown by apiClient
    }
  })();
}, []);

// Create
const create = async (name: string) => {
  try {
    setLoading(true);
    const newEmp = await apiClient.post<Employee>(
      "/api/employees",
      { name }
    );
    setEmployees([...employees, newEmp]);
    toast.success("Created!");
  } finally {
    setLoading(false);
  }
};

// Update
const update = async (id: string, name: string) => {
  try {
    setLoading(true);
    const updated = await apiClient.put<Employee>(
      `/api/employees/${id}`,
      { name }
    );
    setEmployees(employees.map(e => e.id === id ? updated : e));
    toast.success("Updated!");
  } finally {
    setLoading(false);
  }
};

// Delete
const remove = async (id: string) => {
  try {
    setLoading(true);
    await apiClient.delete(`/api/employees/${id}`);
    setEmployees(employees.filter(e => e.id !== id));
    toast.success("Deleted!");
  } finally {
    setLoading(false);
  }
};
```

### Dependent API Calls

```typescript
const getEmployeeDetails = async (id: string) => {
  try {
    // First call
    const employee = await apiClient.get<Employee>(`/api/employees/${id}`);

    // Second call using first result
    const shifts = await apiClient.get<Shift[]>(
      `/api/employees/${id}/shifts`
    );

    return { employee, shifts };
  } catch (error) {
    // apiClient shows toast, then throws
    console.error(error);
  }
};
```

## Troubleshooting

### Toast Not Appearing

**Check:**
1. Are you using `useToast()` hook?
2. Is the component a child of `ToastProvider` (through `Providers`)?
3. Browser console for errors?

**Test:**
```typescript
import { useToast } from "@/components/Toast";

export function Test() {
  const toast = useToast();
  return (
    <button onClick={() => toast.success("Test!")}>
      Test Toast
    </button>
  );
}
```

### API Errors Not Showing

**Check:**
1. Are you using `apiClient` or raw `fetch()`?
2. Is your API returning proper error responses?
3. Is `NEXT_PUBLIC_API_URL` configured correctly?

**Test:**
```typescript
// This should show a toast
const data = await apiClient.get("/api/nonexistent");
```

### Error Boundary Not Showing

**Check:**
1. Is the error happening during render (not async)?
2. Is error in a child component?

**Test:**
```typescript
export function ErrorTest() {
  throw new Error("Test error"); // Caught by boundary
  // return <div>Never rendered</div>;
}
```

## Dependencies Used

All already in package.json:
- **framer-motion** - Toast animations
- **lucide-react** - Icons
- **next** 14.x - Framework
- **react** 18.x - UI library
- **tailwindcss** - Styling

## Performance

- Toast animations are GPU-accelerated
- Error boundary minimal overhead
- apiClient uses native fetch (no extra libraries)
- No bundle size impact

## Next Steps

1. **Immediate:** Replace `fetch()` calls with `apiClient`
2. **Short-term:** Test error scenarios (401, 500, network)
3. **Optional:** Configure Sentry for production error tracking
4. **Optional:** Customize toast colors/animations to match brand

## Support

- **Quick answers:** See `QUICK_REFERENCE.md`
- **Detailed docs:** See `TOAST_AND_ERROR_SYSTEM.md`
- **Examples:** See `src/components/ExampleToastUsage.tsx`

## Production Checklist

Before deploying:

- [ ] Set `NEXT_PUBLIC_API_URL` to production API domain
- [ ] Test all error scenarios (401, 429, 500, network)
- [ ] Configure Sentry (optional but recommended)
- [ ] Verify error boundary catches errors
- [ ] Test on real backend (not mocks)
- [ ] Check toast animations perform well on target devices
- [ ] Remove `ExampleToastUsage.tsx` if not needed

---

**Everything is ready to use.** Start using `useToast()` and `apiClient` in your components today!
