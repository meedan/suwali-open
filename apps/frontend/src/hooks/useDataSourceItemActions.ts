import { useRef, useState } from 'react';
import { defineMessages, useIntl } from 'react-intl';
import { useLocation, useNavigate, useParams } from 'react-router';
import { type InfiniteData, useQueryClient } from '@tanstack/react-query';

import type { PriorityTier } from '@customTypes/priority-tier';

import { fetchContribution, retryContributionSync } from '@services/ContributionsService';
import { fetchDocument, refreshDocument, retryDocumentSync } from '@services/DocumentsService';
import { fetchNotebookSummary, retryNotebookSync } from '@services/NotebooksService';
import { deleteEntity, updateEntityActiveStatus, updateEntityPriorityTier } from '@services/SourcesService';

import { useHubPath } from '@hooks/useHubPath';
import { useSyncStatusSettling } from '@hooks/useSyncStatusSettling';
import { useToast } from '@hooks/useToast';

const messages = defineMessages({
  pausedTitle: {
    id: 'global.pausedTitle',
    defaultMessage: 'Paused',
    description: 'Toast title when an item is paused',
  },
  pausedMessage: {
    id: 'global.pausedMessage',
    defaultMessage: 'The item has been paused successfully.',
    description: 'Toast message when an item is paused',
  },
  reactivatedTitle: {
    id: 'global.reactivatedTitle',
    defaultMessage: 'Reactivated',
    description: 'Toast title when an item is reactivated',
  },
  reactivatedMessage: {
    id: 'global.reactivatedMessage',
    defaultMessage: 'The item has been reactivated successfully.',
    description: 'Toast message when an item is reactivated',
  },
  removedTitle: {
    id: 'global.removedTitle',
    defaultMessage: 'Removed',
    description: 'Toast title when an item is deleted',
  },
  removedMessage: {
    id: 'global.removedMessage',
    defaultMessage: 'The item has been removed successfully.',
    description: 'Toast message when an item is deleted',
  },
  removeErrorTitle: {
    id: 'global.removeErrorTitle',
    defaultMessage: 'Error removing item',
    description: 'Toast title when item deletion fails',
  },
  removeErrorMessage: {
    id: 'global.removeErrorMessage',
    defaultMessage: 'There was an error removing the item. Please try again.',
    description: 'Toast message when item deletion fails',
  },
  retrySuccessTitle: {
    id: 'global.retrySuccessTitle',
    defaultMessage: 'Processing started',
    description: 'Toast title when retry succeeds',
  },
  retrySuccessMessage: {
    id: 'global.retrySuccessMessage',
    defaultMessage: 'Processing successfully started',
    description: 'Toast message when retry succeeds',
  },
  retryErrorTitle: {
    id: 'global.retryErrorTitle',
    defaultMessage: 'Error retrying',
    description: 'Toast title when retry fails',
  },
  retryErrorMessage: {
    id: 'global.retryErrorMessage',
    defaultMessage: 'There was an error retrying the processing. Please try again.',
    description: 'Toast message when retry fails',
  },
  markImportantSuccess: {
    id: 'dataSourcesItemTitlePriorityTier.markImportantSuccess',
    defaultMessage: 'Item marked as important for chatbot responses.',
    description: 'Toast message when an item is successfully marked as important (tier 2)',
  },
  markDefaultSuccess: {
    id: 'dataSourcesItemTitlePriorityTier.markDefaultSuccess',
    defaultMessage: 'Item marked as default for chatbot responses.',
    description: 'Toast message when an item is successfully marked as default (tier 1)',
  },
  markImportantError: {
    id: 'dataSourcesItemTitlePriorityTier.markImportantError',
    defaultMessage: 'Failed to mark item as important for chatbot responses.',
    description: 'Toast message when marking an item as important (tier 2) fails',
  },
  markDefaultError: {
    id: 'dataSourcesItemTitlePriorityTier.markDefaultError',
    defaultMessage: 'Failed to mark item as default for chatbot responses.',
    description: 'Toast message when marking an item as default (tier 1) fails',
  },
  pauseError: {
    id: 'global.pauseError',
    defaultMessage: 'Failed to pause item.',
    description: 'Toast message when pausing an item fails',
  },
  reactivateError: {
    id: 'global.reactivateError',
    defaultMessage: 'Failed to reactivate item.',
    description: 'Toast message when reactivating an item fails',
  },
  refreshSuccessTitle: {
    id: 'dataSourcesItemRefresh.successTitle',
    defaultMessage: 'Refresh started',
    description: 'Toast title when a document refresh succeeds',
  },
  refreshSuccessMessage: {
    id: 'dataSourcesItemRefresh.successMessage',
    defaultMessage: 'Refreshing the document content from the original data source.',
    description: 'Toast message when a document refresh succeeds',
  },
  refreshErrorTitle: {
    id: 'dataSourcesItemRefresh.errorTitle',
    defaultMessage: 'Error refreshing',
    description: 'Toast title when a document refresh fails',
  },
  refreshErrorMessage: {
    id: 'dataSourcesItemRefresh.errorMessage',
    defaultMessage: 'There was an error refreshing the document. Please try again.',
    description: 'Toast message when a document refresh fails',
  },
  permalinkCopied: {
    id: 'global.permalinkCopied',
    defaultMessage: 'Permalink copied',
    description: 'Confirmation message shown when permalink is copied',
  },
  permalinkCopyFailed: {
    id: 'global.permalinkCopyFailed',
    defaultMessage: 'Failed to copy permalink',
    description: 'Error message shown when permalink copy fails',
  },
});

