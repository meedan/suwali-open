import { useCallback, useEffect, useMemo, useState } from 'react';
import { FormattedMessage } from 'react-intl';
import { useLocation, useNavigate, useParams } from 'react-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';

import type { Conversation, ConversationFrom } from '@customTypes/conversation';

import { PAGINATION_WINDOW_SIZE } from '@constants/App';

import { getConversationTitle } from "@helpers/conversation";
import { isUnavailableError } from '@helpers/http';
import { getIdFromParamsOrLastPath, getLastPath, removeLastPath, setLastPath } from "@helpers/lastPath";

import { fetchConversation, fetchConversations } from '@services/ConversationsService';

import { useSession } from '@root/SessionContext';
import SuwaliErrorBoundary from '@root/SuwaliErrorBoundary';

import { useBidirectionalInfiniteScroll } from "@hooks/useBidirectionalInfiniteScroll";
import { useFilterAndSort } from '@hooks/useFilterAndSort';
import { useHubPath } from '@hooks/useHubPath';
import { useIsInTabletRange, useResponsiveDrawer } from '@hooks/useLayout';
import usePageTitle from '@hooks/usePageTitle';
import { usePaginatedListScroll } from "@hooks/usePaginatedListScroll";

import EmptyState from '@ui-components/layout/EmptyState';
import { Layout } from '@ui-components/layout/Layout';

import Fallback from '@layouts/error/Fallback';
import NotFound from '@layouts/error/NotFound';

import ConversationsSidebar from './ConversationsSidebar';
import ConversationStack from './ConversationStack';

const VALID_FROM_VALUES: ConversationFrom[] = ['audience', 'me', 'team'];

const pageTitles: Record<ConversationFrom, Parameters<typeof usePageTitle>[0]> = {
  audience: (
    <FormattedMessage
      id="global.audienceConversations"
      defaultMessage="Audience conversations"
      description="Reusable label for conversations with end-users page or list title"
    />
  ),
  team: (
    <FormattedMessage
      id="global.teamConversations"
      defaultMessage="Team conversations"
      description="Reusable label for team conversations page or list title"
    />
  ),
  me: (
    <FormattedMessage
      id="global.yourConversations"
      defaultMessage="Your conversations"
      description="Reusable label for your conversations page or list title"
    />
  ),
};

