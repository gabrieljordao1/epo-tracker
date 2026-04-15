# Toast & Error System - Quick Reference

## Show a Toast Notification

```typescript
import { useToast } from "@/components/Toast";

const MyComponent = () => {
  const toast = useToast();

  return (
    <>
      <button onClick={() => toast.success("Done!")}>
        Show Success
      </button>
      <button onClick={() => toast.error("Failed!")}>
        Show Error
      </button>
      <button onClick={() => toast.warning("Warning!", 7000)}>
        Show Warning (7s)
      </button>
      <button onClick={() => toast.info("FYI...")}>
        Show Info
      </button>
    </>
  );
};
```

## Make an API Call (With Auto Error Handling)

```typescript
import { apiClient } from "@/lib/apiClient";

// GET
const data = await apiClient.get<Employee[]>("/api/employees");

// POST
const created = await apiClient.post<Employee>("/api/employees", {
  name: "John",
  email: "john@example.com",
});

// PUT
const updated = await apiClient.put("/api/employees/123", {
  status: "active",
});

// DELETE
await apiClient.delete("/api/employees/123");

// PATCH
const patched = await apiClient.patch("/api/settings", {
  theme: "dark",
});
```

## What Happens Automatically

```typescript
apiClient.get("/api/data")
  .then(data => console.log(data))
  .catch(error => {
    // 401 → Redirects to /login
    // 429 → Shows: "Rate limited. Please try again shortly."
    // 500+ → Shows: "Server error. Please try again later."
    // Network error → Shows: "Connection lost. Check internet."
  });
```

## Combine Toast + API

```typescript
const toast = useToast();

try {
  const result = await apiClient.post("/api/employees", data);
  // Success! (apiClient didn't throw)
  toast.success("Employee created!");
} catch (error) {
  // apiClient already showed error toast
  // Just handle local state
  console.error(error);
}
```

## Error Boundary (Automatic)

Already wraps your entire app. Just write normal React code:

```typescript
// If this throws during render, error boundary catches it
const MyComponent = () => {
  const data = riskyOperation(); // If this throws → shows error UI
  return <div>{data}</div>;
};
```

## Types

### useToast

```typescript
interface Toast {
  success(message: string, duration?: number): string;
  error(message: string, duration?: number): string;
  warning(message: string, duration?: number): string;
  info(message: string, duration?: number): string;
}
```

### apiClient

```typescript
apiClient.get<T>(url, options?): Promise<T>
apiClient.post<T>(url, body?, options?): Promise<T>
apiClient.put<T>(url, body?, options?): Promise<T>
apiClient.delete<T>(url, options?): Promise<T>
apiClient.patch<T>(url, body?, options?): Promise<T>
```

## Environment Variables

```bash
# .env.local (optional, defaults to http://localhost:3001)
NEXT_PUBLIC_API_URL=http://api.example.com
```

## Files Created

| File | Purpose |
|------|---------|
| `src/components/Toast.tsx` | Toast context and hook |
| `src/components/ErrorBoundary.tsx` | Error boundary component |
| `src/components/Providers.tsx` | **Updated** to wrap both |
| `src/lib/apiClient.ts` | Fetch wrapper with error handling |
| `src/lib/toastInstance.ts` | Internal toast registration |
| `src/components/ExampleToastUsage.tsx` | Example component (can delete) |

## Common Patterns

### Form Submission with Validation

```typescript
const handleSubmit = async (e: FormEvent) => {
  e.preventDefault();
  const toast = useToast();

  try {
    const response = await apiClient.post("/api/employees", formData);
    toast.success("Saved!");
    resetForm();
  } catch (error) {
    // apiClient already showed error toast for HTTP errors
    if (error.message.includes("validation")) {
      toast.warning("Check the form for errors");
    }
  }
};
```

### List Operations (Fetch + Delete)

```typescript
const [employees, setEmployees] = useState<Employee[]>([]);
const toast = useToast();

// Load list
useEffect(() => {
  apiClient.get<Employee[]>("/api/employees")
    .then(setEmployees)
    .catch(() => {
      // apiClient already showed error toast
    });
}, []);

// Delete item
const handleDelete = async (id: string) => {
  try {
    await apiClient.delete(`/api/employees/${id}`);
    setEmployees(employees.filter(e => e.id !== id));
    toast.success("Deleted!");
  } catch (error) {
    // error toast already shown
  }
};
```

### Loading State

```typescript
const [loading, setLoading] = useState(false);

const handleClick = async () => {
  try {
    setLoading(true);
    await apiClient.post("/api/data", payload);
    toast.success("Done!");
  } finally {
    setLoading(false);
  }
};

return <button disabled={loading}>{loading ? "..." : "Save"}</button>;
```

## Styling Reference

All components use Tailwind dark theme:
- Backgrounds: `gray-800`, `gray-900`, `gray-950`
- Text: `white`, `gray-300`, `gray-400`
- Success: `green-900`, `green-700`, `green-400`
- Error: `red-900`, `red-700`, `red-400`
- Warning: `amber-900`, `amber-700`, `amber-400`
- Info: `blue-900`, `blue-700`, `blue-400`

## Troubleshooting

**Toast not showing?**
- Make sure you're using `useToast()` inside a component
- Component must be a child of ToastProvider (through Providers)
- Check browser console for errors

**API errors not showing?**
- Use `apiClient` not `fetch` directly
- API response must have `message` or `error` field (for non-HTTP errors)
- Check that NEXT_PUBLIC_API_URL is set correctly

**Error boundary not working?**
- Only catches render-time errors, not async errors
- Use try-catch in async functions instead
- For promises, handle errors in `.catch()` or try-catch

## Next Steps

1. Replace `fetch()` calls with `apiClient` methods
2. Use `useToast()` for user feedback
3. Test error scenarios (network errors, 401, 500)
4. (Optional) Configure Sentry in ErrorBoundary.tsx
5. (Optional) Customize toast colors/animations in Toast.tsx

For detailed docs, see `TOAST_AND_ERROR_SYSTEM.md`
