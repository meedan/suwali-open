import { Toast as ToastPrimitive } from 'radix-ui';
import { useEffect } from 'react';
import { IntlProvider } from 'react-intl';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';

import type { Document } from '@customTypes/document';

import { ToastProvider } from '@hooks/useToast';

import MarkdownEditor from '@components/MarkdownEditor';

import DocumentPreviewModal from './DocumentPreviewModal';

vi.mock('./PreviewModalBase', () => ({
  default: ({ title, details, content }: { title: React.ReactNode; details: React.ReactNode; content: React.ReactNode }) => (
    <div>
      <h1>{title}</h1>
      <div data-testid="details">{details}</div>
      <div data-testid="content">{content}</div>
    </div>
  ),
}));

vi.mock('@components/MarkdownEditor', () => ({
  default: vi.fn(),
}));

const baseDocument: Document = {
  id: 1,
  content: '# Heading\n\nSome text.',
  document_size: '1 KB',
  document_type: 'md',
  external_url: '',
  file_url: null,
  title: 'notes.md',
  summary: null,
  ai_summary: null,
  updated_at: '2024-01-01T00:00:00Z',
  published_at: null,
  refresh_supported: false,
  priority_tier: 1,
};

vi.mock('@services/AboutService', () => ({
  fetchAbout: vi.fn().mockResolvedValue({ max_summary_length: 2000 }),
}));

// The details are rendered, the topics in them raise toasts, and the summary asks the server how long it can be
const withProviders = (ui: React.ReactNode) => (
  <IntlProvider locale="en" messages={{}}>
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <ToastPrimitive.Provider>
        <ToastProvider>
          {ui}
        </ToastProvider>
      </ToastPrimitive.Provider>
    </QueryClientProvider>
  </IntlProvider>
);

const renderModal = (document: Document | null) => render(
  withProviders(<DocumentPreviewModal document={document} open={true} onOpenChange={vi.fn()} />)
);

describe('DocumentPreviewModal', () => {
  beforeEach(() => {
    vi.mocked(MarkdownEditor).mockImplementation(({ initialValue }) => <div data-testid="markdown-editor">{initialValue}</div>);
  });

  it('shows the summary of the document it is switched to, and edits that one', async () => {
    const modal = (document: Document) => withProviders(
      <DocumentPreviewModal document={document} open={true} onOpenChange={vi.fn()} onSaveSummary={vi.fn()} />
    );
    const { rerender } = render(modal({ ...baseDocument, summary: 'Summary of A' }));
    expect(await within(screen.getByTestId('details')).findByText('Summary of A')).toBeInTheDocument();

    rerender(modal({ ...baseDocument, id: 2, summary: 'Summary of B' }));

    expect(await within(screen.getByTestId('details')).findByText('Summary of B')).toBeInTheDocument();
    expect(screen.queryByText('Summary of A')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Edit' }));
    expect(await within(screen.getByTestId('details')).findByTestId('markdown-editor')).toHaveTextContent('Summary of B');
  });

  it('shows when the document was published, next to when it was modified, when it has a published date', () => {
    renderModal({ ...baseDocument, published_at: '2023-12-25T00:00:00Z' });

    const details = within(screen.getByTestId('details'));
    expect(details.getByText('Published')).toBeInTheDocument();
    expect(details.getByText('Modified')).toBeInTheDocument();
  });

  it('does not show a published date for documents without one', () => {
    renderModal(baseDocument);

    const details = within(screen.getByTestId('details'));
    expect(details.queryByText('Published')).not.toBeInTheDocument();
    expect(details.getByText('Modified')).toBeInTheDocument();
  });

  it('renders markdown content through MarkdownEditor for md documents', async () => {
    renderModal(baseDocument);

    expect(await screen.findByTestId('markdown-editor')).toHaveTextContent('# Heading Some text.');
    expect(screen.queryByText(/could not be displayed with formatting/)).not.toBeInTheDocument();
  });

  it('falls back to plain text with a warning when the markdown editor fails to parse the content', async () => {
    vi.mocked(MarkdownEditor).mockImplementation(({ onError }) => {
      useEffect(() => {
        onError?.({ error: 'Parsing of the following markdown structure failed', source: '```\ncode\n```' });
      }, [onError]);
      return <div data-testid="markdown-editor" />;
    });

    renderModal(baseDocument);

    await waitFor(() => {
      expect(screen.getByText(/could not be displayed with formatting/)).toBeInTheDocument();
    });
    expect(screen.getByTestId('content')).toHaveTextContent('# HeadingSome text.');
    expect(screen.queryByTestId('markdown-editor')).not.toBeInTheDocument();
  });

  it('renders content as plain text for non-markdown types, like txt', () => {
    renderModal({ ...baseDocument, document_type: 'txt', file_url: null });

    expect(screen.getByTestId('content')).toHaveTextContent('# HeadingSome text.');
    expect(screen.queryByTestId('markdown-editor')).not.toBeInTheDocument();
  });
});
