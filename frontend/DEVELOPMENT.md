# Development Guide - EPO Tracker Frontend

## Quick Commands

```bash
# Start development server (with hot reload)
npm run dev

# Build for production
npm run build

# Start production server
npm start

# Install new package
npm install <package-name>
```

Development server runs on **http://localhost:3000** with auto-reload on file changes.

## Adding New Features

### Adding a New Page

1. Create a new directory in `src/app/[feature-name]/`
2. Create `page.tsx` with your component
3. Add navigation item to `src/components/Sidebar.tsx`

```tsx
// src/app/[feature]/page.tsx
"use client";

import { useState, useEffect } from "react";

export default function FeaturePage() {
  return (
    <div className="p-8 space-y-6">
      {/* Your content */}
    </div>
  );
}
```

### Adding a New Component

1. Create `src/components/[ComponentName].tsx`
2. Mark as client component with `"use client"` if it needs state/hooks
3. Import in layout or page

```tsx
// src/components/MyComponent.tsx
"use client";

export function MyComponent() {
  return <div className="card p-6">{/* content */}</div>;
}
```

### Using the Card Style

All major containers use the `.card` class:

```tsx
<div className="card p-6">
  <h3 className="label mb-4">Title</h3>
  {/* Content */}
</div>
```

### Using Color Tokens

```tsx
// Status colors
<div className="text-green bg-green-dim border border-green-bdr">
  Active
</div>

// Different colors
<div className="text-amber">Warning</div>
<div className="text-red">Error</div>
<div className="text-purple">Special</div>
```

### Using Typography

```tsx
// Labels (metadata, uppercase)
<p className="label">YOUR LABEL</p>

// Numbers and dates (always use mono)
<span className="font-mono font-semibold">$1,250.50</span>
<span className="font-mono text-sm">Apr 3, 2026</span>

// Primary text
<p className="text-text1">Main content</p>

// Secondary text
<p className="text-text2">Supporting text</p>

// Muted text
<p className="text-text3">Hint text</p>
```

### Using Charts (Recharts)

```tsx
import {
  AreaChart,
  Area,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from "recharts";

<ResponsiveContainer width="100%" height={300}>
  <AreaChart data={data}>
    <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.08)" />
    <XAxis dataKey="name" stroke="rgba(255,255,255,0.30)" />
    <YAxis stroke="rgba(255,255,255,0.30)" />
    <Tooltip
      contentStyle={{
        background: "rgba(255,255,255,0.06)",
        border: "1px solid rgba(255,255,255,0.08)",
        borderRadius: "8px",
      }}
    />
    <Area type="monotone" dataKey="value" stroke="rgb(52,211,153)" />
  </AreaChart>
</ResponsiveContainer>
```

### Using Lucide Icons

```tsx
import { Mail, Bell, AlertCircle, TrendingUp } from "lucide-react";

<Mail size={20} className="text-green" />
<Bell size={20} />
<AlertCircle size={20} className="text-red" />
<TrendingUp size={16} />
```

## API Integration

All API calls go through `src/lib/api.ts`:

```tsx
import { getEPOs, getStats, simulateEmail } from "@/lib/api";

// In a component
const [epos, setEpos] = useState([]);

useEffect(() => {
  getEPOs().then(setEpos);
}, []);

// Simulate email
await simulateEmail(subject, body);
```

### Adding New API Functions

```tsx
// src/lib/api.ts
export async function myNewFunction(param: string): Promise<MyType> {
  try {
    const response = await fetch(`${API_BASE}/api/endpoint`, {
      method: "GET",
      headers: { "Content-Type": "application/json" },
    });
    if (!response.ok) return getDefault();
    return await response.json();
  } catch (error) {
    console.error("Failed:", error);
    return getDefault();
  }
}
```

## Common Patterns

### Loading Data

```tsx
const [data, setData] = useState<DataType[]>([]);
const [loading, setLoading] = useState(true);

useEffect(() => {
  const load = async () => {
    const result = await getEPOs();
    setData(result);
    setLoading(false);
  };
  load();
}, []);

return loading ? <div>Loading...</div> : <div>{/* content */}</div>;
```

