import * as Sentry from "@sentry/nextjs";

const SENTRY_DSN = process.env.NEXT_PUBLIC_SENTRY_DSN;

export function initSentry() {
  if (SENTRY_DSN) {
    Sentry.init({
      dsn: SENTRY_DSN,
      environment: process.env.NODE_ENV,
      tracesSampleRate: process.env.NODE_ENV === "production" ? 0.2 : 1.0,
      replaysSessionSampleRate: 0,
      replaysOnErrorSampleRate: process.env.NODE_ENV === "production" ? 1.0 : 0,
      beforeSend(event) {
        // Scrub sensitive data
        if (event.request?.headers) {
          delete event.request.headers["Authorization"];
        }
        return event;
      },
    });
  }
}

export { Sentry };
