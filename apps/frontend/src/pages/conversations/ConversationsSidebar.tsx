import { useState } from 'react';
import { defineMessages, FormattedDate, FormattedMessage, useIntl } from 'react-intl';
import { useLocation, useNavigate } from 'react-router';
import { useQueryClient } from '@tanstack/react-query';

import type { Conversation, ConversationFrom } from "@customTypes/conversation";

import { getPlatformIcon, getPlatformName, platformIconNeedsInlineSvg } from "@helpers/conversation";
import { getLastPath, removeLastPath } from "@helpers/lastPath";
import { getUserFallback } from "@helpers/user";

import { createConversation, deleteConversation } from '@services/ConversationsService';

import { useSession } from '@root/SessionContext';

import { useCan } from '@hooks/useCapabilities';
import { useConversationCounts } from '@hooks/useConversationCounts';
import { getCurrentFromParams, type SortKey, useFilterAndSort } from '@hooks/useFilterAndSort';
import { useHubPath } from '@hooks/useHubPath';
import { useSignalEnabled } from '@hooks/useSignalEnabled';
import { useToast } from '@hooks/useToast';

import Button from "@ui-components/input/Button";
import Avatar from "@ui-components/layout/Avatar";
import EmptyState from "@ui-components/layout/EmptyState";
import Icon from "@ui-components/layout/Icon";
import ListHeader from "@ui-components/layout/ListHeader";
import ListItem from "@ui-components/layout/ListItem";
import { ListSkeleton } from "@ui-components/layout/LoadingIndicator";
import Tooltip from "@ui-components/layout/Tooltip";
import TrustedUserStatus from "@ui-components/layout/TrustedUserStatus";

import { Can } from '@components/Can';
import ConfirmDeleteConversationModal from '@components/ConfirmDeleteConversationModal';
import ConversationTypeSelector from '@components/ConversationTypeSelector';
import JumpToTopOfListButton from '@components/JumpToTopOfListButton';
import { SortModal } from '@components/SortModal';

import { getEndUserDefaultLists } from '@pages/data-sources/filterOptions';

import { ConversationsFilterModal } from './ConversationsFilterModal';

const messages = defineMessages({
  createConversationError: {
    id: 'global.createConversationError',
    defaultMessage: 'There was an error creating the conversation. Please try again.',
    description: 'Error message when creating a conversation fails',
  },
  deleteConversation: {
    id: 'global.deleteConversation',
    defaultMessage: 'Remove conversation',
    description: "Reusable label for Delete conversation action"
  },
  deleteConversationError: {
    id: 'global.deleteConversationError',
    defaultMessage: 'There was an error removing the conversation. Please try again.',
    description: 'Error message when deleting a conversation fails',
  },
  deleteConversationSuccess: {
    id: 'global.deleteConversationSuccess',
    defaultMessage: 'Conversation removed successfully',
    description: 'Toast message displayed when conversation is deleted',
  },
  newChatTitle: {
    id: 'global.untitledConversation',
    defaultMessage: 'Untitled conversation',
    description: 'Default conversation title',
  },
});

// Outside audience conversations the platform is always internal, and in your own you are every participant
const sortOptions: Partial<Record<ConversationFrom, SortKey[]>> = {
  me: ['last_message', 'messages_count'],
  team: ['user', 'last_message', 'messages_count'],
};

// The user sort is labelled for end-users, but team conversations are with other team members
const sortLabels: Partial<Record<ConversationFrom, Partial<Record<SortKey, React.ReactElement>>>> = {
  team: {
    user: (
      <FormattedMessage
        id="global.sortTeamMember"
        defaultMessage="Team member"
        description="Sort option that orders team conversations by the team member who had them"
      />
    ),
  },
};

// The list header title describes whichever type is currently selected
const SelectedTypeTitle = ({ type }: { type: ConversationFrom }) => {
  switch (type) {
    case 'team':
      return (
        <FormattedMessage
          id="global.teamConversations"
          defaultMessage="Team conversations"
          description="Reusable label for team conversations page or list title"
        />
      );
    case 'me':
      return (
        <FormattedMessage
          id="global.yourConversations"
          defaultMessage="Your conversations"
          description="Reusable label for your conversations page or list title"
        />
      );
    default:
      return (
        <FormattedMessage
          id="global.audienceConversations"
          defaultMessage="Audience conversations"
          description="Reusable label for conversations with end-users page or list title"
        />
      );
  }
};

