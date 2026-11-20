import { useEffect, useMemo, useState } from "react";
import { defineMessages, FormattedMessage, useIntl } from "react-intl";
import { useLocation, useNavigate, useParams } from  "react-router";
import { useQueries, useQuery, useQueryClient } from "@tanstack/react-query";

import type { Note } from '@customTypes/note';
import type  { Notebook } from "@customTypes/notebook";
import type { NotebookItem } from "@customTypes/notebook-item";
import type { PriorityTier } from "@customTypes/priority-tier";

import { PAGINATION_WINDOW_SIZE } from "@constants/App";

import { isUnavailableError } from "@helpers/http";
import { getIdFromParamsOrLastPath, getLastPath, removeLastPath, setLastPath } from "@helpers/lastPath";

import { fetchItems, fetchNotebooksPaginated, fetchNotebookSummary, updateNotebook } from "@services/NotebooksService";

import { useSession } from "@root/SessionContext";
import SuwaliErrorBoundary from "@root/SuwaliErrorBoundary";

import { useBidirectionalInfiniteScroll } from "@hooks/useBidirectionalInfiniteScroll";
import { useDataSourceItemActions } from '@hooks/useDataSourceItemActions';
import { useHubPath } from '@hooks/useHubPath';
import { useIsInTabletRange, useResponsiveDrawer } from '@hooks/useLayout';
import usePageTitle from '@hooks/usePageTitle';
import { usePaginatedListScroll } from "@hooks/usePaginatedListScroll";
import { useToast } from '@hooks/useToast';

import EmptyState from "@ui-components/layout/EmptyState";
import Icon from "@ui-components/layout/Icon";
import { Layout } from '@ui-components/layout/Layout';
import LeveledSidebar from "@ui-components/navigation/LeveledSidebar";

import Fallback from "@layouts/error/Fallback";
import NotFound from "@layouts/error/NotFound";

import ConfirmPauseModal from "@components/ConfirmPauseModal";
import ConversationPreviewModal from "@components/ConversationPreviewModal";
import DataSourceItemPreviewModal from "@components/DataSourceItemPreviewModal";
import EditableTitle from "@components/EditableTitle";
import EndUserQuestionPreviewModal from "@components/EndUserQuestionPreviewModal";
import MessagePreviewModal from "@components/MessagePreviewModal";
import NoteEditModal from "@components/NoteEditModal";

import NotebookSidebar from "./NotebookSidebar";
import NotebooksSidebar from "./NotebooksSidebar";
import NotebookSummaryPanel from "./NotebookSummaryPanel";

const messages = defineMessages({
  errorTitle: {
    id: 'global.error',
    defaultMessage: 'Error',
    description: 'Generic error title for toast messages',
  },
  successTitle: {
    id: 'global.success',
    defaultMessage: 'Success',
    description: 'Generic success title for toast messages',
  },
  renameSuccess: {
    id: 'notebooksMain.renameSuccess',
    defaultMessage: 'Notebook renamed successfully',
    description: 'Toast message displayed when renaming a notebook succeeds',
  },
  renameError: {
    id: 'notebooksMain.renameError',
    defaultMessage: 'Failed to rename notebook',
    description: 'Toast message displayed when renaming a notebook fails',
  },
});

