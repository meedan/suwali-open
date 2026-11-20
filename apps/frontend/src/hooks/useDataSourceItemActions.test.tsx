import { Toast as ToastPrimitive } from 'radix-ui';
import { IntlProvider } from 'react-intl';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';

import * as DocumentsService from '@services/DocumentsService';
import * as SourcesService from '@services/SourcesService';

import { ToastProvider } from '@hooks/useToast';

import { useDataSourceItemActions } from './useDataSourceItemActions';

vi.mock('@root/SessionContext', () => ({
  useSession: () => ({ currentHubId: () => 1 }),
}));

vi.mock('@services/SourcesService', () => ({
  updateEntityPriorityTier: vi.fn(),
  updateEntityActiveStatus: vi.fn(),
  deleteEntity: vi.fn(),
}));

vi.mock('@services/DocumentsService', () => ({ fetchDocument: vi.fn(), retryDocumentSync: vi.fn(), refreshDocument: vi.fn() }));
vi.mock('@services/ContributionsService', () => ({ fetchContribution: vi.fn(), retryContributionSync: vi.fn() }));
vi.mock('@services/NotebooksService', () => ({ fetchNotebookSummary: vi.fn(), retryNotebookSync: vi.fn() }));

const getQueryData = vi.fn();
const setQueriesData = vi.fn();
const invalidateQueries = vi.fn();

vi.mock('@tanstack/react-query', () => ({
  useQueryClient: () => ({ invalidateQueries, getQueryData, setQueriesData }),
}));

type TestItem = { id: number; priority_tier: 1 | 2; active: boolean };
type EntityType = 'documents' | 'contributions' | 'notebooks';

const TestComponent = ({ item, entityType }: { item: TestItem; entityType: EntityType }) => {
  const { handleTogglePriorityTier, handleRefresh } = useDataSourceItemActions<TestItem>({
    invalidationKeys: [['/test']],
    entityType,
  });

  return (
    <>
      <button onClick={() => handleTogglePriorityTier(item)}>Toggle</button>
      <button onClick={() => handleRefresh(item)}>Refresh</button>
    </>
  );
};

const PermalinkTestComponent = ({ item }: { item: TestItem }) => {
  const { previewId, openPreview, closePreview, handleCopyPermalink } = useDataSourceItemActions<TestItem>({
    invalidationKeys: [['/test']],
    entityType: 'contributions',
    permalink: {
      listPath: '/data-sources/contributions',
      itemPath: id => `/data-sources/contributions/${id}`,
    },
  });
  const location = useLocation();

  return (
    <>
      <p>Previewing: {previewId ?? 'nothing'}</p>
      <p>Path: {location.pathname}{location.search}</p>
      <button onClick={() => openPreview(item)}>Open</button>
      <button onClick={() => handleCopyPermalink(item)}>Copy</button>
      <button onClick={closePreview}>Close</button>
    </>
  );
};

const PreviewPauseTestComponent = ({ item }: { item: TestItem }) => {
  const { itemToPause, itemToPreview, setItemToPreview, handleTogglePreviewPause, handlePauseConfirm } = useDataSourceItemActions<TestItem>({
    invalidationKeys: [['/test']],
    entityType: 'documents',
  });

  return (
    <>
      <p>Previewing: {itemToPreview ? (itemToPreview.active ? 'active' : 'paused') : 'nothing'}</p>
      <p>Pausing: {itemToPause ? itemToPause.id : 'nothing'}</p>
      <button onClick={() => setItemToPreview(item)}>Preview</button>
      <button onClick={() => handleTogglePreviewPause()}>Pause preview</button>
      <button onClick={handlePauseConfirm}>Confirm</button>
    </>
  );
};

const ListTestComponent = ({ item }: { item: TestItem }) => {
  const { setItemToPause, handlePauseConfirm, handleTogglePriorityTier, handleRetry } = useDataSourceItemActions<TestItem>({
    invalidationKeys: [['/test']],
    listQueryKeys: [['/sources/1/documents']],
    entityType: 'documents',
  });

  return (
    <>
      <button onClick={() => setItemToPause(item)}>Pause</button>
      <button onClick={handlePauseConfirm}>Confirm</button>
      <button onClick={() => handleTogglePriorityTier(item)}>Toggle</button>
      <button onClick={() => handleRetry(item)}>Retry</button>
    </>
  );
};

// What a list of two rows holds once the patch the hook asked the cache for has been applied to it
const patchedRows = () => {
  const rows = [{ id: 1, active: true, sync_status: 'complete' }, { id: 2, active: true, sync_status: 'complete' }];
  const result = { pages: [{ data: rows }] };
  return setQueriesData.mock.calls.reduce(
    (acc, [, updater]) => updater(acc),
    result,
  ).pages[0].data;
};