type EntityType = 'contributions' | 'documents' | 'notebooks';
type DeletableEntityType = Extract<EntityType, 'contributions' | 'documents'>;

const ENTITY_TYPE_MAP: Record<string, EntityType> = {
  Contribution: 'contributions',
  Document: 'documents',
  Notebook: 'notebooks',
};

type DataSourceItemActionsParams = {
  invalidationKeys: string[][];
  listQueryKeys?: string[][];
  entityType?: EntityType;
  // Routes for items whose preview can be opened from a link: the list, and an item within it (the `:itemId` route)
  permalink?: {
    listPath: string;
    itemPath: (id: number) => string;
  };
};

export function useDataSourceItemActions<T extends { id: number; active?: boolean; priority_tier?: PriorityTier; sync_status?: string; type?: string; updated_at?: string }>({
  invalidationKeys,
  listQueryKeys,
  entityType,
  permalink,
}: DataSourceItemActionsParams) {
  const intl = useIntl();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const navigate = useNavigate();
  const hubPath = useHubPath();
  const { itemId } = useParams();
  const { search } = useLocation();

  const [itemToPreview, setItemToPreview] = useState<T | null>(null);
  const [itemToAddToNotebook, setItemToAddToNotebook] = useState<T | null>(null);
  const [itemToPause, setItemToPause] = useState<T | null>(null);
  const [itemToDelete, setItemToDelete] = useState<T | null>(null);

  const permalinkedId = permalink ? Number(itemId) || undefined : undefined;
  const previewId = itemToPreview?.id ?? permalinkedId;

  const refetch = () => invalidationKeys.forEach(key => queryClient.invalidateQueries({ queryKey: key }));

  const patchItemInCache = (item: T, updates: Partial<T>) => {
    if (!listQueryKeys?.length) return;
    type PageData = { data: T[] };
    listQueryKeys.forEach(key => {
      queryClient.setQueriesData<InfiniteData<PageData>>(
        { queryKey: key },
        (old) => {
          if (!old) return old;
          return {
            ...old,
            pages: old.pages.map(page => ({
              ...page,
              data: page.data.map(existing =>
                (existing as { id: number }).id === item.id ? { ...existing, ...updates } : existing
              ),
            })),
          };
        }
      );
    });
  };

  // For non-delete actions: patch list in-place if listQueryKeys provided, otherwise invalidate.
  const updateOrRefetch = (item: T, updates: Partial<T>) => {
    if (listQueryKeys?.length) {
      patchItemInCache(item, updates);
      refetch();
    } else {
      refetch();
    }
  };

  // The server marks an item pending after it has responded to the change, so its status is learned by asking again, not from
  // the response; one item rather than the whole list, which would refetch every page and could move the row
  const fetchSyncStatus = async (item: T, resolvedType: EntityType) => {
    try {
      const fetched = resolvedType === 'documents'
        ? await fetchDocument(item.id)
        : resolvedType === 'contributions' ? await fetchContribution(item.id) : await fetchNotebookSummary(item.id);
      return fetched?.sync_status as string | undefined;
    } catch {
      return undefined;
    }
  };

  // Looks at an item are numbered as they are made, and answers can come back in any order, so a status is the newest known
  // only if no look was made after it; an older one must not replace what a later look has told the row
  const lookCounts = useRef(new Map<string, number>());
  const lookAtSyncStatus = async (item: T, resolvedType: EntityType) => {
    const key = `${resolvedType}-${item.id}`;
    const count = (lookCounts.current.get(key) ?? 0) + 1;
    lookCounts.current.set(key, count);
    const status = await fetchSyncStatus(item, resolvedType);
    return lookCounts.current.get(key) === count ? status : undefined;
  };

  // moveOnSettle: the item may belong to another list once settled, as a retried one leaves the retryable errors, so the lists are fetched again
  type Watched = { item: T; resolvedType: EntityType; moveOnSettle?: boolean };
  const watchSettling = useSyncStatusSettling<Watched>({
    fetchStatus: ({ item, resolvedType }) => lookAtSyncStatus(item, resolvedType),
    onSettled: ({ item, resolvedType, moveOnSettle }, status) => {
      patchItemInCache(item, { sync_status: status } as Partial<T>);
      if (moveOnSettle && status !== 'error') listQueryKeys?.forEach(key => queryClient.invalidateQueries({ queryKey: key }));
      // So an open preview of the item shows where it ended up
      queryClient.invalidateQueries({ queryKey: [`/${resolvedType}/${item.id}`] });
    },
  });

  // A row set pending would stay locked until its list is fetched again, so it is watched until it has been processed
  const settleLater = (item: T, resolvedType: EntityType, moveOnSettle = false) => {
    if (listQueryKeys?.length) watchSettling(`${resolvedType}-${item.id}`, { item, resolvedType, moveOnSettle });
  };

  // For a change the server answers by marking the item pending: learn its status, patch it into the row with the change so
  // that the row does not read the change as settled first, and only then refetch, so that a refetch of the list cannot bring
  // back a status older than the one just learned
  const updateAndSync = async (item: T, updates: Partial<T>, resolvedType: EntityType) => {
    const status = listQueryKeys?.length ? await lookAtSyncStatus(item, resolvedType) : undefined;
    patchItemInCache(item, status ? { ...updates, sync_status: status } : updates);
    if (status === 'pending') settleLater(item, resolvedType);
    refetch();
  };

  // For delete: always invalidate the list so the removed item disappears.
  const refetchAll = () => {
    refetch();
    listQueryKeys?.forEach(key => queryClient.invalidateQueries({ queryKey: key }));
  };

  const handleTogglePriorityTier = (item: T) => {
    const resolvedType = entityType ?? ENTITY_TYPE_MAP[item.type!];
    const action = item.priority_tier === 2 ? 'default' : 'important';
    updateEntityPriorityTier(resolvedType, item.id, item.priority_tier === 2 ? 1 : 2)
      .then(() => {
        void updateAndSync(item, { priority_tier: item.priority_tier === 2 ? 1 : 2, updated_at: new Date().toISOString() } as Partial<T>, resolvedType);
        toast('success', intl.formatMessage(action === 'important' ? messages.markImportantSuccess : messages.markDefaultSuccess));
      })
      .catch(() => {
        toast('error', intl.formatMessage(action === 'important' ? messages.markImportantError : messages.markDefaultError));
      });
  };

  const handlePauseConfirm = async () => {
    if (itemToPause) {
      const isPaused = itemToPause.active === false;
      const resolvedType = entityType ?? ENTITY_TYPE_MAP[itemToPause.type!];
      try {
        await updateEntityActiveStatus({
          entityType: resolvedType,
          entityId: itemToPause.id,
          active: !itemToPause.active,
        });
        void updateAndSync(itemToPause, { active: !itemToPause.active, updated_at: new Date().toISOString() } as Partial<T>, resolvedType);
        // So an open preview of the item shows it paused, or reactivated, and offers the opposite next
        queryClient.invalidateQueries({ queryKey: [`/${resolvedType}/${itemToPause.id}`] });
        setItemToPreview(current => current?.id === itemToPause.id ? { ...current, active: !itemToPause.active } : current);
        if (isPaused) {
          toast('success', intl.formatMessage(messages.reactivatedMessage), intl.formatMessage(messages.reactivatedTitle));
        } else {
          toast('success', intl.formatMessage(messages.pausedMessage), intl.formatMessage(messages.pausedTitle));
        }
      } catch (error) {
        console.error('Error updating active status:', error);
        if (isPaused) {
          toast('error', intl.formatMessage(messages.reactivateError));
        } else {
          toast('error', intl.formatMessage(messages.pauseError));
        }
      } finally {
        setItemToPause(null);
      }
    }
  };

  const handleDeleteConfirm = async () => {
    if (itemToDelete) {
      const resolvedType = (entityType ?? ENTITY_TYPE_MAP[itemToDelete.type!]) as DeletableEntityType;
      try {
        await deleteEntity({
          entityType: resolvedType,
          entityId: itemToDelete.id,
        });
        refetchAll();
        toast('success', intl.formatMessage(messages.removedMessage), intl.formatMessage(messages.removedTitle));
      } catch (error) {
        console.error('Error deleting item:', error);
        toast('error', intl.formatMessage(messages.removeErrorMessage), intl.formatMessage(messages.removeErrorTitle));
      } finally {
        setItemToDelete(null);
      }
    }
  };

  const handleRetry = async (item: T) => {
    const resolvedType = entityType ?? ENTITY_TYPE_MAP[item.type!];

    try {
      if (resolvedType === 'documents') {
        await retryDocumentSync(item.id);
      } else if (resolvedType === 'notebooks') {
        await retryNotebookSync(item.id);
      } else if (resolvedType === 'contributions') {
        await retryContributionSync(item.id);
      }
      updateOrRefetch(item, { sync_status: 'pending' } as Partial<T>);
      queryClient.invalidateQueries({ queryKey: [`/${resolvedType}/${item.id}`] });
      settleLater(item, resolvedType, true);
      toast('success', intl.formatMessage(messages.retrySuccessMessage), intl.formatMessage(messages.retrySuccessTitle));
    } catch (error) {
      console.error('Error retrying item:', error);
      toast('error', intl.formatMessage(messages.retryErrorMessage), intl.formatMessage(messages.retryErrorTitle));
    }
  };

  const handleRefresh = async (item: T) => {
    try {
      await refreshDocument(item.id);
      updateOrRefetch(item, { sync_status: 'pending' } as Partial<T>);
      settleLater(item, 'documents');
      toast('success', intl.formatMessage(messages.refreshSuccessMessage), intl.formatMessage(messages.refreshSuccessTitle));
    } catch (error) {
      console.error('Error refreshing document:', error);
      toast('error', intl.formatMessage(messages.refreshErrorMessage), intl.formatMessage(messages.refreshErrorTitle));
    }
  };

  // Keeps the URL on the item's permalink while its preview is open; the query string carries the list's filters
  const openPreview = (item: T) => {
    setItemToPreview(item);
    if (permalink) navigate(`${hubPath(permalink.itemPath(item.id))}${search}`, { replace: true });
  };

  const closePreview = () => {
    setItemToPreview(null);
    if (permalink && permalinkedId) navigate(`${hubPath(permalink.listPath)}${search}`, { replace: true });
  };

  const handleTogglePreviewPriorityTier = () => {
    // A permalinked item may not be in the loaded list, so fall back to the copy the preview modal fetched
    const item = itemToPreview ?? queryClient.getQueryData<T>([`/${entityType}/${previewId}`]);
    if (item) handleTogglePriorityTier(item);
  };

  // Where there is no list to preview from, the item to pause is named, and is the copy the preview modal fetched
  const handleTogglePreviewPause = (target?: { id: number; type: string }) => {
    const resolvedType = entityType ?? ENTITY_TYPE_MAP[target?.type ?? ''];
    const id = target?.id ?? previewId;
    // A permalinked item may not be in the loaded list, so fall back to the copy the preview modal fetched
    const item = (target ? null : itemToPreview) ?? queryClient.getQueryData<T>([`/${resolvedType}/${id}`]);
    if (item) setItemToPause(target ? { ...item, type: target.type } : item);
  };

  const handleRetryPreview = () => {
    // A permalinked item may not be in the loaded list, so fall back to the copy the preview modal fetched
    const item = itemToPreview ?? queryClient.getQueryData<T>([`/${entityType}/${previewId}`]);
    if (item) void handleRetry(item);
  };

  const handleCopyPermalink = async (item: T) => {
    if (!permalink) return;
    try {
      await navigator.clipboard.writeText(`${window.location.origin}${hubPath(permalink.itemPath(item.id))}`);
      toast('success', intl.formatMessage(messages.permalinkCopied));
    } catch (error) {
      console.error('Failed to copy permalink:', error);
      toast('error', intl.formatMessage(messages.permalinkCopyFailed));
    }
  };

  return {
    previewId,
    openPreview,
    closePreview,
    handleTogglePreviewPriorityTier,
    handleTogglePreviewPause,
    handleRetryPreview,
    handleCopyPermalink,
    itemToPreview,
    setItemToPreview,
    itemToAddToNotebook,
    setItemToAddToNotebook,
    itemToPause,
    setItemToPause,
    itemToDelete,
    setItemToDelete,
    handlePauseConfirm,
    handleDeleteConfirm,
    handleRetry,
    handleRefresh,
    handleTogglePriorityTier,
  };
}
