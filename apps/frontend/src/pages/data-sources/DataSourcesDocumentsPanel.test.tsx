import { Tooltip as TooltipPrimitive } from 'radix-ui';
import { IntlProvider } from 'react-intl';
import { MemoryRouter, Route, Routes } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';

import type { Document } from '@customTypes/document';
import type { Source } from '@customTypes/source';

import { fetchDocument, fetchDocuments } from '@services/DocumentsService';
import { fetchHubTopics } from '@services/TopicsService';

import { ToastProvider } from '@hooks/useToast';

import DataSourcesDocumentsPanel from './DataSourcesDocumentsPanel';

// The summary in the preview asks the server how long it can be
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

vi.mock('@services/DocumentsService', () => ({
  fetchDocuments: vi.fn(),
  fetchDocument: vi.fn(),
}));

// The names of the topics in the address, and the topics to filter by, which none of these depend on
vi.mock('@services/TopicsService', () => ({
  fetchHubTopics: vi.fn(),
}));

vi.mock('@components/SortModal', () => ({
  SortModal: ({ options }: { options?: string[] }) => <div>{`Sort options: ${options?.join(', ') ?? 'default'}`}</div>,
}));

vi.mock('@ui-components/input/DropdownMenu.tsx', () => ({
  DropdownMenu: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DropdownMenuTrigger: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DropdownMenuContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DropdownMenuItem: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DropdownMenuSeparator: () => null,
}));

const emptyPage = {
  data: [],
  pagination: {
    current_page: 1,
    per_page: 20,
    total_pages: 0,
    total_count: 0,
    next_page: null,
    prev_page: null,
    first_page: true,
    last_page: true,
  },
};

beforeEach(() => {
  localStorage.clear();
  vi.mocked(fetchHubTopics).mockResolvedValue(emptyPage);
});

const retryableErrorDocument: Document = {
  id: 42,
  content: '',
  document_size: '1 KB',
  document_type: 'blog_post',
  external_url: 'https://example.org/post',
  file_url: null,
  title: 'A document with a retryable error',
  summary: null,
  ai_summary: null,
  updated_at: '2026-01-01T00:00:00Z',
  published_at: null,
  sync_status: 'error',
  refresh_supported: false,
  priority_tier: 1,
};

const source: Source = {
  id: 6,
  config: {},
  documents_count: 0,
  name: 'My Source',
  updated_at: '2026-01-01T00:00:00Z',
  source_type: 'website',
  active: true,
};

const renderPanel = (initialPath: string, panelSource: Source = source) =>
  render(
    <MemoryRouter initialEntries={[initialPath]}>
      <QueryClientProvider client={new QueryClient()}>
        <IntlProvider locale="en" messages={{}}>
          <TooltipPrimitive.Provider>
            <ToastProvider>
              <DataSourcesDocumentsPanel source={panelSource} />
            </ToastProvider>
          </TooltipPrimitive.Provider>
        </IntlProvider>
      </QueryClientProvider>
    </MemoryRouter>
  );

describe('DataSourcesDocumentsPanel sync_status filtering', () => {
  beforeEach(() => {
    vi.mocked(fetchDocuments).mockReset();
  });

  it('excludes error and unsupported from the main list by default, and fetches retryable errors separately', async () => {
    vi.mocked(fetchDocuments).mockImplementation((_sourceId, _page, perPage, filter) =>
      Promise.resolve(perPage === 100 && filter.sync_status === 'error'
        ? { ...emptyPage, data: [retryableErrorDocument], pagination: { ...emptyPage.pagination, total_count: 1 } }
        : emptyPage)
    );

    renderPanel('/data-sources/6');

    await waitFor(() => {
      expect(screen.getByText('Retryable errors (1)')).toBeInTheDocument();
    });

    expect(fetchDocuments).toHaveBeenCalledWith(6, 1, 20, expect.objectContaining({ sync_status: 'pending,complete' }));
    expect(fetchDocuments).toHaveBeenCalledWith(6, 1, 100, expect.objectContaining({ sync_status: 'error' }));
    expect(screen.queryByText('No documents found for My Source.')).not.toBeInTheDocument();
  });

  it('still excludes error from the main list when only the Error status filter is selected', async () => {
    vi.mocked(fetchDocuments).mockResolvedValue(emptyPage);

    renderPanel('/data-sources/6?sync_status=error');

    await waitFor(() => {
      expect(fetchDocuments).toHaveBeenCalledWith(6, 1, 100, expect.objectContaining({ sync_status: 'error' }));
    });

    expect(fetchDocuments).toHaveBeenCalledWith(6, 1, 20, expect.objectContaining({ sync_status: 'unsupported' }));
  });

  it('does not fetch retryable errors when the Error status filter is deselected', async () => {
    vi.mocked(fetchDocuments).mockResolvedValue(emptyPage);

    renderPanel('/data-sources/6?sync_status=complete,pending,unsupported');

    await waitFor(() => {
      expect(fetchDocuments).toHaveBeenCalledWith(6, 1, 20, expect.objectContaining({ sync_status: 'complete,pending,unsupported' }));
    });

    expect(fetchDocuments).not.toHaveBeenCalledWith(6, 1, 100, expect.anything());
  });
});

