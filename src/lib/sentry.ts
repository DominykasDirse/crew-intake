// Crash reporting. Inert without EXPO_PUBLIC_SENTRY_DSN (Q15). Four pilot people will not
// report crashes; this does.
import * as Sentry from '@sentry/react-native';

const dsn = process.env.EXPO_PUBLIC_SENTRY_DSN;

if (dsn) {
  Sentry.init({
    dsn,
    enableAutoSessionTracking: true,
    tracesSampleRate: 0.1,
    sendDefaultPii: false, // no emails, no IPs in events
  });
}

export const sentryEnabled = !!dsn;
export function wrapRoot<P extends Record<string, unknown>>(
  component: React.ComponentType<P>,
): React.ComponentType<P> {
  return dsn ? Sentry.wrap(component) : component;
}
export const setSentryUser = (id: string | null) => {
  if (dsn) Sentry.setUser(id ? { id } : null);
};