type ConversationsSidebarProps = {
  activeConversationId: number | null;
  topObserverTarget?: React.RefObject<HTMLSpanElement | null>;
  bottomObserverTarget?: React.RefObject<HTMLSpanElement | null>;
  conversations: Conversation[];
  conversationTitleMapper: (conversation: Conversation) => string;
  from: ConversationFrom;
  isPending?: boolean;
  refetchAroundId?: (itemId?: number) => Promise<void>;
  onConversationSelect?: (conversation: Conversation, postDelete?: boolean) => void;
  // Set only while the conversations above the loaded window aren't loaded, such as after opening a permalink
  onJumpToTop?: () => void;
};

const ConversationsSidebar = ({
  activeConversationId,
  topObserverTarget,
  bottomObserverTarget,
  conversations,
  conversationTitleMapper,
  from,
  isPending = false,
  onConversationSelect,
  onJumpToTop,
  refetchAroundId,
}: ConversationsSidebarProps) => {
  const intl = useIntl();
  const navigate = useNavigate();
  const location = useLocation();
  const hubId = useSession().currentHubId();
  const signalEnabled = useSignalEnabled();
  const hubPath = useHubPath();
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const [conversationToDelete, setConversationToDelete] = useState<Conversation | null>(null);

  const isOwnConversations = from === 'me';
  const isWriteAdmin = useCan('IS_WRITE_ADMIN').allowed;
  const showDeleteAction = isOwnConversations || (from === 'audience' && isWriteAdmin);

  const hubPlatforms = ['whatsapp', 'telegram', 'sms', ...(signalEnabled ? ['signal'] : [])] as Conversation['platform'][];

  const { currentQuery: conversationsFilter, activeFiltersCount } = useFilterAndSort({}, from === 'audience' ? getEndUserDefaultLists(hubPlatforms) : {});
  const isFiltered = activeFiltersCount > 0;

  // Switching types restores that type's last path, filters included, so the types not being viewed
  // are counted with the filters saved in their last path
  const filterFor = (type: ConversationFrom) => {
    if (type === from) return conversationsFilter;

    const lastPathSearch = getLastPath(`conversationsLastPath:${type}`, hubId)?.split('?')[1];
    return getCurrentFromParams(new URLSearchParams(lastPathSearch));
  };

  const conversationCounts = useConversationCounts(hubId, {
    audience: filterFor('audience'),
    me: filterFor('me'),
    team: filterFor('team'),
  });

  const refetchConversationCounts = () =>
    queryClient.invalidateQueries({ queryKey: [`/hubs/${hubId}/conversations`, 'count'] });

  const handleCreateConversation = async () => {
    if (!hubId) return;

    try {
      const newConversation = await createConversation(hubId, intl.formatMessage(messages.newChatTitle));
      await refetchAroundId?.(newConversation.id);
      refetchConversationCounts();
      onConversationSelect?.(newConversation);
    } catch {
      toast('error', intl.formatMessage(messages.createConversationError));
    }
  };

  const handleConfirmDeleteConversation = async () => {
    if (!conversationToDelete) return;

    try {
      await deleteConversation(conversationToDelete.id);
      // Forgotten so the nav and the type switcher don't reopen it
      for (const key of ['conversationsLastPath', `conversationsLastPath:${from}`]) {
        if (getLastPath(key, hubId)?.match(/\/conversations\/[^/]+\/(\d+)/)?.[1] === String(conversationToDelete.id)) removeLastPath(key, hubId);
      }
      const isActive = conversationToDelete.id === activeConversationId;
      const index = conversations.findIndex((conversation) => conversation.id === conversationToDelete.id);
      const nextConversation = isActive && onConversationSelect && index >= 0 ? conversations[index + 1] ?? conversations[index - 1] : undefined;

      if (nextConversation) {
        onConversationSelect?.(nextConversation, true);
      } else if (isActive) {
        navigate(hubPath(`/conversations/${from}`), { replace: true });
      }

      setConversationToDelete(null);
      toast('success', intl.formatMessage(messages.deleteConversationSuccess));
      refetchAroundId?.(nextConversation?.id);
      refetchConversationCounts();
    } catch {
      toast('error', intl.formatMessage(messages.deleteConversationError));
    }
  };

  return (
    <>
      <ConversationTypeSelector />
      <ConfirmDeleteConversationModal
        conversation={conversationToDelete}
        open={Boolean(conversationToDelete)}
        onCancel={() => setConversationToDelete(null)}
        onConfirm={() => handleConfirmDeleteConversation()}
      />
      <ListHeader
        alignment="start"
        actionRight={
          <>
            <ConversationsFilterModal
              key={`conversations-filters-${location.search}`}
              connectedPlatforms={hubPlatforms}
              from={from}
            />
            <SortModal key={`conversations-sort-${location.search}`} labels={sortLabels[from]} options={sortOptions[from]} type="conversation" verboseButton={false} />
          </>
        }
        count={conversationCounts[from]}
        title={<SelectedTypeTitle type={from} />}
      />
      <div id="conversations-sidebar-list" className="layout-left-column-scrollable-area">
        {!isPending && onJumpToTop && <JumpToTopOfListButton onClick={onJumpToTop} />}
        {isPending && <ListSkeleton count={10} skipHeader />}
        {!isPending && <span ref={topObserverTarget} className="scroll-observer" />}
        {!isPending && conversations.map((conversation) => (
          <ListItem
            id={`conversation-${conversation.id}`}
            key={conversation.id}
            icon={
              conversation.participant?.type === 'User' ?
                <Avatar
                  editor
                  iconLayout
                  name={conversation.participant.name}
                  picture={conversation.participant.profile_picture_url}
                  fallback={getUserFallback(conversation.participant.name, conversation.participant.email)}
                />
                :
                <Tooltip content={
                  <FormattedMessage
                    id="global.conversationsSidebarplatformTooltip"
                    defaultMessage="{platform} conversation"
                    description="Tooltip content that indicates which messaging platform the conversation happened on"
                    values={{
                      platform: getPlatformName(conversation.platform),
                    }}
                  />
                }>
                  <Icon id={getPlatformIcon(conversation.platform)} inlineSvg={platformIconNeedsInlineSvg(conversation.platform)} aria-hidden />
                </Tooltip>
            }
            isActive={activeConversationId === conversation.id}
            title={conversationTitleMapper(conversation)}
            type={ conversation.participant?.type === "ExternalUser" && Boolean(conversation.participant.trusted_user) &&
              <TrustedUserStatus icon iconFilled label="long" trusted  />
            }
            caption={
              <FormattedDate
                weekday="short"
                day="numeric"
                hour="numeric"
                minute="numeric"
                month="short"
                value={new Date(conversation.updated_at)}
              />
            }
            navigateAction={isOwnConversations}
            hoverAction={ showDeleteAction &&
              <Tooltip content={
                <FormattedMessage
                  id="global.deleteConversation"
                  defaultMessage="Remove conversation"
                  description="Reusable label for Delete conversation action"
                />
              }>
                <Button
                  aria-label={intl.formatMessage(messages.deleteConversation)}
                  iconLeft={<Icon id="trash" aria-hidden />}
                  size="small"
                  themeMode
                  onClick={(e) => {
                    e.stopPropagation();
                    setConversationToDelete(conversation);
                  }}
                />
              </Tooltip>
            }
            onClick={onConversationSelect ? () => onConversationSelect(conversation) : undefined}
          />
        ))}
        {!isPending && !conversations.length &&
          <EmptyState
            actions={isFiltered && <ConversationsFilterModal key={`conversations-empty-filters-${location.search}`} connectedPlatforms={hubPlatforms} from={from} verboseButton />}
            icon="conversations"
            message={
              <>
                <FormattedMessage
                  id="global.conversationsSidebarEmpty"
                  defaultMessage="No conversations available."
                  description="Empty message sidebar with no conversations"
                />
                {isFiltered &&
                  <>
                    <br />
                    <br />
                    <FormattedMessage
                      id="global.conversationsAdjustFilters"
                      defaultMessage="Try a different set of filters to show conversations."
                      description="Empty message to let users know they can change filters"
                    />
                  </>
                }
              </>
            }
            layout="list"
            size="small"
          />
        }
        {!isPending && <span ref={bottomObserverTarget} className="scroll-observer" />}
      </div>
      { isOwnConversations &&
        <Can action="CREATE_CONVERSATION">
          <footer>
            <Button
              iconLeft={<Icon id="plus" aria-hidden />}
              data-testid="conversations-sidebar__new-conversation-button"
              label={
                <FormattedMessage
                  id="global.conversationsSidebarnewConversation"
                  defaultMessage="New conversation"
                  description="Button label for starting a new conversation with the chatbot"
                />
              }
              orientation="vertical"
              onClick={handleCreateConversation}
              size="small"
              variant="menu"
              themeMode
            />
          </footer>
        </Can>
      }
    </>
  );
};

export default ConversationsSidebar;