describe('DataSourcesDocumentsPanel date published column', () => {
  const publishedAt = '2026-03-15T12:00:00Z';
  const datedDocument: Document = {
    ...retryableErrorDocument,
    id: 51,
    title: 'A dated document',
    sync_status: 'complete',
    updated_at: '2026-02-10T12:00:00Z',
    published_at: publishedAt,
  };
  const undatedDocument: Document = {
    ...datedDocument,
    id: 52,
    title: 'An undated document',
    published_at: null,
  };
  const rssSource: Source = { ...source, source_type: 'rss_feed' };

  beforeEach(() => {
    vi.mocked(fetchDocuments).mockReset();
    vi.mocked(fetchDocuments).mockImplementation((_sourceId, _page, perPage) =>
      Promise.resolve(perPage === 20
        ? { ...emptyPage, data: [datedDocument, undatedDocument], pagination: { ...emptyPage.pagination, total_count: 2 } }
        : emptyPage)
    );
  });

  it('shows the published date, or a dash when missing, for a source that supports it', async () => {
    renderPanel('/data-sources/6', rssSource);

    await waitFor(() => {
      expect(screen.getByText('A dated document')).toBeInTheDocument();
    });

    expect(screen.getByRole('columnheader', { name: 'Date published' })).toBeInTheDocument();
    expect(screen.getByText(new Date(publishedAt).toLocaleDateString())).toBeInTheDocument();
    expect(screen.getByText('—')).toBeInTheDocument();
  });

  it('does not show the column for a source that does not support it', async () => {
    renderPanel('/data-sources/6', { ...source, source_type: 'uploaded_files' });

    await waitFor(() => {
      expect(screen.getByText('A dated document')).toBeInTheDocument();
    });

    expect(screen.queryByRole('columnheader', { name: 'Date published' })).not.toBeInTheDocument();
    expect(screen.queryByText('—')).not.toBeInTheDocument();
  });
});

describe('DataSourcesDocumentsPanel sort options', () => {
  beforeEach(() => {
    vi.mocked(fetchDocuments).mockReset();
    vi.mocked(fetchDocuments).mockResolvedValue(emptyPage);
  });

  it('offers sorting by date published for a source that supports it', async () => {
    renderPanel('/data-sources/6', { ...source, source_type: 'rss_feed' });

    expect(await screen.findByText('Sort options: title, updated_at, published_at, sync_status, priority_tier')).toBeInTheDocument();
  });

  it('keeps the default sort options for a source that does not support it', async () => {
    renderPanel('/data-sources/6', { ...source, source_type: 'uploaded_files' });

    expect(await screen.findByText('Sort options: default')).toBeInTheDocument();
  });
});

