import { Tooltip } from 'radix-ui';
import { IntlProvider } from 'react-intl';
import { MemoryRouter } from 'react-router';
import { describe, expect, it, vi } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';

import type { Notebook } from '@customTypes/notebook';
import type { NotebookItem } from '@customTypes/notebook-item';

import NotebookSidebar from './NotebookSidebar';

vi.mock('@hooks/useHubPath', () => ({ useHubPath: () => (path: string) => path }));
vi.mock('@hooks/useToast', () => ({ useToast: () => ({ toast: vi.fn() }) }));
vi.mock('@components/Can', () => ({ Can: () => null }));
// NotebookSummaryModal, in the footer, fetches the summary; without this it makes a real request.
vi.mock('@services/NotebooksService', async (importOriginal) => ({
  ...await importOriginal<typeof import('@services/NotebooksService')>(),
  fetchNotebookSummary: vi.fn().mockResolvedValue({ id: 1, name: 'Notebook' }),
}));

const notebook = { id: 1, name: 'Notebook', updated_at: '2026-01-02T03:04:05Z' } as Notebook;

const clusterItem = (overrides: object) => ({
  id: 7,
  item_id: 3,
  item_type: 'MessageCluster',
  notebook_id: 1,
  updated_at: '2026-01-02T03:04:05Z',
  item: {
    id: 3,
    original_text: 'what is love',
    question_count: 2,
    centroid_message_id: 1,
    last_message_body: 'what is love',
    updated_at: '2026-01-02T03:04:05Z',
    last_message_answered_status: null,
    current_answered_status_count: null,
    ...overrides,
  },
}) as NotebookItem;

const renderSidebar = (item: NotebookItem) => render(
  <IntlProvider locale="en">
    <QueryClientProvider client={new QueryClient()}>
      <MemoryRouter>
        <Tooltip.Provider>
          <NotebookSidebar
            error={null}
            isPending={false}
            notebook={notebook}
            notebookItems={[item]}
            selectedItem={null}
            onItemSelect={vi.fn()}
            onNavigateBack={vi.fn()}
          />
        </Tooltip.Provider>
      </MemoryRouter>
    </QueryClientProvider>
  </IntlProvider>
);

describe('<NotebookSidebar />', () => {
  it('shows the entry count of a cluster with an answered status', () => {
    renderSidebar(clusterItem({ last_message_answered_status: true, current_answered_status_count: 2 }));

    expect(screen.getByText(/2 Entries/)).toBeInTheDocument();
  });

  it('omits the entry count of a cluster without an answered status', () => {
    renderSidebar(clusterItem({}));

    expect(screen.getByText('what is love')).toBeInTheDocument();
    expect(screen.queryByText(/\d+ Entr(y|ies)/)).not.toBeInTheDocument();
  });
});
