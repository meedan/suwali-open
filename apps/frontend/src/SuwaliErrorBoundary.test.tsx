import { IntlProvider } from 'react-intl';
import { MemoryRouter, Route, Routes } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import * as Sentry from '@sentry/react';
import { onlineManager } from '@tanstack/react-query';
import { act, fireEvent, render, screen } from '@testing-library/react';

import { HttpError, NetworkError } from '@root/NetworkLayer';
import SuwaliErrorBoundary from '@root/SuwaliErrorBoundary';

vi.mock('@sentry/react', () => ({ captureReactException: vi.fn() }));

const Throws = ({ error }: { error: Error }) => {
  throw error;
};

let networkDown = false;
const NeedsNetwork = () => {
  if (networkDown) throw new NetworkError();
  return <p>Loaded</p>;
};

const renderAt = (error: Error) =>
  render(
    <MemoryRouter initialEntries={['/broken']}>
      <IntlProvider locale="en" messages={{}}>
        <SuwaliErrorBoundary>
          <Routes>
            <Route path="/broken" element={<Throws error={error} />} />
            <Route path="/dashboard" element={<p>Dashboard</p>} />
          </Routes>
        </SuwaliErrorBoundary>
      </IntlProvider>
    </MemoryRouter>
  );

describe('SuwaliErrorBoundary', () => {
  beforeEach(() => {
    vi.mocked(Sentry.captureReactException).mockClear();
    // React reports every error a boundary catches to console.error, which the test setup turns into a failure
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.spyOn(console, 'log').mockImplementation(() => {});
  });

  it.each([404, 403])('renders the not available page for a %i without reporting it', (status) => {
    renderAt(new HttpError(status, {}, new Headers()));

    expect(screen.getByText('This content is not available')).toBeInTheDocument();
    expect(Sentry.captureReactException).not.toHaveBeenCalled();
  });

  it('renders the fallback and reports any other error', () => {
    renderAt(new HttpError(500, {}, new Headers()));

    expect(screen.getByText('That didn’t work as expected')).toBeInTheDocument();
    expect(Sentry.captureReactException).toHaveBeenCalled();
  });

  it('clears the error once the user navigates away', () => {
    renderAt(new HttpError(404, {}, new Headers()));

    fireEvent.click(screen.getByRole('button', { name: 'Back to dashboard' }));

    expect(screen.getByText('Dashboard')).toBeInTheDocument();
  });

  it('renders the page again once the connection is back', () => {
    networkDown = true;
    render(
      <MemoryRouter>
        <IntlProvider locale="en" messages={{}}>
          <SuwaliErrorBoundary>
            <NeedsNetwork />
          </SuwaliErrorBoundary>
        </IntlProvider>
      </MemoryRouter>
    );
    expect(screen.getByText('That didn’t work as expected')).toBeInTheDocument();

    act(() => onlineManager.setOnline(false));
    networkDown = false;
    act(() => onlineManager.setOnline(true));

    expect(screen.getByText('Loaded')).toBeInTheDocument();
  });
});
