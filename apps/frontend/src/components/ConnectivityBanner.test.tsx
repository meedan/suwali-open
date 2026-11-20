import { IntlProvider } from 'react-intl';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { onlineManager, QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, render, screen } from '@testing-library/react';

import { HttpError, NetworkError } from '@root/NetworkLayer';

import ConnectivityBanner from './ConnectivityBanner';

const renderComponent = (queryClient = new QueryClient()) =>
  render(
    <QueryClientProvider client={queryClient}>
      <IntlProvider locale="en" messages={{}}>
        <ConnectivityBanner />
      </IntlProvider>
    </QueryClientProvider>
  );

describe('ConnectivityBanner', () => {
  afterEach(() => {
    onlineManager.setOnline(true);
  });

  it('shows nothing while connected', () => {
    renderComponent();
    expect(screen.getByRole('status')).toBeEmptyDOMElement();
  });

  it('tells the user when the connection is lost', () => {
    renderComponent();
    act(() => onlineManager.setOnline(false));

    expect(screen.getByRole('status')).toHaveTextContent(/Connection lost/);
  });

  it('tells the user when the connection is back', () => {
    renderComponent();
    act(() => onlineManager.setOnline(false));
    act(() => onlineManager.setOnline(true));

    expect(screen.getByRole('status')).toHaveTextContent('You’re back online.');
  });

  it('reloads only what failed for lack of a connection once it is back', () => {
    const queryClient = new QueryClient();
    const refetchQueries = vi.spyOn(queryClient, 'refetchQueries').mockResolvedValue();
    renderComponent(queryClient);
    act(() => onlineManager.setOnline(false));
    act(() => onlineManager.setOnline(true));

    const { predicate } = refetchQueries.mock.calls[0][0]!;
    const failedWith = (error: Error) => ({ state: { status: 'error', error } }) as unknown as Parameters<typeof predicate & {}>[0];
    expect(predicate!(failedWith(new NetworkError()))).toBe(true);
    expect(predicate!(failedWith(new HttpError(500, {}, new Headers())))).toBe(false);
  });
});
