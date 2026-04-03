# EPO Tracker SaaS - Frontend Application

A professional, fully-functional Next.js 14 frontend for an EPO (Equipment Purchase Order) tracking system designed for construction companies. Built with the skylit.ai aesthetic and designed for demo video presentation.

## Quick Start

```bash
cd /sessions/ecstatic-vigilant-ramanujan/mnt/work/epo-saas/frontend
npm install  # Already done
npm run dev
# Open http://localhost:3000
```

## Features

### 5 Complete Pages
- **Dashboard**: KPI metrics, revenue trends, status breakdown, monthly volume
- **EPOs**: Filterable table with search, status badges, age indicators, follow-up alerts
- **Analytics**: Community capture rates, vendor performance metrics
- **Integrations**: Integration management with active/inactive status
- **Settings**: Account, notifications, billing, and preferences

### 3 Reusable Components
- **Sidebar**: Navigation with active states, user profile
- **Topbar**: Search bar, email sync status, notifications
- **DemoControls**: Floating panel (Ctrl+D) for email simulation and demo data management

### Demo Features
- Press **Ctrl+D** to open demo controls
- **Simulate Email**: Send realistic construction EPO, get toast notification
- **Seed Data**: Populate with demo data
- **Reset**: Clear all data

## Technology Stack

- **Next.js 14.2** - React framework with App Router
- **TypeScript 5.3** - Type-safe development
- **Tailwind CSS 3.4** - Utility-first styling
- **Recharts 3.8** - Professional charts
- **Lucide React 1.7** - Clean icon library
- **Google Fonts** - DM Sans (UI) + Roboto Mono (numbers)

## Design Language

Strictly adheres to the skylit.ai aesthetic:
- Dark theme with #0a0a0a background
- Exact color tokens (green, amber, red, purple with variants)
- No shadows or gradients
- 12px border radius, 1px borders
- Backdrop blur effects
- Responsive grid layouts
- Clear text hierarchy

## Project Structure

```
src/
├── app/
│   ├── layout.tsx              # Root layout with sidebar & topbar
│   ├── page.tsx                # Dashboard
│   ├── epos/page.tsx           # EPO management
│   ├── analytics/page.tsx      # Analytics dashboards
│   ├── integrations/page.tsx   # Integration management
│   └── settings/page.tsx       # Settings
├── components/
│   ├── Sidebar.tsx             # Navigation
│   ├── Topbar.tsx              # Search & status
│   └── DemoControls.tsx        # Demo floating panel
├── lib/
│   └── api.ts                  # API client (7 functions)
└── globals.css                 # Global styles
```

## API Integration

The frontend connects to a backend at `http://localhost:8000`. Required endpoints:

```
GET    /api/epos
GET    /api/stats
GET    /api/communities
GET    /api/vendors
POST   /api/demo/simulate-email
POST   /api/demo/seed
POST   /api/demo/reset
```

All API calls have error handling with fallback demo data.

## Key Files

| File | Purpose |
|------|---------|
| `src/app/layout.tsx` | Root HTML structure |
| `src/app/page.tsx` | Dashboard with KPIs & charts |
| `src/app/epos/page.tsx` | EPO table & filtering |
| `src/components/DemoControls.tsx` | Demo floating panel |
| `tailwind.config.ts` | Color palette & theme |
| `src/lib/api.ts` | API client functions |

## Development

### Run Dev Server
```bash
npm run dev  # http://localhost:3000 with hot reload
```

### Build for Production
```bash
npm run build
npm start    # Start production server
```

### Add a New Page
1. Create `/src/app/[page-name]/page.tsx`
2. Add link to Sidebar navigation
3. Use existing pages as reference

### Styling Guidelines
- Use `.card` class for containers
- Use `.label` for metadata text
- Use `.font-mono` for numbers/dates
- Use color tokens: `text1`, `text2`, `text3`, `green`, `amber`, `red`
- Never use shadows, gradients, or hardcoded colors

## Demo Controls (Ctrl+D)

The floating demo panel provides:
- **Simulate Email**: Send realistic EPO email (Lot 142, $285, Summit Builders)
- **Seed Data**: Populate with demo data
- **Reset**: Clear all data

Toast notifications appear for feedback.

## Responsive Design

- Mobile-first approach
- Grid-based layouts
- Sidebar collapses/adapts on small screens
- All components responsive

## Type Safety

Full TypeScript support with:
- Strict mode enabled
- All API types defined
- Component prop types
- No `any` types

## Performance

- Optimized Tailwind CSS (only used classes)
- Next.js 14 image optimization
- Recharts optimized for performance
- Client-side data fetching with caching
- Fast hot reload in development

## Browser Support

- Modern browsers (Chrome, Firefox, Safari, Edge)
- No IE11 support
- Requires JavaScript enabled

## Documentation Files

- `STARTUP.md` - Quick start guide
- `BUILD_SUMMARY.md` - Complete overview
- `DEVELOPMENT.md` - Development patterns
- `DEPLOY_READY.txt` - Deployment checklist
- `FILES.md` - File reference guide

## Troubleshooting

### Port 3000 in use?
```bash
npm run dev -- -p 3001
```

### Backend not responding?
- Ensure backend is running on `http://localhost:8000`
- Check browser console for CORS errors
- All API functions have error handling

### TypeScript errors?
- Run `npm run build` to see all errors
- Check TypeScript version: `npm ls typescript`

## Production Deployment

1. Build: `npm run build`
2. Start: `npm start`
3. Backend must be accessible from frontend
4. Set environment variables as needed

## Contributing

When adding features:
1. Follow the skylit.ai design language
2. Use TypeScript for new code
3. Add types for all functions
4. Test on multiple screen sizes
5. Check browser console for errors

## License

Built for EPO Tracker SaaS product.

---

**Status**: Complete & Ready for Demo

Built with Next.js 14, React 18, TypeScript, and Tailwind CSS.
All requirements met. Production-ready application.

For detailed setup instructions, see `STARTUP.md`.
For development guide, see `DEVELOPMENT.md`.
