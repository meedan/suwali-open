import { Tooltip } from 'radix-ui';
import { useEffect, useState } from 'react';
import { IntlProvider } from 'react-intl';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';

import type { Notebook } from '@customTypes/notebook';

import * as NotebooksService from '@services/NotebooksService';

import { ToastProvider } from '@hooks/useToast';

import MarkdownEditor from '@components/MarkdownEditor';

import NotebookSummaryModal from './NotebookSummaryModal';

vi.mock('@services/NotebooksService', () => ({
  fetchNotebookSummary: vi.fn(),
  regenerateSummary: vi.fn(),
}));

vi.mock('@components/MarkdownEditor', () => ({
  default: vi.fn(),
}));

vi.mock('@ui-components/layout/Modal', () => ({
  Modal: ({ body, details, titleContext }: { body: React.ReactNode, details: React.ReactNode, titleContext: React.ReactNode }) => (
    <dialog open>{titleContext}{details}{body}</dialog>
  ),
}));

const summary = '## Key points\n\n- one\n- two';

const notebook = {
  id: 1,
  name: 'Notebook',
  ai_summary: summary,
  ai_summary_updated_at: '2026-01-02T03:04:05Z',
  ai_summary_update_requested_at: null,
};

const withoutSummary = {
  ...notebook,
  ai_summary: '',
  ai_summary_updated_at: null,
  ai_summary_update_requested_at: null,
};

const renderModal = () => {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={queryClient}>
      <IntlProvider locale="en" messages={{}}>
        <ToastProvider>
          <Tooltip.Provider>
            <NotebookSummaryModal disabled={false} notebookId={notebook.id} />
          </Tooltip.Provider>
        </ToastProvider>
      </IntlProvider>
    </QueryClientProvider>
  );
  return queryClient;
};

describe('NotebookSummaryModal', () => {
  beforeEach(() => {
    vi.mocked(NotebooksService.fetchNotebookSummary).mockResolvedValue(notebook as unknown as Notebook);
    // MDXEditor reads its markdown only on mount, so the mock does too.
    vi.mocked(MarkdownEditor).mockImplementation(({ initialValue }) => {
      const [mountedValue] = useState(initialValue);
      return <div data-testid="markdown-editor">{mountedValue}</div>;
    });
  });

  it('renders the AI summary as markdown', async () => {
    renderModal();

    const editor = await screen.findByTestId('markdown-editor');
    expect(editor.textContent).toBe(summary);
    expect(screen.getByText('Modified:')).toBeInTheDocument();
  });

  it('renders no modified date when the notebook has no summary', async () => {
    vi.mocked(NotebooksService.fetchNotebookSummary).mockResolvedValue({ ...withoutSummary, summarizable: false } as unknown as Notebook);

    renderModal();

    expect(await screen.findByText('Summary unavailable. One or more items in this notebook can’t be summarized.')).toBeInTheDocument();
    expect(screen.queryByText('Modified:')).not.toBeInTheDocument();
  });

  it('keeps showing an existing summary when the notebook is no longer summarizable', async () => {
    vi.mocked(NotebooksService.fetchNotebookSummary).mockResolvedValue({ ...notebook, summarizable: false } as unknown as Notebook);

    renderModal();

    const editor = await screen.findByTestId('markdown-editor');
    expect(editor.textContent).toBe(summary);
    expect(screen.getByText('Modified:')).toBeInTheDocument();
    expect(await screen.findByRole('button', { name: 'Regenerate notebook AI summary' })).toBeDisabled();
    expect(screen.getByText(
      'Summary regeneration unavailable: one or more items in this notebook can’t be summarized. This summary may be out of date.',
    )).toBeInTheDocument();
  });

  it('shows the new summary after it is regenerated', async () => {
    const regenerated = '## Updated points\n\n- three';
    const queryClient = renderModal();

    expect((await screen.findByTestId('markdown-editor')).textContent).toBe(summary);

    vi.mocked(NotebooksService.fetchNotebookSummary).mockResolvedValue({
      ...notebook,
      ai_summary: regenerated,
      ai_summary_updated_at: '2026-01-02T04:00:00Z',
    } as unknown as Notebook);
    await queryClient.invalidateQueries({ queryKey: [`/notebooks/${notebook.id}`] });

    await waitFor(() => {
      expect(screen.getByTestId('markdown-editor').textContent).toBe(regenerated);
    });
  });

  it('falls back to plain text with a warning when the summary cannot be parsed as markdown', async () => {
    vi.mocked(MarkdownEditor).mockImplementation(({ onError }) => {
      useEffect(() => {
        onError?.({ error: 'Parsing of the following markdown structure failed', source: '```\ncode\n```' });
      }, [onError]);
      return <div data-testid="markdown-editor" />;
    });

    renderModal();

    await waitFor(() => {
      expect(screen.getByText(/couldn’t display this content with formatting/)).toBeInTheDocument();
    });
    expect(screen.getByText(/Key points/)).toBeInTheDocument();
    expect(screen.queryByTestId('markdown-editor')).not.toBeInTheDocument();
  });

  it('renders no editor while the first summary is still being generated', async () => {
    vi.mocked(NotebooksService.fetchNotebookSummary).mockResolvedValue({ ...notebook, ai_summary: '' } as unknown as Notebook);

    renderModal();

    await waitFor(() => {
      expect(NotebooksService.fetchNotebookSummary).toHaveBeenCalled();
    });
    expect(screen.queryByTestId('markdown-editor')).not.toBeInTheDocument();
  });

  it('explains that the notebook cannot be summarized when an item has no text', async () => {
    vi.mocked(NotebooksService.fetchNotebookSummary).mockResolvedValue({ ...withoutSummary, summarizable: false } as unknown as Notebook);

    renderModal();

    expect(await screen.findByText('Summary unavailable. One or more items in this notebook can’t be summarized.')).toBeInTheDocument();
  });

  it('explains nothing when a summary can still be generated', async () => {
    vi.mocked(NotebooksService.fetchNotebookSummary).mockResolvedValue({ ...withoutSummary, summarizable: true } as unknown as Notebook);

    renderModal();

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Regenerate notebook AI summary' })).toBeEnabled();
    });
    expect(screen.queryByText('Summary unavailable. One or more items in this notebook can’t be summarized.')).not.toBeInTheDocument();
  });

  it('disables regenerating when the notebook cannot be summarized', async () => {
    vi.mocked(NotebooksService.fetchNotebookSummary).mockResolvedValue({ ...withoutSummary, summarizable: false } as unknown as Notebook);

    renderModal();

    expect(await screen.findByRole('button', { name: 'Regenerate notebook AI summary' })).toBeDisabled();
  });

  it('explains nothing while a summary is being generated', async () => {
    vi.mocked(NotebooksService.fetchNotebookSummary).mockResolvedValue({
      ...withoutSummary,
      ai_summary_update_requested_at: '2026-01-02T03:04:05Z',
      summarizable: false,
    } as unknown as Notebook);

    renderModal();

    await waitFor(() => {
      expect(NotebooksService.fetchNotebookSummary).toHaveBeenCalled();
    });
    expect(screen.queryByText('Summary unavailable. One or more items in this notebook can’t be summarized.')).not.toBeInTheDocument();
  });
});
