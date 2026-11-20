import { Toast, Tooltip } from "radix-ui";
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router';
import * as Sentry from "@sentry/react";
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ReactQueryDevtools } from '@tanstack/react-query-devtools';

import { DEFAULT_QUERY_STALE_TIME } from "@constants/App.tsx";

import { isUnavailableError, retryUnlessClientError } from '@helpers/http';
import { WORDPRESS_AUTHORIZED_PATH } from '@helpers/wordpressAuthorization';

import { ToastProvider } from '@hooks/useToast.tsx'

import { CapabilitiesProvider } from '@components/CapabilitiesProvider.tsx';
import ConnectivityBanner from '@components/ConnectivityBanner.tsx';
import { I18nProvider } from '@components/LanguageProvider.tsx';
import { ThemeProvider } from '@components/ThemeProvider.tsx'

import WordpressAuthorized from '@pages/WordpressAuthorized.tsx';

import { App } from './App.tsx'
import Fallback from './layouts/error/Fallback.tsx';
import { NetworkError } from './NetworkLayer.ts';
import SessionProvider from './SessionContext.tsx';
import SuwaliErrorBoundary from './SuwaliErrorBoundary.tsx';

import "./instrument";
import "./prism-setup";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: DEFAULT_QUERY_STALE_TIME,
      // A default, not a per-query option: queries like /hubs/:id are observed from many places and
      // react-query lets whichever observer subscribes first decide the retry behavior.
      retry: retryUnlessClientError,
    },
  },
});

const reportCaughtError = Sentry.reactErrorHandler();

createRoot(document.getElementById('root')!, {
  onUncaughtError: Sentry.reactErrorHandler((error, errorInfo) => {
    console.warn('Uncaught error', error, errorInfo.componentStack);
  }),
  // React calls this for every error a boundary catches. A missing or inaccessible record is an
  // expected outcome that the boundary renders as the not-available page, so it is not reported;
  // nor is a lost connection, which is not a bug.
  onCaughtError: (error, errorInfo) => {
    if (!isUnavailableError(error) && !(error instanceof NetworkError)) reportCaughtError(error, errorInfo);
  },
  onRecoverableError: Sentry.reactErrorHandler(),
}).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      {import.meta.env.VITE_REACT_QUERY_DEVTOOLS !== 'false' && <ReactQueryDevtools />}
      <I18nProvider>
        <BrowserRouter>
          <ConnectivityBanner />
          <SuwaliErrorBoundary fallback={<Fallback actions={['tryAgain', 'backHome', 'contactSupport']} />}>
            <ThemeProvider defaultTheme="system" storageKey="theme">
              <SessionProvider>
                <CapabilitiesProvider>
                  <Tooltip.Provider delayDuration={700} skipDelayDuration={2000}>
                    <Toast.Provider duration={5000}>
                      <ToastProvider>
                        {window.location.pathname === WORDPRESS_AUTHORIZED_PATH ? <WordpressAuthorized /> : <App />}
                      </ToastProvider>
                      <Toast.Viewport className="toast-viewport" />
                    </Toast.Provider>
                  </Tooltip.Provider>
                </CapabilitiesProvider>
              </SessionProvider>
            </ThemeProvider>
          </SuwaliErrorBoundary>
        </BrowserRouter>
      </I18nProvider>
    </QueryClientProvider>
  </StrictMode>,
);
