# EPO Tracker SaaS Frontend - Startup Guide

## Quick Start

This is a fully functional Next.js 14 frontend for the EPO Tracker SaaS platform, built with the skylit.ai aesthetic.

### Prerequisites
- Node.js 18+ installed
- Backend API running on http://localhost:8000
- Port 3000 available for the frontend

### Installation & Running

```bash
# Install dependencies
npm install

# Start the development server
npm run dev

# Open http://localhost:3000 in your browser
```

The dev server will be available at **http://localhost:3000**

## Project Structure

```
src/
├── app/
│   ├── layout.tsx          # Root layout with sidebar & topbar
│   ├── page.tsx            # Dashboard page
│   ├── epos/
│   │   └── page.tsx        # EPOs list & filtering
│   ├── analytics/
│   │   └── page.tsx        # Analytics dashboards
│   ├── integrations/
│   │   └── page.tsx        # Integration management
│   └── settings/
│       └── page.tsx        # Settings & preferences
├── components/
│   ├── Sidebar.tsx         # Navigation sidebar
│   ├── Topbar.tsx          # Top search bar & status
│   └── DemoControls.tsx    # Demo controls (floating panel)
├── lib/
│   └── api.ts              # API client functions
├── globals.css             # Global styles & Tailwind
└── layout.tsx              # Root HTML layout

```

## Key Features

### Pages
- **Dashboard**: KPI metrics, revenue trend chart, status breakdown, monthly volume
- **EPOs**: Filterable EPO table with search, status badges, age indicators, follow-up alerts
- **Analytics**: Community capture rates, vendor performance metrics
- **Integrations**: Integration cards with active/inactive status and configure buttons
- **Settings**: Account, notification, and billing settings

### Components
- **Sidebar**: Navigation with active state, user profile
- **Topbar**: Search input, email sync status, notifications
- **DemoControls**: Floating panel (bottom-right) for demo actions
  - Toggle with Ctrl+D
  - Simulate Email button (realistic construction EPO)
  - Seed Data and Reset buttons
  - Toast notifications for feedback

### Design
- Dark theme (#0a0a0a background)
- DM Sans font for UI, Roboto Mono for numbers/dates/IDs
- Custom color palette: green (success), amber (warning), red (alert), purple (accent)
- No shadows, no gradients, clean cards with 1px borders
- Responsive grid layouts

## API Integration

The frontend expects these endpoints on http://localhost:8000:

- `GET /api/epos` - Get list of EPOs
- `GET /api/stats` - Get dashboard statistics
- `GET /api/communities` - Get community analytics
- `GET /api/vendors` - Get vendor analytics
- `POST /api/demo/simulate-email` - Simulate incoming EPO email
- `POST /api/demo/seed` - Seed demo data
- `POST /api/demo/reset` - Reset all data

See `/src/lib/api.ts` for full API client implementation.

## Demo Controls (Ctrl+D)

The floating demo panel in the bottom-right corner provides:

1. **Simulate Email**: Sends a realistic construction EPO email
   - Subject: "EPO - Touch up paint needed Lot 142 Mallard Park"
   - Amount: $285 from Summit Builders
   - Shows toast notification with parsed EPO details

2. **Seed Data**: Populates the system with realistic demo data
   - Multiple EPOs across different communities and vendors
   - Various statuses (confirmed, pending, denied, discount)

3. **Reset**: Clears all data from the system

## Building for Production

```bash
# Build the production bundle
npm run build

# Start production server
npm start
```

## Tailwind Configuration

Custom color tokens in `tailwind.config.ts`:
- `bg`: #0a0a0a (background)
- `surface`: rgba(255,255,255,0.04)
- `card`: rgba(255,255,255,0.06)
- `text1`, `text2`, `text3`: Text hierarchy
- `green`, `amber`, `red`, `purple`: Status colors
- Custom variants: `-dim`, `-bdr` for colored backgrounds & borders

## Styling Guidelines

- **Cards**: `.card` class provides base styling
- **Buttons**: `.btn-primary` (white/black) and `.btn-secondary` (transparent border)
- **Labels**: `.label` for uppercase metadata text
- **Numbers/Dates**: Always use Roboto Mono font (`.mono` class)
- **No shadows or gradients** - keep it minimal and flat

## Keyboard Shortcuts

- `Ctrl+D`: Toggle demo controls panel

## Notes for Demo Video

The application is fully functional and ready for LinkedIn video demo:
- All pages are connected and navigate properly
- Data refreshes automatically after demo actions
- Toast notifications provide clear feedback
- The demo controls panel is non-intrusive (toggleable with Ctrl+D)
- All UI elements use the skylit.ai design language
- Responsive and clean aesthetic

## Troubleshooting

**Build takes too long?**
- The first build can be slow. Subsequent builds are faster.
- Use `npm run dev` for development - it's much faster with hot reload.

**Frontend can't connect to API?**
- Ensure backend is running on http://localhost:8000
- Check browser console for CORS errors
- API functions in `src/lib/api.ts` have built-in error handling

**Port 3000 already in use?**
- Run on a different port: `npm run dev -- -p 3001`

## Files Reference

| File | Purpose |
|------|---------|
| `src/app/layout.tsx` | Root HTML structure, sidebar, topbar |
| `src/app/page.tsx` | Dashboard with charts and KPIs |
| `src/app/epos/page.tsx` | EPO management table |
| `src/app/analytics/page.tsx` | Analytics dashboards |
| `src/app/integrations/page.tsx` | Integration management |
| `src/app/settings/page.tsx` | Settings & preferences |
| `src/components/Sidebar.tsx` | Navigation sidebar |
| `src/components/Topbar.tsx` | Top bar with search |
| `src/components/DemoControls.tsx` | Demo floating panel |
| `src/lib/api.ts` | API client functions |
| `src/globals.css` | Global styles |
| `tailwind.config.ts` | Tailwind theme config |

---

**Built with Next.js 14, Tailwind CSS, Recharts, and Lucide Icons**
