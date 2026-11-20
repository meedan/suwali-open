import { IntlProvider } from 'react-intl';
import { MemoryRouter } from 'react-router';
import { describe, expect, it, vi } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';

import { fetchStatistics } from '@services/HubService';

import LineChart, { CustomXAxisTick } from './LineChart';

vi.mock('@services/HubService', () => ({
  fetchStatistics: vi.fn(),
}));

vi.mock('@root/SessionContext', () => ({
  useSession: () => ({
    currentHubId: () => 1,
  }),
}));

const baseProps = {
  x: 100,
  y: 20,
  payload: { value: '2024-01-15' },
  visibleTicksCount: 5,
  formatter: (v: string) => v,
};

describe('CustomXAxisTick', () => {
  it('left-aligns the first tick', () => {
    render(
      <svg>
        <CustomXAxisTick {...baseProps} index={0} />
      </svg>
    );
    expect(screen.getByText('2024-01-15')).toHaveAttribute('text-anchor', 'start');
  });

  it('right-aligns the last tick', () => {
    render(
      <svg>
        <CustomXAxisTick {...baseProps} index={4} />
      </svg>
    );
    expect(screen.getByText('2024-01-15')).toHaveAttribute('text-anchor', 'end');
  });

  it('center-aligns middle ticks', () => {
    render(
      <svg>
        <CustomXAxisTick {...baseProps} index={2} />
      </svg>
    );
    expect(screen.getByText('2024-01-15')).toHaveAttribute('text-anchor', 'middle');
  });

  it('calls the formatter with the payload value', () => {
    render(
      <svg>
        <CustomXAxisTick {...baseProps} index={0} formatter={() => 'Jan 15'} />
      </svg>
    );
    expect(screen.getByText('Jan 15')).toBeInTheDocument();
  });
});

describe('LineChart', () => {
  it('explains the empty state, and still closes, when nobody talked to the chatbot', async () => {
    // The series the endpoint returns is zero-filled, so an idle hub still gets a bucket a day
    vi.mocked(fetchStatistics).mockResolvedValue({
      range: ['2026-08-22', '2026-08-24'],
      number_of_new_conversations: { '2026-08-22': 0, '2026-08-23': 0, '2026-08-24': 0 },
      number_of_continued_conversations: { '2026-08-22': 0, '2026-08-23': 0, '2026-08-24': 0 },
    } as Awaited<ReturnType<typeof fetchStatistics>>);

    render(
      <MemoryRouter>
        <QueryClientProvider client={new QueryClient()}>
          <IntlProvider locale="en" messages={{}}>
            <LineChart onClose={() => {}} onSendToTop={() => {}} />
          </IntlProvider>
        </QueryClientProvider>
      </MemoryRouter>
    );

    expect(await screen.findByText('Your audience has not started a conversation in this period.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Close details' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Send to top' })).toBeInTheDocument();
  });

  it('does not offer to send itself to top when there is nowhere to send it', async () => {
    vi.mocked(fetchStatistics).mockResolvedValue({
      range: ['2026-08-22', '2026-08-24'],
      number_of_new_conversations: { '2026-08-22': 0, '2026-08-23': 0, '2026-08-24': 0 },
      number_of_continued_conversations: { '2026-08-22': 0, '2026-08-23': 0, '2026-08-24': 0 },
    } as Awaited<ReturnType<typeof fetchStatistics>>);

    render(
      <MemoryRouter>
        <QueryClientProvider client={new QueryClient()}>
          <IntlProvider locale="en" messages={{}}>
            <LineChart onClose={() => {}} />
          </IntlProvider>
        </QueryClientProvider>
      </MemoryRouter>
    );

    expect(await screen.findByText('Your audience has not started a conversation in this period.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Send to top' })).not.toBeInTheDocument();
  });
});