describe('DataSourcesDocumentsPanel retryable error rows', () => {
  beforeEach(() => {
    vi.mocked(fetchDocuments).mockReset();
    vi.mocked(fetchDocuments).mockImplementation((_sourceId, _page, perPage, filter) =>
      Promise.resolve(perPage === 100 && filter.sync_status === 'error'
        ? { ...emptyPage, data: [retryableErrorDocument], pagination: { ...emptyPage.pagination, total_count: 1 } }
        : emptyPage)
    );
  });

  it('does not offer Preview or the priority toggle for a retryable error document', async () => {
    renderPanel('/data-sources/6');

    await waitFor(() => {
      expect(screen.getByText('A document with a retryable error')).toBeInTheDocument();
    });

    expect(screen.queryByRole('button', { name: 'Preview' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /mark this item as/i })).not.toBeInTheDocument();
  });

  it('still offers Retry for a retryable error document', async () => {
    renderPanel('/data-sources/6');

    await waitFor(() => {
      expect(screen.getByText('A document with a retryable error')).toBeInTheDocument();
    });

    expect(screen.getByRole('button', { name: 'Retry' })).toBeInTheDocument();
  });
});

describe('DataSourcesDocumentsPanel unsupported file rows', () => {
  const unsupportedSource: Source = {
    ...source,
    source_type: 'uploaded_files',
    ingestion_errors: [
      { external_id: 'file-1', title: 'A skipped file', link: null, reason: 'unsupported_type', details: 'image/png' },
    ],
    non_retryable_documents: [
      { id: 77, title: 'A file that is too large', external_id: null, last_sync_error_code: 'TEXT_TOO_LARGE', external_url: null },
    ],
  };

  beforeEach(() => {
    vi.mocked(fetchDocuments).mockReset();
    vi.mocked(fetchDocuments).mockResolvedValue(emptyPage);
  });

  it('offers Remove for an unsupported document that exists in the hub', async () => {
    renderPanel('/data-sources/6', unsupportedSource);

    const row = (await screen.findByText('A file that is too large')).closest('tr') as HTMLElement;
    fireEvent.click(within(row).getByRole('button', { name: 'Remove' }));

    expect(await screen.findByRole('dialog')).toHaveTextContent('A file that is too large');
  });

  it('offers Open source but not Remove for an unsupported document in a Drive source', async () => {
    renderPanel('/data-sources/6', {
      ...unsupportedSource,
      source_type: 'google_drive_folder',
      non_retryable_documents: [
        { id: 78, title: 'A Drive file that is too large', external_id: 'drive-1', last_sync_error_code: 'TEXT_TOO_LARGE', external_url: 'https://drive.google.com/file/d/drive-1/view' },
      ],
    });

    const row = (await screen.findByText('A Drive file that is too large')).closest('tr') as HTMLElement;

    expect(within(row).getByRole('button', { name: 'Open source' })).toBeInTheDocument();
    expect(within(row).queryByRole('button', { name: 'Remove' })).not.toBeInTheDocument();
  });

  it('does not offer Remove for an ingestion error that has no document', async () => {
    renderPanel('/data-sources/6', unsupportedSource);

    const row = (await screen.findByText('A skipped file')).closest('tr') as HTMLElement;

    expect(within(row).queryByRole('button', { name: 'Remove' })).not.toBeInTheDocument();
  });
});

describe('DataSourcesDocumentsPanel topics filtering', () => {
  const unsupportedSource: Source = {
    ...source,
    source_type: 'uploaded_files',
    ingestion_errors: [
      { external_id: 'file-1', title: 'A skipped file', link: null, reason: 'unsupported_type', details: 'image/png' },
    ],
  };

  beforeEach(() => {
    vi.mocked(fetchDocuments).mockReset();
    vi.mocked(fetchDocuments).mockResolvedValue(emptyPage);
  });

  it('asks for the documents of the topics, and how the list is filtered by them', async () => {
    renderPanel('/data-sources/6?topics=3,none&topics_mode=exclude');

    await waitFor(() => {
      expect(fetchDocuments).toHaveBeenCalledWith(6, 1, 20, expect.objectContaining({ topics: '3,none', topics_mode: 'exclude' }));
    });
  });

  it('shows the unsupported files, which have no topics, when the list is not filtered by topics', async () => {
    renderPanel('/data-sources/6', unsupportedSource);

    expect(await screen.findByText('Unsupported files (1)')).toBeInTheDocument();
  });

  it('shows only the unsupported files, with no empty state, when filtering by that status', async () => {
    renderPanel('/data-sources/6?sync_status=unsupported', unsupportedSource);

    expect(await screen.findByText('Unsupported files (1)')).toBeInTheDocument();
    expect(screen.queryByText(/No documents found for My Source/)).not.toBeInTheDocument();
  });

  it('does not show the unsupported files while the list is filtered by topics', async () => {
    renderPanel('/data-sources/6?topics=3', unsupportedSource);

    // Once the list is shown, which is not until the documents have loaded
    await screen.findByText(/No documents found for My Source/);

    expect(screen.queryByText(/Unsupported files/)).not.toBeInTheDocument();
  });
});

