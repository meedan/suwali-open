import { IntlProvider } from 'react-intl';
import { describe, expect, it, vi } from 'vitest';
import type { UseQueryResult } from '@tanstack/react-query';
import { QueryClient, QueryClientProvider, useQuery } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';

import SystemSection from './SystemSection';

vi.mock('@tanstack/react-query', async () => ({
  ...(await vi.importActual('@tanstack/react-query')),
  useQuery: vi.fn(),
}));

const renderWithProviders = (node: React.ReactElement) =>
  render(
    <QueryClientProvider client={new QueryClient()}>
      <IntlProvider locale="en" messages={{}}>
        {node}
      </IntlProvider>
    </QueryClientProvider>
  );

const mockData = {
  global_counts: {
    hubs: 5,
    hubs_all_time: 8,
    hubs_churned: 3,
  },
};

describe('SystemSection', () => {
  it('renders the total, active, and deleted hub counts', () => {
    vi.mocked(useQuery).mockReturnValue({ data: mockData, isPending: false, error: null, status: 'success' } as UseQueryResult<unknown, unknown>);

    renderWithProviders(<SystemSection />);

    expect(screen.getByText('Total hubs (all time)')).toBeInTheDocument();
    expect(screen.getByText('8')).toBeInTheDocument();
    expect(screen.getByText('Active hubs')).toBeInTheDocument();
    expect(screen.getByText('5')).toBeInTheDocument();
    expect(screen.getByText('Deleted hubs')).toBeInTheDocument();
    expect(screen.getByText('3')).toBeInTheDocument();
  });

  it('renders dashes for all stats when data is not yet loaded', () => {
    vi.mocked(useQuery).mockReturnValue({ data: undefined, isPending: true, error: null, status: 'pending' } as UseQueryResult<unknown, unknown>);

    renderWithProviders(<SystemSection />);

    expect(screen.getAllByText('—').length).toBe(3);
  });
});
