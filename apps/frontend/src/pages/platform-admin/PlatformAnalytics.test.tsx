import { IntlProvider } from 'react-intl';
import { describe, expect, it, vi } from 'vitest';
import type { UseQueryResult } from '@tanstack/react-query';
import { QueryClient, QueryClientProvider, useQuery } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';

import PlatformAnalytics from './PlatformAnalytics';

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
    sources: 12,
    conversations: 100,
    users: 30,
    external_users: 250,
    documents: 80,
    messages: 1500,
    hubs_all_time: 8,
    hubs_churned: 3,
  },
  documents_by_sync_status: [],
  messages_by_state: [],
  questions_by_answered: [],
  hubs_by_creation_date: [],
  average_answer_times: {
    all_time: 2500,
    last_week: 1800,
    last_month: 2700,
  },
};

describe('PlatformAnalytics', () => {
  it('renders the section title with the active hub count', () => {
    vi.mocked(useQuery).mockReturnValue({ data: mockData, isPending: false, error: null, status: 'success' } as UseQueryResult<unknown, unknown>);

    renderWithProviders(<PlatformAnalytics />);

    expect(screen.getByText('Active hub analytics (5)')).toBeInTheDocument();
  });

  it('renders all stat card labels', () => {
    vi.mocked(useQuery).mockReturnValue({ data: mockData, isPending: false, error: null, status: 'success' } as UseQueryResult<unknown, unknown>);

    renderWithProviders(<PlatformAnalytics />);

    expect(screen.getByText('Users')).toBeInTheDocument();
    expect(screen.getByText('Conversations')).toBeInTheDocument();
    expect(screen.getByText('End-users')).toBeInTheDocument();
    expect(screen.getByText('Messages')).toBeInTheDocument();
    expect(screen.getByText('Avg. answer time')).toBeInTheDocument();
    expect(screen.getByText('Sources')).toBeInTheDocument();
    expect(screen.getByText('Documents')).toBeInTheDocument();
  });

  it('renders count values from global_counts', () => {
    vi.mocked(useQuery).mockReturnValue({ data: mockData, isPending: false, error: null, status: 'success' } as UseQueryResult<unknown, unknown>);

    renderWithProviders(<PlatformAnalytics />);

    expect(screen.getByText('100')).toBeInTheDocument(); // conversations
    expect(screen.getByText('1,500')).toBeInTheDocument(); // messages (formatted)
  });

  it('renders average answer time headline value from last week', () => {
    vi.mocked(useQuery).mockReturnValue({ data: mockData, isPending: false, error: null, status: 'success' } as UseQueryResult<unknown, unknown>);

    renderWithProviders(<PlatformAnalytics />);

    expect(screen.getByText('1.8s')).toBeInTheDocument(); // last_week all
  });

  it('renders delta comparisons with faster/slower labels', () => {
    vi.mocked(useQuery).mockReturnValue({ data: mockData, isPending: false, error: null, status: 'success' } as UseQueryResult<unknown, unknown>);

    renderWithProviders(<PlatformAnalytics />);

    // all replies: last_week=1800 vs last_month=2700 → ↓0.9s (33% faster) past month
    expect(screen.getByText((_, el) => el?.textContent?.trim() === '↓0.9s (33% faster) past month')).toBeInTheDocument();
    // all replies: last_week=1800 vs all_time=2500 → ↓0.7s (28% faster) all time
    expect(screen.getByText((_, el) => el?.textContent?.trim() === '↓0.7s (28% faster) all time')).toBeInTheDocument();
  });

  it('renders dashes for all stats when data is not yet loaded', () => {
    vi.mocked(useQuery).mockReturnValue({ data: undefined, isPending: true, error: null, status: 'pending' } as UseQueryResult<unknown, unknown>);

    renderWithProviders(<PlatformAnalytics />);

    const dashes = screen.getAllByText('—');
    expect(dashes.length).toBe(7); // 6 counts + 1 avg answer time headline
  });

  it('renders all four chart section titles', () => {
    vi.mocked(useQuery).mockReturnValue({ data: mockData, isPending: false, error: null, status: 'success' } as UseQueryResult<unknown, unknown>);

    renderWithProviders(<PlatformAnalytics />);

    expect(screen.getByText('Documents added per week (by sync status)')).toBeInTheDocument();
    expect(screen.getByText('Messages per week (by state)')).toBeInTheDocument();
    expect(screen.getByText('Questions per week (answered vs unanswered)')).toBeInTheDocument();
    expect(screen.getByText('Hubs created per week (active vs deleted)')).toBeInTheDocument();
  });

  it('renders active and deleted legend labels for the hubs-created chart', () => {
    const hubsByCreationDate = {
      ...mockData,
      hubs_by_creation_date: [{ date: '2026-06-01', active: 3, deleted: 1 }],
    };
    vi.mocked(useQuery).mockReturnValue({ data: hubsByCreationDate, isPending: false, error: null, status: 'success' } as UseQueryResult<unknown, unknown>);

    renderWithProviders(<PlatformAnalytics />);

    expect(screen.getByText('Active')).toBeInTheDocument();
    expect(screen.getByText('Deleted')).toBeInTheDocument();
  });

  it('collapses the six contribution message states into a single "Contribution" legend entry', () => {
    const messagesByState = {
      ...mockData,
      messages_by_state: [
        {
          date: '2026-06-01',
          user_message: 5,
          bot_processing: 1,
          bot_intermediary_message: 1,
          bot_message: 5,
          user_contribution_started: 2,
          bot_contribution_started: 2,
          user_contribution_cancelled: 1,
          bot_contribution_cancelled: 1,
          user_contribution_submitted: 1,
          bot_contribution_submitted: 1,
          closed_window: 1,
          unsupported_message: 0,
          knowledge_service_error: 0,
          rate_limit_reached: 0,
        },
      ],
    };
    vi.mocked(useQuery).mockReturnValue({ data: messagesByState, isPending: false, error: null, status: 'success' } as UseQueryResult<unknown, unknown>);

    renderWithProviders(<PlatformAnalytics />);

    expect(screen.getByText('User message')).toBeInTheDocument();
    expect(screen.getAllByText('Contribution').length).toBe(1);
    expect(screen.queryByText('Contribution started (user)')).not.toBeInTheDocument();
    expect(screen.queryByText('Contribution submitted (bot)')).not.toBeInTheDocument();
  });
});