describe('DataSourcesDocumentsPanel permalinks', () => {
  const completeDocument: Document = {
    ...retryableErrorDocument,
    id: 99,
    title: 'A complete document',
    sync_status: 'complete',
  };

  beforeEach(() => {
    vi.mocked(fetchDocuments).mockReset();
    vi.mocked(fetchDocument).mockReset();
  });

  it('opens the document preview when visiting its permalink', async () => {
    vi.mocked(fetchDocuments).mockResolvedValue(emptyPage);
    vi.mocked(fetchDocument).mockResolvedValue(completeDocument);

    render(
      <MemoryRouter initialEntries={['/data-sources/6/documents/99']}>
        <QueryClientProvider client={new QueryClient()}>
          <IntlProvider locale="en" messages={{}}>
            <TooltipPrimitive.Provider>
              <ToastProvider>
                <Routes>
                  <Route path="/data-sources/:sourceId/documents/:itemId" element={<DataSourcesDocumentsPanel source={source} />} />
                </Routes>
              </ToastProvider>
            </TooltipPrimitive.Provider>
          </IntlProvider>
        </QueryClientProvider>
      </MemoryRouter>
    );

    expect(await screen.findByRole('dialog')).toHaveTextContent('A complete document');
    expect(fetchDocument).toHaveBeenCalledWith(99);
  });
});

describe('DataSourcesDocumentsPanel density', () => {
  const taggedDocument: Document = {
    ...retryableErrorDocument,
    id: 61,
    title: 'A tagged document',
    sync_status: 'complete',
    topics: [{ id: 1, topic_id: 11, name: 'Elections' }, { id: 2, topic_id: 12, name: 'Health' }],
  };
  const untaggedDocument: Document = {
    ...taggedDocument,
    id: 62,
    title: 'An untagged document',
    topics: [],
  };

  beforeEach(() => {
    vi.mocked(fetchDocuments).mockReset();
    vi.mocked(fetchDocuments).mockImplementation((_sourceId, _page, perPage) =>
      Promise.resolve(perPage === 20
        ? { ...emptyPage, data: [taggedDocument, untaggedDocument], pagination: { ...emptyPage.pagination, total_count: 2 } }
        : emptyPage)
    );
  });

  it('shows no topics by default', async () => {
    renderPanel('/data-sources/6');

    await screen.findByText('A tagged document');

    expect(screen.getByRole('radio', { name: 'Compact' })).toBeChecked();
    expect(screen.queryByText('Elections')).not.toBeInTheDocument();
  });

  it('shows the topics of each document when comfortable', async () => {
    renderPanel('/data-sources/6');
    await screen.findByText('A tagged document');

    fireEvent.click(screen.getByRole('radio', { name: 'Comfortable' }));

    const topics = screen.getByRole('list', { name: 'Topics' });
    expect(within(topics).getByText('Elections')).toBeInTheDocument();
    expect(within(topics).getByText('Health')).toBeInTheDocument();
    // The untagged document keeps its row, so rows stay the same height, but says it has none
    expect(screen.getAllByRole('list', { name: 'Topics' })).toHaveLength(1);
    expect(screen.getByText('Untagged')).toBeInTheDocument();
  });

  it('remembers the density the next time the table is shown', async () => {
    localStorage.setItem('suwali-table-density', 'comfortable');
    renderPanel('/data-sources/6');

    expect(await screen.findByText('Elections')).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: 'Comfortable' })).toBeChecked();
  });
});
