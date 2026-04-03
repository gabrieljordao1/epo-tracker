# EPO Tracker Frontend - Complete File Reference

## Project Root
```
/sessions/ecstatic-vigilant-ramanujan/mnt/work/epo-saas/frontend/
```

## Source Code Files

### App Pages
- `/src/app/layout.tsx` - Root layout with sidebar, topbar, metadata
- `/src/app/page.tsx` - Dashboard with metrics, charts, and analytics
- `/src/app/epos/page.tsx` - EPO management table with filters
- `/src/app/analytics/page.tsx` - Community and vendor analytics
- `/src/app/integrations/page.tsx` - Integration management
- `/src/app/settings/page.tsx` - Settings and preferences

### Components
- `/src/components/Sidebar.tsx` - Navigation sidebar
- `/src/components/Topbar.tsx` - Top search and status bar
- `/src/components/DemoControls.tsx` - Demo floating panel (Ctrl+D)

### Utilities
- `/src/lib/api.ts` - API client functions

### Styles
- `/src/globals.css` - Global styles, fonts, base CSS

## Configuration Files

- `/tailwind.config.ts` - Tailwind CSS theme with custom colors
- `/next.config.mjs` - Next.js configuration
- `/tsconfig.json` - TypeScript configuration
- `/postcss.config.mjs` - PostCSS configuration
- `/package.json` - Dependencies and scripts
- `/.gitignore` - Git ignore rules
- `/.env.example` - Environment variables template

## Documentation Files

- `/STARTUP.md` - Quick start guide
- `/BUILD_SUMMARY.md` - Complete build overview
- `/DEVELOPMENT.md` - Development patterns and examples
- `/DEPLOY_READY.txt` - Deployment checklist
- `/FILES.md` - This file

## Key Files by Purpose

### To Run the App
1. `/package.json` - Read scripts section
2. `/src/app/layout.tsx` - Root structure
3. `/src/components/Sidebar.tsx` - Navigation
4. `/src/components/Topbar.tsx` - Search & status

### To Understand the API
- `/src/lib/api.ts` - All API functions defined here

### To See the UI Design
- `/tailwind.config.ts` - Color palette tokens
- `/src/globals.css` - Base styles and utilities

### For Each Feature
- Dashboard: `/src/app/page.tsx`
- EPOs: `/src/app/epos/page.tsx`
- Analytics: `/src/app/analytics/page.tsx`
- Integrations: `/src/app/integrations/page.tsx`
- Settings: `/src/app/settings/page.tsx`

## Build Output

After running `npm run build`, these directories are created:
- `/.next/` - Next.js build output
- `/out/` - If exported (not applicable here)

## Dependencies

All dependencies are in `/node_modules/` (not in git, recreated with `npm install`)

Main packages:
- `next@14.2.35`
- `react@18.2.0`
- `react-dom@18.2.0`
- `tailwindcss@3.4.0`
- `recharts@3.8.1`
- `lucide-react@1.7.0`
- `typescript@5.3.0`

## Quick File Lookup

### If you need to...

**Change colors**: `/tailwind.config.ts`
**Update fonts**: `/src/globals.css` and `/tailwind.config.ts`
**Modify API base URL**: `/src/lib/api.ts` (line 1)
**Add a new page**: Create `/src/app/[page-name]/page.tsx`
**Add a new component**: Create `/src/components/[ComponentName].tsx`
**Change sidebar links**: `/src/components/Sidebar.tsx`
**Change demo controls**: `/src/components/DemoControls.tsx`
**Add new chart**: Use `/src/app/page.tsx` as reference
**Modify dashboard**: `/src/app/page.tsx`
**Modify EPO table**: `/src/app/epos/page.tsx`

## Environment Setup

1. Copy `.env.example` to `.env.local` if needed
2. Default API base is `http://localhost:8000`
3. Frontend runs on `http://localhost:3000`

## Type Definitions

All TypeScript types are in:
- `/src/lib/api.ts` - EPO, Stats, Community, Vendor types
- Individual components have inline types

## Styling Classes

Custom utility classes available everywhere:
- `.card` - Card container styling
- `.label` - Uppercase metadata text
- `.mono` - Roboto Mono font
- `.btn-primary` - White button with black text
- `.btn-secondary` - Transparent button with border
- `.status-badge` - Status indicator styling

Color classes:
- `.text-text1`, `.text-text2`, `.text-text3` - Text colors
- `.bg-surface`, `.bg-card` - Background colors
- `.border-card-border`, `.border-border-lt` - Border colors
- `.text-green`, `.text-amber`, `.text-red`, `.text-purple` - Status colors
- `.bg-green-dim`, `.border-green-bdr` - Status variants

## Static Assets

No static assets currently needed. Google Fonts loads from CDN via `/src/globals.css`.

If you need to add images:
1. Create `/public/` directory
2. Place images there
3. Import or reference in code

## Testing the Build

Quick validation:
1. Run `npm run dev` and open http://localhost:3000
2. Navigate to all pages using sidebar
3. Test demo controls with Ctrl+D
4. Check browser console for errors

## File Sizes (Approximate)

- `/src/app/page.tsx` - 4.2 KB
- `/src/app/epos/page.tsx` - 4.1 KB
- `/src/components/DemoControls.tsx` - 3.5 KB
- `/src/components/Sidebar.tsx` - 2.8 KB
- `/src/lib/api.ts` - 2.6 KB
- Total source code: ~25 KB
- With node_modules: ~500 MB

---

All files are well-organized and ready for production deployment.
