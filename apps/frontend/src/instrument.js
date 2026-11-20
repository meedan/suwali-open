import * as Sentry from "@sentry/react";
import Config from './Config';

const apiBaseUrl = Config.get('VITE_API_BASE_URL', 'http://localhost:3000/api');

Sentry.init({
  dsn: Config.get('VITE_SENTRY_DSN'),
  environment: Config.get('VITE_SENTRY_ENV', 'local'),
  release: Config.get('VITE_SENTRY_RELEASE'),
  sendDefaultPii: false,
  integrations: [
    Sentry.browserTracingIntegration(),
    Sentry.replayIntegration(),
  ],
  enableLogs: true,
  tracesSampleRate: 0.2,
  tracePropagationTargets: [apiBaseUrl],
  replaysSessionSampleRate: 0.1,
  replaysOnErrorSampleRate: 1.0,
});