const NamedPreviewPauseTestComponent = () => {
  const { itemToPause, handleTogglePreviewPause } = useDataSourceItemActions<TestItem & { type?: string }>({
    invalidationKeys: [['/test']],
  });

  return (
    <>
      <p>Pausing: {itemToPause ? `${itemToPause.type} ${itemToPause.id} ${itemToPause.active === false ? 'paused' : 'active'}` : 'nothing'}</p>
      <button onClick={() => handleTogglePreviewPause({ id: 7, type: 'Document' })}>Pause named</button>
    </>
  );
};

const renderWithProviders = (ui: React.ReactNode, initialPath = '/') =>
  render(
    <MemoryRouter initialEntries={[initialPath]}>
      <IntlProvider locale="en" messages={{}}>
        <ToastPrimitive.Provider>
          <ToastProvider>
            <Routes>
              <Route path="*" element={ui} />
              <Route path="/hub/:hubId/data-sources/contributions/:itemId" element={ui} />
            </Routes>
          </ToastProvider>
          <ToastPrimitive.Viewport />
        </ToastPrimitive.Provider>
      </IntlProvider>
    </MemoryRouter>
  );

const renderComponent = (item: TestItem, entityType: EntityType = 'documents') =>
  renderWithProviders(<TestComponent item={item} entityType={entityType} />);

