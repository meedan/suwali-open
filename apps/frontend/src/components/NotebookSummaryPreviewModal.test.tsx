import { Toast as ToastPrimitive } from 'radix-ui';
import { IntlProvider } from 'react-intl';
import { describe, expect, it, vi } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, within } from '@testing-library/react';

import type { Notebook } from '@customTypes/notebook';

import { ToastProvider } from '@hooks/useToast';

import NotebookSummaryPreviewModal from './NotebookSummaryPreviewModal';

vi.mock('./PreviewModalBase', () => ({
  default: ({ details }: { details: React.ReactNode }) => <div data-testid="details">{details}</div>,
}));

vi.mock('@components/MarkdownEditor', () => ({ default: () => null }));

const author = { id: 1, name: 'Ada Author', email: 'ada@example.com', profile_picture_url: '' };
const editor = { id: 2, name: 'Eli Editor', email: 'eli@example.com', profile_picture_url: '' };

const renderModal = (overrides: Partial<Notebook> = {}) => {
  const notebook = {
    id: 5,
    name: 'My notebook',
    summary: 'Summary',
    published_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-02T00:00:00Z',
    user: author as Notebook['user'],
    summary_updated_by: null,
    priority_tier: 1,
    ...overrides,
  } as Notebook;

  render(
    <IntlProvider locale="en" messages={{}}>
      <QueryClientProvider client={new QueryClient()}>
        <ToastPrimitive.Provider>
          <ToastProvider>
            <NotebookSummaryPreviewModal notebook={notebook} open onOpenChange={vi.fn()} />
          </ToastProvider>
        </ToastPrimitive.Provider>
      </QueryClientProvider>
    </IntlProvider>,
  );
  return within(screen.getByTestId('details'));
};

describe('NotebookSummaryPreviewModal people', () => {
  it('shows who last edited the summary, as the table does', () => {
    const details = renderModal({ summary_updated_by: editor as Notebook['summary_updated_by'] });

    expect(details.getByText('Last edited by')).toBeInTheDocument();
    expect(details.getByText('Eli Editor')).toBeInTheDocument();
    expect(details.queryByText('Ada Author')).not.toBeInTheDocument();
  });

  it('shows a dash when nobody has edited the summary, as the table does', () => {
    const details = renderModal();

    expect(details.getByText('Last edited by')).toBeInTheDocument();
    expect(details.getByText('—')).toBeInTheDocument();
    expect(details.queryByText('Ada Author')).not.toBeInTheDocument();
  });
});