const NotebooksMain = () => {
  const intl = useIntl();
  const location = useLocation();
  const navigate = useNavigate();
  const params = useParams();
  const session = useSession();
  const hubId = session.currentHubId();
  const hubPath = useHubPath();

  const [mobileTab, setMobileTab] = useState('mobile-main');
  const [levelVisible, setLevelVisible] = useState(1);
  const [selectedItemId, setSelectedItemId] = useState<number | null>(Number(params.itemId) || null);
  const [selectedAssetSettled, setSelectedAssetSettled] = useState(false);
  const isInTabletRange = useIsInTabletRange('501px', '850px');
  const [isLeftNavVisible, setIsLeftNavVisible] = useResponsiveDrawer('850px');
  const { toast } = useToast();

  // initialAroundId is resolved and set only once on first render
  const [initialAroundId] = useState<number | null>(() =>
    getIdFromParamsOrLastPath(
      params.notebookId,
      'notebooksLastPath',
      hubId,
      /\/notebooks\/(\d+)/
    )
  );

  const notebooksPath = `/hubs/${hubId}/notebooks`;

  const nbsQuery = useBidirectionalInfiniteScroll<Notebook>({
    queryKey: [notebooksPath],
    queryFn: (aroundId, windowSize) => fetchNotebooksPaginated(hubId, aroundId, windowSize),
    initialAroundId,
    windowSize: PAGINATION_WINDOW_SIZE,
    enabled: Boolean(hubId),
  });

  const {
    items: notebooks = [],
    refetchAroundId,
    jumpToEdge,
    pagination,
  } = nbsQuery;

  const selectedNotebookId = params.notebookId ? parseInt(params.notebookId, 10) : null;
  const listedNotebook = useMemo(
    () => notebooks.find((notebook: Notebook) => notebook.id === selectedNotebookId) ?? null,
    [notebooks, selectedNotebookId],
  );

  const selectedNotebookQuery = useQuery({
    queryKey: [`/notebooks/${selectedNotebookId}`],
    queryFn: () => fetchNotebookSummary(selectedNotebookId!),
    enabled: Boolean(selectedNotebookId),
  });

  // After an edit to the open notebook; recentres on it only while it's loaded, so an edit doesn't undo a jump to the top
  const refreshAfterEdit = (notebookId: number) =>
    refetchAroundId(notebooks.some((notebook: Notebook) => notebook.id === notebookId) ? notebookId : undefined);

  const fetchedNotebook = selectedNotebookQuery.data;
  // This page lists only the user's own notebooks, so anyone else's is as unavailable as a missing one
  const isNotListable = Boolean(fetchedNotebook && (fetchedNotebook.hub_id !== hubId || fetchedNotebook.user_id !== session.user?.id));
  const isSelectedNotebookUnavailable = Boolean(selectedNotebookId) && !listedNotebook &&
    (isNotListable || isUnavailableError(selectedNotebookQuery.error));
  // A failed refetch keeps the cached copy as data, so it's dropped here rather than rendered
  const selectedNotebook = isSelectedNotebookUnavailable ? null : listedNotebook ?? fetchedNotebook ?? null;

  usePageTitle(
    selectedNotebook?.name ? (
      <>{selectedNotebook.name}</>
    ) : (
      <FormattedMessage
        id="global.notebooksPageTitle"
        defaultMessage="Notebooks"
        description="Browser Page title for the notebooks page"
      />
    )
  );

  const itemsQueryPath = `/notebooks/${selectedNotebook?.id}/items`;

  const [itemsQuery] = useQueries({
    queries: [
      { queryKey: [itemsQueryPath], queryFn: () => fetchItems(selectedNotebook?.id), enabled: Boolean(selectedNotebook?.id) },
    ],
  });

  const items  = useMemo(() => {
    const data = itemsQuery.data;
    return Array.isArray(data) ? data : [];
  }, [itemsQuery.data]);

  const selectedItem: NotebookItem | null = selectedItemId ? (items.find((item: NotebookItem) => item.id === selectedItemId) ?? null) : null;

  const queryClient = useQueryClient();

  // Back to the notebooks level once nothing is open, e.g. after the open notebook is removed
  useEffect(() => {
    if (selectedAssetSettled && !selectedNotebookId) setLevelVisible(0);
  }, [selectedAssetSettled, selectedNotebookId]);

  // A shared link to a notebook that is missing or someone else's shows as not found, beside the notebooks list
  useEffect(() => {
    if (!isSelectedNotebookUnavailable) return;
    setLevelVisible(0);
    if (getLastPath('notebooksLastPath', hubId) === `/notebooks/${selectedNotebookId}`) removeLastPath('notebooksLastPath', hubId);
  }, [isSelectedNotebookUnavailable, selectedNotebookId, hubId]);

  useEffect(() => {
    if (nbsQuery.isPending) return;

    const notebookId = params.notebookId || '';
    const requestedNotebookId = notebookId ? parseInt(notebookId, 10) : null;

    // Nothing to do if the page already reflects what the URL is asking for.
    if (selectedAssetSettled && requestedNotebookId === (selectedNotebook?.id ?? null)) return;

    const setupSelectedAsset = (notebookId: string, itemId: string) => {
      let selected = null;
      let lastPath = null;

      if (notebookId) {
        selected = notebooks.find((n: Notebook) => n.id === parseInt(notebookId, 10));
      } else {
        lastPath = getLastPath('notebooksLastPath', hubId);
        if (lastPath?.includes('/items/')) {
          lastPath = lastPath.split('/items/')[0];
        }
      }

      if (notebooks.length === 0 && !notebookId) {
        setLevelVisible(0);
        navigate(hubPath('/notebooks'), { replace: true });
        removeLastPath('notebooksLastPath', hubId);
        setSelectedAssetSettled(true);
      } else if (selected) {
          setSelectedItemId(Number(itemId) || null);
          setMobileTab('mobile-main');
          setLevelVisible(1);
          setLastPath('notebooksLastPath', hubId, `/notebooks/${selected?.id}`);
          setSelectedAssetSettled(true);
      } else if (notebookId) {
        // Not in the loaded window; its own query opens it, or shows it as not found
        if (!selectedAssetSettled) {
          setMobileTab('mobile-main');
          setSelectedAssetSettled(true);
        }
      } else if (lastPath) {
        navigate(hubPath(lastPath), { replace: true });
      } else {
        navigate(hubPath(`/notebooks/${notebooks[0].id}`), { replace: true });
        setMobileTab('mobile-main');
        setLevelVisible(1);
      }
    };

    setupSelectedAsset(notebookId, params.itemId || '');
  }, [params.notebookId, params.itemId, notebooks, nbsQuery.isPending, navigate, location.pathname, selectedAssetSettled, hubId, hubPath, selectedNotebook]);

  // Handle scroll behavior for paginated list
  const { topObserverTarget, bottomObserverTarget } = usePaginatedListScroll({
    containerElementId: 'notebooks-sidebar-list',
    itemIdPrefix: 'notebook',
    query: nbsQuery,
  });

  const {
    itemToPause,
    setItemToPause,
    handlePauseConfirm,
    handleTogglePreviewPause,
    handleTogglePriorityTier,
  } = useDataSourceItemActions<{ id: number; type: string; active?: boolean; priority_tier?: PriorityTier; title?: string; name?: string }>({
    invalidationKeys: [[itemsQueryPath]],
  });

  // The error is thrown to be caught by the SuwaliErrorBoundary, which will show a fallback UI and report the error to Sentry.
  if (nbsQuery.error) throw nbsQuery.error;
  if (selectedNotebookQuery.error && !listedNotebook && !isUnavailableError(selectedNotebookQuery.error)) {
    throw selectedNotebookQuery.error;
  }

  const dataSourceSelectedItem = selectedItem && (
    selectedItem.item_type === 'Document' ||
    selectedItem.item_type === 'Contribution' ||
    selectedItem.item_type === 'Notebook'
  ) ? {
    id: selectedItem.item_id,
    type: selectedItem.item_type,
    priority_tier: selectedItem.item.priority_tier,
  } : null;

  const handleNotebookSelect = (notebook: Notebook, postDelete: boolean = false) => {
    setLastPath('notebooksLastPath', hubId, `/notebooks/${notebook.id}`);
    if (!postDelete) {
      setLevelVisible(1);
    }
    navigate(hubPath(`/notebooks/${notebook.id}`), { replace: postDelete });

    if (selectedItem && notebook.id !== selectedNotebook?.id) {
      setSelectedItemId(null);
    }
  };

  const handleCloseItem = () => {
    setSelectedItemId(null);
    navigate(hubPath(`/notebooks/${selectedNotebook?.id}`));
  };

  const nbIcon = (notebook: Notebook) => {
    if (notebook.published) {
      return (notebook.active ? 'published_status' : 'published_paused');
    }
    else {
      return 'unpublished_dashed';
    }
  }

  const editableTitle = (
    <EditableTitle
      canEdit
      icon={selectedNotebook && <Icon id={nbIcon(selectedNotebook)} aria-hidden />}
      value={selectedNotebook?.name || ''}
      onSave={async (newTitle) => {
        try {
          await updateNotebook({ id: selectedNotebook?.id, name: newTitle});
          if (selectedNotebook) refreshAfterEdit(selectedNotebook.id);
          queryClient.invalidateQueries({ queryKey: [`/notebooks/${selectedNotebook?.id}`] });
          if (selectedNotebook?.published) {
            queryClient.invalidateQueries({ queryKey: [`/hubs/${hubId}/notebooks?published=true`]});
          }
          toast('success', intl.formatMessage(messages.renameSuccess), intl.formatMessage(messages.successTitle));
        } catch {
          toast('error', intl.formatMessage(messages.renameError), intl.formatMessage(messages.errorTitle));
        }
      }}
    />
  );

  return (
    <>
      <Layout
        leftDrawerOpen={isLeftNavVisible}
        onLeftDrawerOpenChange={setIsLeftNavVisible}
        mobileTab={mobileTab}
        onMobileTabChange={setMobileTab}
      >
        <Layout.Left
          name={
            <FormattedMessage
              id="global.notebook"
              defaultMessage="Notebook"
              description="Reusable label for a notebook page or title"
            />
          }
        >
          <SuwaliErrorBoundary>
            <LeveledSidebar
              levelVisible={levelVisible}
              topLevelContent={
                <NotebooksSidebar
                  topObserverTarget={topObserverTarget}
                  bottomObserverTarget={bottomObserverTarget}
                  isPending={nbsQuery.isPending}
                  notebooks={notebooks}
                  totalCount={pagination?.total_count}
                  selectedNotebook={selectedNotebook}
                  onNavigateBack={
                    selectedNotebook ? () => setLevelVisible(1) : undefined
                  }
                  onNotebookSelect={handleNotebookSelect}
                  refetchAroundId={refetchAroundId}
                  onJumpToTop={nbsQuery.hasPrevious ? () => jumpToEdge('first') : undefined}
                />
              }
              nestedLevelContent={
                <NotebookSidebar
                  // Until a notebook resolves the page opens on this level, so it shows the skeleton too
                  isPending={selectedNotebook ? itemsQuery.isPending : !selectedAssetSettled}
                  error={itemsQuery.error}
                  notebook={selectedNotebook}
                  notebookItems={items}
                  selectedItem={selectedItem}
                  onNavigateBack={() => {
                    setLevelVisible(0);
                  }}
                  onItemSelect={(nbItem) => {
                    navigate(hubPath(`/notebooks/${selectedNotebook?.id}/items/${nbItem.id}`));
                    setSelectedItemId(nbItem.id);
                    setMobileTab('mobile-main');
                    if (isInTabletRange) {
                      setIsLeftNavVisible(false);
                    }
                  }}
                />
              }
            />
          </SuwaliErrorBoundary>
        </Layout.Left>
        <Layout.Main
          name={
            <FormattedMessage
              id="global.details"
              defaultMessage="Details"
              description="Label for interaction when the user selects this item it will show the details of the associated area"
            />
          }
        >
          <SuwaliErrorBoundary
            fallback={<Fallback actions={['backHome', 'contactSupport', 'tryAgain' ]} />}
          >
            { selectedItem && selectedItem.item_type === 'Note' &&
              <NoteEditModal
                note={selectedItem.item as Note}
                open={Boolean(selectedItem)}
                onOpenChange={(open) => {
                  if (!open) handleCloseItem();
                }}
              />
            }
            <ConfirmPauseModal
              open={Boolean(itemToPause)}
              paused={itemToPause?.active === false}
              entityTitle={itemToPause?.title ?? itemToPause?.name}
              entityType={(itemToPause?.type as 'Document' | 'Contribution' | 'Notebook' | undefined) ?? 'Document'}
              onCancel={() => setItemToPause(null)}
              onConfirm={handlePauseConfirm}
            />
            { selectedItem &&
              ( selectedItem.item_type === 'Document' ||
                selectedItem.item_type === 'Contribution' ||
                selectedItem.item_type === 'Notebook'
              ) &&
                <DataSourceItemPreviewModal
                  id={selectedItem.item_id}
                  type={selectedItem.item_type}
                  open={Boolean(selectedItem)}
                  onOpenChange={(open) => {
                    if (!open) handleCloseItem();
                  }}
                  onTogglePause={dataSourceSelectedItem ? () => handleTogglePreviewPause(dataSourceSelectedItem) : undefined}
                  onTogglePriorityTier={dataSourceSelectedItem ? () => handleTogglePriorityTier(dataSourceSelectedItem) : undefined}
                />
            }
            { selectedItem?.item_type === 'Conversation' &&
              <ConversationPreviewModal
                conversation={selectedItem.item}
                open={Boolean(selectedItem)}
                onOpenChange={(open) => {
                  if (!open) handleCloseItem();
                }}
              />
            }
            { selectedItem?.item_type === 'Message' &&
              <MessagePreviewModal
                message={selectedItem.item}
                open={Boolean(selectedItem)}
                onOpenChange={(open) => {
                  if (!open) handleCloseItem();
                }}
              />
            }
            { selectedItem?.item_type === 'MessageCluster' &&
              <EndUserQuestionPreviewModal
                answered={selectedItem.item.last_message_answered_status === true}
                cluster={selectedItem.item}
                open={Boolean(selectedItem)}
                onOpenChange={(open) => {
                  if (!open) handleCloseItem();
                }}
              />
            }
            { selectedNotebook &&
              <NotebookSummaryPanel
                className="layout-main-column-scrollable-area"
                editableTitle={editableTitle}
                key={selectedNotebook.id}
                notebookId={selectedNotebook.id}
                refetchAroundId={() => refreshAfterEdit(selectedNotebook.id)}
              />
            }
            {isSelectedNotebookUnavailable && <NotFound />}
            {!selectedNotebook && !isSelectedNotebookUnavailable && <EmptyState icon="notebook" /> }
          </SuwaliErrorBoundary>
        </Layout.Main>
      </Layout>
    </>
  );
};

export default NotebooksMain;