### Filter & Search

```tsx
const [search, setSearch] = useState("");
const [filter, setFilter] = useState("all");

const filtered = data.filter((item) => {
  if (filter !== "all" && item.type !== filter) return false;
  if (search && !item.name.includes(search)) return false;
  return true;
});
```

### Button Styles

```tsx
// Primary button (white background)
<button className="btn-primary">Action</button>

// Secondary button (transparent with border)
<button className="btn-secondary">Cancel</button>

// Icon button
<button className="text-text2 hover:text-text1">
  <Mail size={20} />
</button>

// Disabled state
<button className="btn-primary disabled:opacity-50">
  Loading...
</button>
```

### Responsive Grid

```tsx
// Two columns on desktop, one on mobile
<div className="grid grid-cols-2 gap-6">
  <div>Column 1</div>
  <div>Column 2</div>
</div>

// Three columns with proper spacing
<div className="grid grid-cols-3 gap-6">
  <div>Card</div>
</div>
```

### Toast Notifications

```tsx
// In DemoControls, use the pattern:
const [toasts, setToasts] = useState<Toast[]>([]);

const showToast = (message: string, type: "success" | "error") => {
  const id = Math.random().toString();
  setToasts((prev) => [...prev, { id, message, type }]);
  setTimeout(() => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, 4000);
};

showToast("Success!", "success");
```

## Styling Tips

### Never Do This
- Don't use shadow classes (shadow-lg, etc.)
- Don't use gradient classes
- Don't use rounded-full with bright colors
- Don't hardcode colors outside the palette
- Don't use text-white or text-black directly

### Always Do This
- Use `.card` for containers
- Use `.label` for metadata text
- Use `.font-mono` for numbers/dates/IDs
- Use the color tokens: `text1`, `text2`, `text3`, `green`, `amber`, etc.
- Use `bg-[color]-dim` for background tints
- Use `border-[color]-bdr` for colored borders
- Keep things minimal and flat

## Tailwind Configuration

Custom tokens are in `tailwind.config.ts`:

```ts
colors: {
  bg: "#0a0a0a",
  surface: "rgba(255,255,255,0.04)",
  card: "rgba(255,255,255,0.06)",
  text1: "rgba(255,255,255,0.85)",
  text2: "rgba(255,255,255,0.50)",
  text3: "rgba(255,255,255,0.30)",
  green: "rgb(52,211,153)",
  // ... etc
}
```

Use these in className:
```tsx
<div className="bg-card text-text1">content</div>
<div className="border border-border-lt">bordered</div>
```

## Debugging

### Check Console
Browser DevTools console shows API errors and warnings.

### Check Network Tab
Verify API calls are reaching `http://localhost:8000`

### TypeScript Errors
All `.tsx` files are type-checked. Hover over red squiggles to see issues.

### CSS Issues
Use browser DevTools Inspector to check computed styles.

## Performance Tips

1. Use `useState` for component-level state
2. Use `useEffect` for side effects (API calls)
3. Memoize expensive components with `React.memo` if needed
4. Lazy-load heavy components with `dynamic()`
5. Use Next.js Image component for images

## Before Committing

```bash
# Check for TypeScript errors (happens automatically on build)
npm run build

# Then git commit
git add .
git commit -m "Feature: description"
```

## Useful Resources

- [Next.js Docs](https://nextjs.org/docs)
- [Tailwind CSS Docs](https://tailwindcss.com/docs)
- [Recharts Docs](https://recharts.org/)
- [Lucide Icons](https://lucide.dev/)
- [React Hooks](https://react.dev/reference/react/hooks)

## Getting Help

1. Check browser console for errors
2. Check Network tab for API issues
3. Verify backend is running on http://localhost:8000
4. Check if imports are correct
5. Restart dev server: Ctrl+C and `npm run dev`

---

Happy coding! Keep the design minimal and the code clean.