const ConversationsMain = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const params = useParams();
  const hubId = useSession().currentHubId();
  const hubPath = useHubPath();
  const queryClient = useQueryClient();
  const from: ConversationFrom = VALID_FROM_VALUES.includes(params.from as ConversationFrom)
    ? (params.from as ConversationFrom)
    : 'audience';

  // Helper to navigate to a conversation while preserving current filters
  const navigateToConversation = useCallback((conversationId: number, options?: { replace?: boolean }) => {
    const searchParams = new URLSearchParams(location.search);
    searchParams.delete('messageId'); // Clear messageId when navigating to a different conversation

    const query = searchParams.toString();
    const url = query
      ? `/conversations/${from}/${conversationId}?${query}`
      : `/conversations/${from}/${conversationId}`;
    navigate(hubPath(url), options);
  }, [from, location.search, navigate, hubPath]);

  const [mobileTab, setMobileTab] = useState('mobile-main');
  const isInTabletRange = useIsInTabletRange('501px', '850px');
  const [isLeftNavVisible, setIsLeftNavVisible] = useResponsiveDrawer('850px');
  const [settledFrom, setSettledFrom] = useState<string | null>(null);
  const selectedAssetSettled = settledFrom === from;
  // initialAroundId is re-resolved when "from changes" so it loads the correct conversation and scrolls it into view
  const initialAroundId = useMemo(() => {
    return getIdFromParamsOrLastPath(
      params.conversationId,
      `conversationsLastPath:${from}`,
      hubId,
      /\/conversations\/[^/]+\/(\d+)/
    );
  // eslint-disable-next-line react-hooks/exhaustive-deps -- We want to re-resolve initialAroundId when the "from" changes, so we intentionally omit hubId and params.conversationId from the dependency array
  }, [from]);

  const {
    currentQuery: conversationsFilter,
  } = useFilterAndSort({});

  usePageTitle(pageTitles[from]);

  const selectedConversationId = params.conversationId ? parseInt(params.conversationId, 10) : null;
  const filterKey = JSON.stringify({ ...conversationsFilter, from });

  const conversationsQuery = useBidirectionalInfiniteScroll<Conversation>({
    queryKey: [
      `/hubs/${hubId}/conversations`,
      `filter:${filterKey}`,
    ],
    queryFn: (aroundId, windowSize) => fetchConversations(hubId!, aroundId, windowSize, { ...conversationsFilter, from }),
    initialAroundId,
    currentAroundId: selectedConversationId,
    windowSize: PAGINATION_WINDOW_SIZE,
    enabled: Boolean(hubId),
  });

  if (conversationsQuery.error) throw conversationsQuery.error;

  const conversations = conversationsQuery.items;
  const isPending = conversationsQuery.isPending;
  const refetchAroundId = conversationsQuery.refetchAroundId;
  const { jumpToEdge } = conversationsQuery;

  // After an edit to the open conversation; recentres on it only while it's loaded, so an edit doesn't undo a jump to the top
  const refreshAfterEdit = useCallback(async (conversationId?: number) => {
    if (!conversationId || conversations.some(c => c.id === conversationId)) return refetchAroundId(conversationId);
    queryClient.invalidateQueries({ queryKey: [`/conversations/${conversationId}`] });
    return refetchAroundId();
  }, [conversations, queryClient, refetchAroundId]);

  const listedConversation = useMemo(() => {
    if (!selectedConversationId) return null;
    return conversations.find(c => c.id === selectedConversationId) ?? null;
  }, [conversations, selectedConversationId]);

  const selectedConversationQuery = useQuery({
    queryKey: [`/conversations/${selectedConversationId}`],
    queryFn: () => fetchConversation(selectedConversationId!),
    enabled: Boolean(selectedConversationId),
    initialData: () => listedConversation ?? undefined,
  });

  // The list's copy is refreshed with the list, so this one doesn't go stale once the list moves past it
  useEffect(() => {
    if (listedConversation) queryClient.setQueryData([`/conversations/${listedConversation.id}`], listedConversation);
  }, [listedConversation, queryClient]);

  const fetchedConversation = selectedConversationQuery.data;
  // A conversation from another of the user's hubs is as unavailable as a missing one
  const isFromOtherHub = Boolean(fetchedConversation && fetchedConversation.hub_id !== hubId);
  const isSelectedConversationUnavailable = !listedConversation &&
    (isFromOtherHub || isUnavailableError(selectedConversationQuery.error));
  // A failed refetch keeps the cached copy as data, so it's dropped here rather than rendered
  const selectedConversation = isSelectedConversationUnavailable ? null : listedConversation ?? fetchedConversation ?? null;

  if (selectedConversationQuery.error && !listedConversation && !isUnavailableError(selectedConversationQuery.error)) {
    throw selectedConversationQuery.error;
  }

  // Update conversationsLastPath whenever the URL changes (including filter changes); the nav opens it directly, so a not-found one is forgotten
  useEffect(() => {
    if (!params.conversationId || !selectedAssetSettled) return;
    if (isSelectedConversationUnavailable) {
      removeLastPath('conversationsLastPath', hubId);
      removeLastPath(`conversationsLastPath:${from}`, hubId);
      return;
    }
    const pathWithParams = location.search
      ? `/conversations/${from}/${params.conversationId}${location.search}`
      : `/conversations/${from}/${params.conversationId}`;
    setLastPath('conversationsLastPath', hubId, pathWithParams);
    setLastPath(`conversationsLastPath:${from}`, hubId, pathWithParams);
  }, [params.conversationId, from, location.search, selectedAssetSettled, hubId, isSelectedConversationUnavailable]);

  // Initial setup: resolve which conversation to navigate to on first load or view switch
  useEffect(() => {
    if (isPending || selectedAssetSettled) return;

    const conversationId = params.conversationId ?? '';
    // Skip setting lastPath if has_message date range filter is active — prioritize showing the
    // most recent conversation instead of navigating to a potentially irrelevant lastPath
    const lastPath = !conversationId && !conversationsFilter.has_message
      ? getLastPath(`conversationsLastPath:${from}`, hubId)
      : null;

    if (conversations.length === 0) {
      setSettledFrom(from);
    } else if (conversationId) {
      const pathWithParams = location.search
        ? `/conversations/${from}/${conversationId}${location.search}`
        : `/conversations/${from}/${conversationId}`;
      setLastPath('conversationsLastPath', hubId, pathWithParams);
      setLastPath(`conversationsLastPath:${from}`, hubId, pathWithParams);
      setMobileTab('mobile-main');
      setSettledFrom(from);
    } else if (lastPath) {
      navigate(hubPath(lastPath), { replace: true });
    } else {
      const url = location.search
        ? `/conversations/${from}/${conversations[0].id}${location.search}`
        : `/conversations/${from}/${conversations[0].id}`;
      navigate(hubPath(url), { replace: true });
      setMobileTab('mobile-main');
    }
  }, [params.conversationId, from, conversations, isPending, navigate, selectedAssetSettled, location.search, conversationsFilter.has_message, hubId, hubPath]);

  // Handle scroll behavior for paginated list
  const { topObserverTarget, bottomObserverTarget } = usePaginatedListScroll({
    containerElementId: 'conversations-sidebar-list',
    itemIdPrefix: 'conversation',
    query: conversationsQuery,
  });

  const handleConversationSelect = (conversation: Conversation, postDelete = false) => {
    navigateToConversation(conversation.id, { replace: postDelete });
    if (postDelete) return;
    setMobileTab('mobile-main');
    if (isInTabletRange) {
      setIsLeftNavVisible(false);
    }
  };

  return (
    <Layout
      leftDrawerOpen={isLeftNavVisible}
      onLeftDrawerOpenChange={setIsLeftNavVisible}
      mobileTab={mobileTab}
      onMobileTabChange={setMobileTab}
    >
      <Layout.Left
        name={
          <FormattedMessage
            id="global.list"
            defaultMessage="List"
            description="Menu item for mobile tab navigation that indicates if the user selects this item it will show the list"
          />
        }
      >
        <div className="layout-left-column-content">
          <SuwaliErrorBoundary fallback={<Fallback actions={['tryAgain']} />}>
            <ConversationsSidebar
              from={from}
              isPending={!selectedAssetSettled}
              topObserverTarget={topObserverTarget}
              bottomObserverTarget={bottomObserverTarget}
              activeConversationId={selectedConversation?.id || null}
              conversations={conversations}
              conversationTitleMapper={from === 'me' ? (conversation) => conversation.title : getConversationTitle}
              refetchAroundId={refetchAroundId}
              onJumpToTop={conversationsQuery.hasPrevious ? () => jumpToEdge('first') : undefined}
              onConversationSelect={handleConversationSelect}
            />
          </SuwaliErrorBoundary>
        </div>
      </Layout.Left>
      <Layout.Main
        name={
          <FormattedMessage
            id="global.conversation"
            defaultMessage="Conversation"
            description="Reusable label for Conversation page or title"
          />
        }
      >
        <SuwaliErrorBoundary fallback={<Fallback actions={['contactSupport', 'backHome', 'tryAgain']} />}>
          { isSelectedConversationUnavailable && <NotFound /> }
          { !selectedConversation && !isSelectedConversationUnavailable && <EmptyState icon="conversations" /> }
          { selectedConversation &&
            <ConversationStack
              className="layout-main-column-scrollable-area"
              from={from}
              conversation={selectedConversation}
              refetchAroundId={refreshAfterEdit}
            />
          }
        </SuwaliErrorBoundary>
      </Layout.Main>
    </Layout>
  );
};

export default ConversationsMain;
