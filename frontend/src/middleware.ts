import { NextRequest, NextResponse } from "next/server";

export function middleware(request: NextRequest) {
  const { pathname, hostname } = request.nextUrl;

  // Determine if this is the main onyxepos.com domain
  const isMainDomain =
    hostname === "onyxepos.com" ||
    hostname === "www.onyxepos.com";

  // If on main domain, redirect to early access page (with exceptions)
  if (isMainDomain) {
    // Allow these routes to pass through
    const allowedRoutes = [
      "/early-access",
      "/api/waitlist",
      "/_next/",
      "/favicon.ico",
      "/favicon.svg",
      "/favicon-32.png",
      "/icon-192.png",
      "/onyx-logo.svg",
    ];

    const isAllowed = allowedRoutes.some(route => {
      if (route.endsWith("/")) {
        return pathname.startsWith(route);
      }
      return pathname === route;
    });

    if (!isAllowed) {
      // Redirect all other routes to early access page
      const url = request.nextUrl.clone();
      url.pathname = "/early-access";
      return NextResponse.redirect(url);
    }
  }

  // For all other cases (localhost, frontend-two-puce-27.vercel.app, etc.), let everything through
  return NextResponse.next();
}

export const config = {
  matcher: [
    // Apply middleware to all routes except static files
    "/((?!_next/static|_next/image|favicon\\.ico|favicon\\.svg|favicon-32\\.png|icon-192\\.png|onyx-logo\\.svg).*)",
  ],
};
