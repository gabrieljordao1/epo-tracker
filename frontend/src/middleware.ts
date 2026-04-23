import { NextRequest, NextResponse } from "next/server";

/** Routes that don't require authentication */
const PUBLIC_ROUTES = ["/login", "/vendor", "/early-access", "/reset-password"];

/** Static assets and API routes that should always pass through */
const STATIC_ROUTES = [
  "/_next/",
  "/favicon.ico",
  "/favicon.svg",
  "/favicon-32.png",
  "/icon-192.png",
  "/onyx-logo.svg",
];

export function middleware(request: NextRequest) {
  const { pathname, hostname } = request.nextUrl;

  // Always allow static assets
  if (STATIC_ROUTES.some((route) => pathname.startsWith(route))) {
    return NextResponse.next();
  }

  // ── Auth guard for all domains ──
  const isPublicRoute = PUBLIC_ROUTES.some((route) =>
    pathname.startsWith(route)
  );
  if (isPublicRoute) {
    return NextResponse.next();
  }

  // Check for auth cookie (set by setAuthToken in api.ts on login)
  const hasAuth = request.cookies.has("epo_auth");
  if (!hasAuth) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    return NextResponse.redirect(url);
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    // Apply to all routes except static files and API routes
    "/((?!_next/static|_next/image|api/|favicon\\.ico|favicon\\.svg|favicon-32\\.png|icon-192\\.png|onyx-logo\\.svg).*)",
  ],
};
