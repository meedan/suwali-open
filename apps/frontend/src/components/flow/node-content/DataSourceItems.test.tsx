import { Toast as ToastPrimitive, Tooltip } from 'radix-ui';
import { IntlProvider } from 'react-intl';
import { MemoryRouter } from 'react-router';
import { describe, expect, it, vi } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen } from '@testing-library/react';

import type { DataSourceItem } from '@customTypes/data-source-item';

import { ToastProvider } from '@hooks/useToast';

import DataSourceItems from './DataSourceItems';

// The summary in the preview asks the server how long it can be
vi.mock('@services/AboutService', () => ({
  fetchAbout: vi.fn().mockResolvedValue({ max_summary_length: 2000 }),
}));

vi.mock('@services/DocumentsService', () => ({
  fetchDocument: vi.fn().mockResolvedValue({
    id: 7,
    title: 'A paused document',
    content: 'Some text',
    document_size: '1 KB',
    document_type: 'txt',
    external_url: '',
    file_url: null,
    summary: null,
    ai_summary: null,
    updated_at: '2024-01-01T00:00:00Z',
    published_at: null,
    refresh_supported: false,
    priority_tier: 1,
    active: false,
    sync_status: 'complete',
    source_id: null,
  }),
  updateDocumentSummary: vi.fn(),
}));

// The list only names the item, as the flow does: it knows nothing of whether the item is paused
const item: DataSourceItem = { id: 7, title: 'A paused document', type: 'Document', deleted: false, usage_count: 1 };

describe('DataSourceItems', () => {
  it('asks to confirm reactivating an item from its preview, from the copy the preview fetched', async () => {
    render(
      <MemoryRouter>
        <IntlProvider locale="en">
          <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
            <Tooltip.Provider>
              <ToastPrimitive.Provider>
                <ToastProvider>
                  <DataSourceItems dataSourceItems={[item]} />
                </ToastProvider>
                <ToastPrimitive.Viewport />
              </ToastPrimitive.Provider>
            </Tooltip.Provider>
          </QueryClientProvider>
        </IntlProvider>
      </MemoryRouter>
    );

    fireEvent.click(screen.getByText('A paused document'));
    fireEvent.click(await screen.findByRole('button', { name: 'Reactivate' }));

    expect(await screen.findByText('Reactivate document?')).toBeInTheDocument();
  });
});
