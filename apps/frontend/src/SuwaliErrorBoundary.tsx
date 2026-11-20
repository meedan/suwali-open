import React, { type ErrorInfo } from 'react';
import { useLocation } from 'react-router';
import * as Sentry from "@sentry/react";
import { useQueryErrorResetBoundary } from '@tanstack/react-query';

import { isUnavailableError } from '@helpers/http';

import { NetworkError } from '@root/NetworkLayer';

import { useConnectivity } from '@hooks/useConnectivity';

import Fallback from '@layouts/error/Fallback';
import NotFound from '@layouts/error/NotFound';

type SuwaliErrorBoundaryProps = {
  children?: React.ReactNode;
  fallback?: React.ReactNode;
};

type ErrorBoundaryProps = SuwaliErrorBoundaryProps & {
  connected: boolean;
  onReset: () => void;
  pathname: string;
};

type ErrorBoundaryState = {
  error: unknown;
  hasError: boolean;
};

class ErrorBoundary extends React.Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = { error: null, hasError: false };
  }

  static getDerivedStateFromError(error: unknown): ErrorBoundaryState {
    return { error, hasError: true };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    if (import.meta.env.DEV) {
      console.log(error);
    }

    // A missing or inaccessible record, or a lost connection, is an expected outcome, not a bug worth reporting
    if (isUnavailableError(error) || error instanceof NetworkError) return;

    Sentry.captureReactException(error, info);
  }

  componentDidUpdate(prevProps: ErrorBoundaryProps) {
    // Boundaries in layouts stay mounted across routes, so clear the error once the user navigates away
    if (this.state.hasError && prevProps.pathname !== this.props.pathname) {
      this.setState({ error: null, hasError: false });
    }

    // A page that failed for lack of a connection can load now that it's back
    if (this.state.hasError && this.state.error instanceof NetworkError && !prevProps.connected && this.props.connected) {
      this.props.onReset();
      this.setState({ error: null, hasError: false });
    }
  }

  render() {
    if (this.state.hasError) {
      if (isUnavailableError(this.state.error)) {
        return <NotFound />;
      }

      return this.props.fallback || <Fallback actions={['tryAgain', 'contactSupport']} />;
    }

    return this.props.children;
  }
}

// Queries opt in with `throwOnError: isUnavailableError` to have a 404/403 rendered as the
// not-available page here, rather than every page checking the error and rendering it itself.
const SuwaliErrorBoundary = (props: SuwaliErrorBoundaryProps) => {
  const { pathname } = useLocation();
  const { connected } = useConnectivity();
  // Without this, a remounted throwOnError query rethrows its cached error instead of refetching
  const { reset } = useQueryErrorResetBoundary();
  return <ErrorBoundary {...props} connected={connected} onReset={reset} pathname={pathname} />;
};

export default SuwaliErrorBoundary;
