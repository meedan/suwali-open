import { Tooltip as TooltipPrimitive } from 'radix-ui';
import { IntlProvider } from 'react-intl';
import { MemoryRouter } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor, within } from '@testing-library/react';

import type { Notebook } from '@customTypes/notebook';

import { fetchPublishedSummaries } from '@services/SourcesService';
import { fetchHubTopics } from '@services/TopicsService';

import { ToastProvider } from '@hooks/useToast';

import DataSourcesSummariesPanel from './DataSourcesSummariesPanel';

vi.mock('@services/AboutService', () => ({
  fetchAbout: vi.fn().mockResolvedValue({ max_summary_length: 2000 }),
}));

vi.mock('@root/SessionContext', () => ({
  useSession: () => ({
    currentHub: () => null,
    currentHubId: () => 1,
  }),
}));

vi.mock('@hooks/useCapabilities', () => ({
  useCan: () => ({ allowed: true }),
}));

vi.mock('@services/SourcesService', async importOriginal => ({
  ...await importOriginal<typeof import('@services/SourcesService')>(),
  fetchPublishedSummaries: vi.fn(),
}));

vi.mock('@services/HubService', () => ({
  fetchHubEditors: vi.fn().mockResolvedValue([]),
}));

vi.mock('@services/TopicsService', () => ({
  fetchHubTopics: vi.fn(),
}));

vi.mock('@components/SortModal', () => ({
  SortModal: () => null,
}));

vi.mock('@ui-components/input/DropdownMenu.tsx', () => ({
  DropdownMenu: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DropdownMenuTrigger: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DropdownMenuContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DropdownMenuItem: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DropdownMenuSeparator: () => null,
}));

const page = (data: Notebook[]) => ({
  data,
  pagination: {
    current_page: 1,
    per_page: 20,
    total_pages: 1,
    total_count: data.length,
    unfiltered_count: data.length,
    next_page: null,
    prev_page: null,
    first_page: true,
    last_page: true,
  },
});

const buildNotebook = (overrides: Partial<Notebook>): Notebook => ({
  id: 1,
  hub_id: 1,
  user_id: 1,
  name: 'A notebook',
  summary: 'Summary',
  summary_updated_at: '2026-01-01T00:00:00Z',
  created_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-01-01T00:00:00Z',
  published: true,
  published_at: '2026-01-01T00:00:00Z',
  summary_updated_by: null,
  ai_summary: null,
  ai_summary_updated_at: null,
  ai_summary_update_requested_at: null,
  user: { id: 1, name: 'Ada', email: 'ada@example.com', profile_picture_url: null } as Notebook['user'],
  priority_tier: 1,
  ...overrides,
});

const completeNotebook = buildNotebook({ id: 1, name: 'A healthy notebook', sync_status: 'complete' });
const erroredNotebook = buildNotebook({ id: 2, name: 'A notebook with an error', sync_status: 'error', retryable: true });
const unretryableNotebook = buildNotebook({ id: 3, name: 'A notebook that cannot be retried', sync_status: 'error', retryable: false });

const renderPanel = (initialPath = '/data-sources/summaries') =>
  render(
    <MemoryRouter initialEntries={[initialPath]}>
      <QueryClientProvider client={new QueryClient()}>
        <IntlProvider locale="en" messages={{}}>
          <TooltipPrimitive.Provider>
            <ToastProvider>
              <DataSourcesSummariesPanel />
            </ToastProvider>
          </TooltipPrimitive.Provider>
        </IntlProvider>
      </QueryClientProvider>
    </MemoryRouter>
  );

const respondWith = (errored: Notebook[]) => {
  vi.mocked(fetchPublishedSummaries).mockImplementation((_hubId, _page, perPage, filter) =>
    Promise.resolve(perPage === 100 && filter?.sync_status === 'error' ? page(errored) : page([completeNotebook]))
  );
};

describe('DataSourcesSummariesPanel retryable errors', () => {
  beforeEach(() => {
    vi.mocked(fetchPublishedSummaries).mockReset();
    vi.mocked(fetchHubTopics).mockResolvedValue({ ...page([]), data: [] } as never);
    respondWith([erroredNotebook]);
  });

  it('lists errored notebooks in their own section, apart from the main list', async () => {
    renderPanel();

    await waitFor(() => expect(screen.getByText('Retryable errors (1)')).toBeInTheDocument());
    expect(screen.getByText('A notebook with an error')).toBeInTheDocument();
    expect(fetchPublishedSummaries).toHaveBeenCalledWith(1, 1, 20, expect.objectContaining({ sync_status: 'pending,complete' }));
    expect(fetchPublishedSummaries).toHaveBeenCalledWith(1, 1, 100, expect.objectContaining({ sync_status: 'error' }));
  });

  it('keeps the other actions on an errored notebook, but not Pause, Include in notebooks or the priority toggle', async () => {
    renderPanel();
    await waitFor(() => expect(screen.getByText('A notebook with an error')).toBeInTheDocument());

    const row = within(screen.getByText('A notebook with an error').closest('tr')!);
    expect(row.getAllByRole('button', { name: 'Retry' }).length).toBeGreaterThan(0);
    expect(row.getByRole('button', { name: 'Preview' })).toBeInTheDocument();
    expect(row.getByRole('button', { name: 'Unpublish' })).toBeInTheDocument();
    expect(row.queryByRole('button', { name: 'Pause' })).not.toBeInTheDocument();
    expect(row.queryByRole('button', { name: /mark this item as/i })).not.toBeInTheDocument();
    expect(row.queryByRole('button', { name: 'Include in notebooks' })).not.toBeInTheDocument();
  });

  it('does not offer Retry when the error cannot be retried', async () => {
    respondWith([unretryableNotebook]);
    renderPanel();

    await waitFor(() => expect(screen.getByText('A notebook that cannot be retried')).toBeInTheDocument());
    expect(screen.queryByRole('button', { name: 'Retry' })).not.toBeInTheDocument();
  });

  it('shows only the section when filtering by errors', async () => {
    renderPanel('/data-sources/summaries?sync_status=error');

    await waitFor(() => expect(screen.getByText('Retryable errors (1)')).toBeInTheDocument());
    expect(fetchPublishedSummaries).toHaveBeenCalledWith(1, 1, 20, expect.objectContaining({ sync_status: 'unsupported' }));
    expect(screen.queryByText('There are no published notebook summaries.')).not.toBeInTheDocument();
  });

  it('does not ask for errored notebooks when errors are filtered out', async () => {
    renderPanel('/data-sources/summaries?sync_status=complete');

    await waitFor(() => expect(screen.getByText('A healthy notebook')).toBeInTheDocument());
    expect(screen.queryByText(/Retryable errors/)).not.toBeInTheDocument();
    expect(fetchPublishedSummaries).not.toHaveBeenCalledWith(1, 1, 100, expect.anything());
  });
});