describe('useDataSourceItemActions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('handleTogglePriorityTier', () => {
    describe('success toasts', () => {
      it('shows generic "item marked as important" when a tier 1 document is toggled', async () => {
        vi.mocked(SourcesService.updateEntityPriorityTier).mockResolvedValue(undefined);
        renderComponent({ id: 1, priority_tier: 1, active: true }, 'documents');
        fireEvent.click(screen.getByRole('button', { name: 'Toggle' }));
        await waitFor(() => {
          expect(screen.getByText(/item marked as important for chatbot responses/i)).toBeInTheDocument();
        });
      });

      it('shows generic "item marked as default" when a tier 2 document is toggled', async () => {
        vi.mocked(SourcesService.updateEntityPriorityTier).mockResolvedValue(undefined);
        renderComponent({ id: 1, priority_tier: 2, active: true }, 'documents');
        fireEvent.click(screen.getByRole('button', { name: 'Toggle' }));
        await waitFor(() => {
          expect(screen.getByText(/item marked as default for chatbot responses/i)).toBeInTheDocument();
        });
      });

      it('shows generic "item marked as important" when a tier 1 contribution is toggled', async () => {
        vi.mocked(SourcesService.updateEntityPriorityTier).mockResolvedValue(undefined);
        renderComponent({ id: 1, priority_tier: 1, active: true }, 'contributions');
        fireEvent.click(screen.getByRole('button', { name: 'Toggle' }));
        await waitFor(() => {
          expect(screen.getByText(/item marked as important for chatbot responses/i)).toBeInTheDocument();
        });
      });

      it('shows generic "item marked as important" when a tier 1 notebook is toggled', async () => {
        vi.mocked(SourcesService.updateEntityPriorityTier).mockResolvedValue(undefined);
        renderComponent({ id: 1, priority_tier: 1, active: true }, 'notebooks');
        fireEvent.click(screen.getByRole('button', { name: 'Toggle' }));
        await waitFor(() => {
          expect(screen.getByText(/item marked as important for chatbot responses/i)).toBeInTheDocument();
        });
      });
    });

    describe('error toasts', () => {
      it('shows "failed to mark item as important" when a tier 1 document toggle fails', async () => {
        vi.mocked(SourcesService.updateEntityPriorityTier).mockRejectedValue(new Error());
        renderComponent({ id: 1, priority_tier: 1, active: true }, 'documents');
        fireEvent.click(screen.getByRole('button', { name: 'Toggle' }));
        await waitFor(() => {
          expect(screen.getByText(/failed to mark item as important for chatbot responses/i)).toBeInTheDocument();
        });
      });

      it('shows "failed to mark item as default" when a tier 2 document toggle fails', async () => {
        vi.mocked(SourcesService.updateEntityPriorityTier).mockRejectedValue(new Error());
        renderComponent({ id: 1, priority_tier: 2, active: true }, 'documents');
        fireEvent.click(screen.getByRole('button', { name: 'Toggle' }));
        await waitFor(() => {
          expect(screen.getByText(/failed to mark item as default for chatbot responses/i)).toBeInTheDocument();
        });
      });
    });
  });

  describe('handleRefresh', () => {
    it('shows "Refresh started" toast when refresh succeeds', async () => {
      vi.mocked(DocumentsService.refreshDocument).mockResolvedValue({ success: true });
      renderComponent({ id: 1, priority_tier: 1, active: true }, 'documents');
      fireEvent.click(screen.getByRole('button', { name: 'Refresh' }));
      await waitFor(() => {
        expect(screen.getByText(/refreshing the document content from the original data source/i)).toBeInTheDocument();
      });
    });

    it('shows "Error refreshing" toast when refresh fails', async () => {
      vi.spyOn(console, 'error').mockImplementation(() => {});
      vi.mocked(DocumentsService.refreshDocument).mockRejectedValue(new Error());
      renderComponent({ id: 1, priority_tier: 1, active: true }, 'documents');
      fireEvent.click(screen.getByRole('button', { name: 'Refresh' }));
      await waitFor(() => {
        expect(screen.getByText(/there was an error refreshing the document/i)).toBeInTheDocument();
      });
    });
  });

  describe('handleTogglePreviewPause', () => {
    it('asks to confirm pausing the previewed item, and shows it paused once confirmed', async () => {
      vi.mocked(SourcesService.updateEntityActiveStatus).mockResolvedValue(undefined as never);
      renderWithProviders(<PreviewPauseTestComponent item={{ id: 7, priority_tier: 1, active: true }} />);

      fireEvent.click(screen.getByRole('button', { name: 'Preview' }));
      fireEvent.click(screen.getByRole('button', { name: 'Pause preview' }));
      expect(screen.getByText('Pausing: 7')).toBeInTheDocument();

      fireEvent.click(screen.getByRole('button', { name: 'Confirm' }));

      await waitFor(() => {
        expect(screen.getByText('Previewing: paused')).toBeInTheDocument();
      });
      expect(SourcesService.updateEntityActiveStatus).toHaveBeenCalledWith({ entityType: 'documents', entityId: 7, active: false });
      expect(screen.getByText('Pausing: nothing')).toBeInTheDocument();
    });
  });

  describe('the row of an item that is processing after a change', () => {
    const item = { id: 1, priority_tier: 1 as const, active: true };

    it('shows the status the server gives once an item is paused, and leaves other rows alone', async () => {
      vi.mocked(SourcesService.updateEntityActiveStatus).mockResolvedValue(undefined as never);
      vi.mocked(DocumentsService.fetchDocument).mockResolvedValue({ id: 1, sync_status: 'pending' } as never);
      renderWithProviders(<ListTestComponent item={item} />);

      fireEvent.click(screen.getByRole('button', { name: 'Pause' }));
      fireEvent.click(screen.getByRole('button', { name: 'Confirm' }));

      await waitFor(() => expect(DocumentsService.fetchDocument).toHaveBeenCalledWith(1));
      await waitFor(() => expect(patchedRows()[0]).toMatchObject({ active: false, sync_status: 'pending' }));
      expect(patchedRows()[1]).toMatchObject({ active: true, sync_status: 'complete' });
    });

    it('shows the status the server gives once the priority changes', async () => {
      vi.mocked(SourcesService.updateEntityPriorityTier).mockResolvedValue(undefined);
      vi.mocked(DocumentsService.fetchDocument).mockResolvedValue({ id: 1, sync_status: 'pending' } as never);
      renderWithProviders(<ListTestComponent item={item} />);

      fireEvent.click(screen.getByRole('button', { name: 'Toggle' }));

      await waitFor(() => expect(patchedRows()[0]).toMatchObject({ priority_tier: 2, sync_status: 'pending' }));
    });

    it('refetches only after the status has been learned, so a refetch cannot bring back an older one', async () => {
      vi.mocked(SourcesService.updateEntityActiveStatus).mockResolvedValue(undefined as never);
      let resolveFetch: (value: never) => void = () => {};
      vi.mocked(DocumentsService.fetchDocument).mockReturnValue(new Promise(resolve => { resolveFetch = resolve; }));
      renderWithProviders(<ListTestComponent item={item} />);

      fireEvent.click(screen.getByRole('button', { name: 'Pause' }));
      fireEvent.click(screen.getByRole('button', { name: 'Confirm' }));
      await waitFor(() => expect(DocumentsService.fetchDocument).toHaveBeenCalled());

      const refetched = () => invalidateQueries.mock.calls.some(([filters]) => filters.queryKey[0] === '/test');
      expect(refetched()).toBe(false);

      resolveFetch({ id: 1, sync_status: 'pending' } as never);
      await waitFor(() => expect(refetched()).toBe(true));

      const syncPatch = Math.max(...setQueriesData.mock.invocationCallOrder);
      const refetch = invalidateQueries.mock.invocationCallOrder[invalidateQueries.mock.calls.findIndex(([filters]) => filters.queryKey[0] === '/test')];
      expect(syncPatch).toBeLessThan(refetch);
    });

    it('never shows the row paused with its old status, only with the status the server gave', async () => {
      vi.mocked(SourcesService.updateEntityActiveStatus).mockResolvedValue(undefined as never);
      vi.mocked(DocumentsService.fetchDocument).mockResolvedValue({ id: 1, sync_status: 'pending' } as never);
      renderWithProviders(<ListTestComponent item={item} />);

      fireEvent.click(screen.getByRole('button', { name: 'Pause' }));
      fireEvent.click(screen.getByRole('button', { name: 'Confirm' }));
      await waitFor(() => expect(patchedRows()[0]).toMatchObject({ active: false, sync_status: 'pending' }));

      let rows = [{ id: 1, active: true, sync_status: 'complete' }];
      setQueriesData.mock.calls.forEach(([, updater]) => {
        rows = updater({ pages: [{ data: rows }] }).pages[0].data;
        expect(rows[0]).not.toMatchObject({ active: false, sync_status: 'complete' });
      });
    });

    it('does not let an older answer replace a newer one when changes are made in quick succession', async () => {
      vi.mocked(SourcesService.updateEntityActiveStatus).mockResolvedValue(undefined as never);
      vi.mocked(SourcesService.updateEntityPriorityTier).mockResolvedValue(undefined);
      let resolveFirst: (value: never) => void = () => {};
      vi.mocked(DocumentsService.fetchDocument)
        .mockReturnValueOnce(new Promise(resolve => { resolveFirst = resolve; }))
        .mockResolvedValueOnce({ id: 1, sync_status: 'pending' } as never);
      renderWithProviders(<ListTestComponent item={item} />);

      fireEvent.click(screen.getByRole('button', { name: 'Pause' }));
      fireEvent.click(screen.getByRole('button', { name: 'Confirm' }));
      await waitFor(() => expect(DocumentsService.fetchDocument).toHaveBeenCalledTimes(1));
      fireEvent.click(screen.getByRole('button', { name: 'Toggle' }));
      await waitFor(() => expect(patchedRows()[0]).toMatchObject({ priority_tier: 2, sync_status: 'pending' }));

      resolveFirst({ id: 1, sync_status: 'complete' } as never);
      await waitFor(() => expect(invalidateQueries.mock.calls.filter(([filters]) => filters.queryKey[0] === '/test')).toHaveLength(2));

      expect(patchedRows()[0]).toMatchObject({ active: false, sync_status: 'pending' });
    });

    it('releases the row once the item has been processed, without the list being fetched again', async () => {
      vi.useFakeTimers({ shouldAdvanceTime: true });
      try {
        vi.mocked(SourcesService.updateEntityActiveStatus).mockResolvedValue(undefined as never);
        vi.mocked(DocumentsService.fetchDocument)
          .mockResolvedValueOnce({ id: 1, sync_status: 'pending' } as never)
          .mockResolvedValueOnce({ id: 1, sync_status: 'pending' } as never)
          .mockResolvedValue({ id: 1, sync_status: 'complete' } as never);
        renderWithProviders(<ListTestComponent item={item} />);

        fireEvent.click(screen.getByRole('button', { name: 'Pause' }));
        fireEvent.click(screen.getByRole('button', { name: 'Confirm' }));
        await waitFor(() => expect(patchedRows()[0]).toMatchObject({ sync_status: 'pending' }));

        await vi.advanceTimersByTimeAsync(3000 + 5000);

        await waitFor(() => expect(patchedRows()[0]).toMatchObject({ active: false, sync_status: 'complete' }));
      } finally {
        vi.useRealTimers();
      }
    });

    describe('a retried item', () => {
      const listFetchedAgain = () => invalidateQueries.mock.calls.some(([filters]) => filters.queryKey[0] === '/sources/1/documents');

      const retryUntilSettled = async (settledStatus: string) => {
        vi.mocked(DocumentsService.retryDocumentSync).mockResolvedValue(undefined as never);
        vi.mocked(DocumentsService.fetchDocument).mockResolvedValue({ id: 1, sync_status: settledStatus } as never);
        renderWithProviders(<ListTestComponent item={item} />);

        fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
        await waitFor(() => expect(patchedRows()[0]).toMatchObject({ sync_status: 'pending' }));
        await vi.advanceTimersByTimeAsync(3000);
        await waitFor(() => expect(patchedRows()[0]).toMatchObject({ sync_status: settledStatus }));
      };

      it('has the lists fetched again once processed, so it moves out of the retryable errors', async () => {
        vi.useFakeTimers({ shouldAdvanceTime: true });
        try {
          await retryUntilSettled('complete');
          expect(listFetchedAgain()).toBe(true);
        } finally {
          vi.useRealTimers();
        }
      });

      it('stays where it is when it fails again', async () => {
        vi.useFakeTimers({ shouldAdvanceTime: true });
        try {
          await retryUntilSettled('error');
          expect(listFetchedAgain()).toBe(false);
        } finally {
          vi.useRealTimers();
        }
      });
    });

    it('keeps the change it made, and says it succeeded, when the item cannot be fetched again', async () => {
      vi.mocked(SourcesService.updateEntityActiveStatus).mockResolvedValue(undefined as never);
      vi.mocked(DocumentsService.fetchDocument).mockRejectedValue(new Error('offline'));
      renderWithProviders(<ListTestComponent item={item} />);

      fireEvent.click(screen.getByRole('button', { name: 'Pause' }));
      fireEvent.click(screen.getByRole('button', { name: 'Confirm' }));

      await waitFor(() => expect(screen.getByText('The item has been paused successfully.')).toBeInTheDocument());
      await waitFor(() => expect(DocumentsService.fetchDocument).toHaveBeenCalled());
      expect(patchedRows()[0]).toMatchObject({ active: false, sync_status: 'complete' });
    });
  });

  describe('handleTogglePreviewPause for an item named by the page', () => {
    it('pauses the copy the preview fetched, for a page with no list of its own', () => {
      getQueryData.mockReturnValue({ id: 7, priority_tier: 1, active: true });
      renderWithProviders(<NamedPreviewPauseTestComponent />);

      fireEvent.click(screen.getByRole('button', { name: 'Pause named' }));

      expect(getQueryData).toHaveBeenCalledWith(['/documents/7']);
      expect(screen.getByText('Pausing: Document 7 active')).toBeInTheDocument();
    });

    it('takes whether the item is paused from the fetched copy, as the page names only its id and type', () => {
      getQueryData.mockReturnValue({ id: 7, priority_tier: 1, active: false });
      renderWithProviders(<NamedPreviewPauseTestComponent />);

      fireEvent.click(screen.getByRole('button', { name: 'Pause named' }));

      expect(screen.getByText('Pausing: Document 7 paused')).toBeInTheDocument();
    });
  });

  describe('permalinks', () => {
    const item: TestItem = { id: 7, priority_tier: 1, active: true };

    it('copies a link to the item within the current hub', async () => {
      const writeText = vi.fn().mockResolvedValue(undefined);
      Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
      renderWithProviders(<PermalinkTestComponent item={item} />);

      fireEvent.click(screen.getByRole('button', { name: 'Copy' }));

      await waitFor(() => {
        expect(writeText).toHaveBeenCalledWith(`${window.location.origin}/hub/1/data-sources/contributions/7`);
      });
      expect(await screen.findByText('Permalink copied!')).toBeInTheDocument();
    });

    it('previews the linked item and returns to the list when the preview is closed', async () => {
      renderWithProviders(<PermalinkTestComponent item={item} />, '/hub/1/data-sources/contributions/42');

      expect(screen.getByText('Previewing: 42')).toBeInTheDocument();

      fireEvent.click(screen.getByRole('button', { name: 'Close' }));

      expect(await screen.findByText('Path: /hub/1/data-sources/contributions')).toBeInTheDocument();
      expect(screen.getByText('Previewing: nothing')).toBeInTheDocument();
    });

    it('moves the URL to the item’s permalink when its preview opens, and back when it closes, keeping the filters', async () => {
      renderWithProviders(<PermalinkTestComponent item={item} />, '/hub/1/data-sources/contributions?sort=title');

      fireEvent.click(screen.getByRole('button', { name: 'Open' }));

      expect(await screen.findByText('Path: /hub/1/data-sources/contributions/7?sort=title')).toBeInTheDocument();
      expect(screen.getByText('Previewing: 7')).toBeInTheDocument();

      fireEvent.click(screen.getByRole('button', { name: 'Close' }));

      expect(await screen.findByText('Path: /hub/1/data-sources/contributions?sort=title')).toBeInTheDocument();
      expect(screen.getByText('Previewing: nothing')).toBeInTheDocument();
    });
  });
});
