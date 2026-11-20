import clsx from "clsx";
import { forwardRef, useCallback, useEffect, useImperativeHandle } from "react";
import { FormattedMessage } from "react-intl";
import { useSearchParams } from "react-router";

import type { Message } from "@customTypes/message";

import { PAGINATION_WINDOW_SIZE } from "@constants/App";

import { prefersReducedMotion } from "@helpers/motion";

import { fetchMessagesPaginated } from '@services/ConversationsService';

import { useMessageHighlight } from "@contexts/MessageSelectContext";

import { useBidirectionalInfiniteScroll } from '@hooks/useBidirectionalInfiniteScroll';
import { usePaginatedListScroll } from '@hooks/usePaginatedListScroll';

import DatePill from "@ui-components/layout/DatePill";
import EmptyState from "@ui-components/layout/EmptyState";
import { ConversationSkeleton } from '@ui-components/layout/LoadingIndicator';
import MessageBubble from '@ui-components/layout/MessageBubble';
import ParsedText from "@ui-components/layout/ParsedText";

import MessageTimestamp from "@components/MessageTimestamp";

import ConversationJumpButtons from "./ConversationJumpButtons";
import styles from "./ConversationsMessagesPanel.module.css";
import InteractiveButtons from "./InteractiveButtons";
import MessageDropdownMenu from "./MessageDropdownMenu";
import MessageHighlightToggle from "./MessageHighlightToggle";

// 100 seconds is the maximum in real life (4 intermediary states x 25 seconds WhatsApp typing max duration)
const TYPING_MAX_AGE_MS = 100 * 1000;

// One group per calendar day, newest first, so each date pill can stick only while its own day is in view
const groupByDate = (messages: Message[]) => {
  const groups: { date: string; messages: Message[] }[] = [];

  messages.forEach(msg => {
    const date = new Date(msg.created_at).toDateString();
    const last = groups[groups.length - 1];
    if (last?.date === date) {
      last.messages.push(msg);
    } else {
      groups.push({ date, messages: [msg] });
    }
  });

  return groups;
};

export type ConversationsMessagesPanelHandle = {
  appendMessage: (message: Message) => void;
};

type ConversationsMessagesPanelProps = {
  fromMe?: boolean;
  className?: string;
  conversationId: number | null;
  asSidebar?: boolean;
};

const ConversationsMessagesPanel = forwardRef<ConversationsMessagesPanelHandle, ConversationsMessagesPanelProps>(({
  className,
  fromMe = false,
  conversationId,
  asSidebar,
}, ref) => {
  const [searchParams, setSearchParams] = useSearchParams();
  const parsedMessageId = Number.parseInt(searchParams.get('messageId') ?? '', 10);
  const initialAroundId = Number.isSafeInteger(parsedMessageId) ? parsedMessageId : null;

  // Bidirectional pagination (for conversations without auto-refresh)
  const messagesQuery = useBidirectionalInfiniteScroll<Message>({
    queryKey: [`/conversations/${conversationId}/messages`],
    queryFn: (aroundId, windowSize, anchor) => fetchMessagesPaginated(conversationId!, aroundId, windowSize, 'created_at', 'desc', anchor),
    initialAroundId, // Backend should resolve to latest message when null
    windowSize: PAGINATION_WINDOW_SIZE,
    enabled: Boolean(conversationId),
    // Auto-refresh first page every 3 seconds unless we're focused on a single message
    fetchLatestInterval: initialAroundId ? undefined : 3000,
  });

  const { highlightMessageId } = useMessageHighlight();

  const {
    items: messages,
    isPending,
    isLoadingPrevious,
    isLoadingNext,
  } = messagesQuery;

  const appendMessage = useCallback((message: Message) => {
    // Appending to a window that doesn't reach the latest message would leave a gap, so load the latest instead
    if (messagesQuery.hasPrevious) {
      messagesQuery.jumpToEdge('first');
    } else {
      messagesQuery.addItem(message, 'previous');
    }
  }, [messagesQuery]);

  // Messages are sorted newest first, so the latest are the 'first' edge and the oldest the 'last'
  const jumpToLatest = () => {
    if (initialAroundId) {
      // Dropping the permalink loads the latest window and turns auto-refresh back on
      setSearchParams(params => {
        params.delete('messageId');
        return params;
      });
    } else {
      messagesQuery.jumpToEdge('first');
    }
  };

  useImperativeHandle(ref, () => ({
    appendMessage,
  }), [appendMessage]);

  // Set up intersection observers for pagination
  const { topObserverTarget, bottomObserverTarget } = usePaginatedListScroll({
    query: messagesQuery,
    containerElementId: "conversation-messages",
    itemIdPrefix: "message",
    reverse: true, // div is flex-direction: column-reverse
  });

  // Bring a message highlighted from the flow into view ('nearest' leaves a visible one alone); it is always rendered, as the flow builds its nodes from this same cached list
  useEffect(() => {
    if (highlightMessageId === null) return;

    document.getElementById(`message-${highlightMessageId}`)?.scrollIntoView({ behavior: prefersReducedMotion() ? 'instant' : 'smooth', block: 'nearest' });
  }, [highlightMessageId]);

  if (isPending) return <ConversationSkeleton className="layout-main-column-scrollable-area" messages={20} />;

  // The bot is still working on an answer when the newest message is the user's question,
  // an intermediary status message, or a rate limit reply (sent while a previous question is
  // still being processed).
  const lastMessage = messages[0];
  const isTyping = Boolean(
    !messagesQuery.hasPrevious &&
    lastMessage &&
    (lastMessage.direction === 'incoming' || lastMessage.state === 'bot_intermediary_message' || lastMessage.state === 'rate_limit_reached' || lastMessage.state === 'bot_welcome_message') &&
    Date.now() - new Date(lastMessage.created_at).getTime() < TYPING_MAX_AGE_MS
  );

  return (
    <div className={clsx([className], styles.container)}>
      <div id="conversation-messages" className={clsx(
        styles.wrapper,
        styles.reverse,
        {
          ["layout-left-column-scrollable-area"]: asSidebar,
        }
      )}>
        { messagesQuery.hasPrevious && (
          <span ref={topObserverTarget} className="scroll-observer-large" />
        )}
        { isLoadingPrevious && (
          <span className="scroll-observer-push-out">
            <FormattedMessage
              id="global.loadingMore"
              defaultMessage="Loading more…"
              description="Message shown when loading more items"
            />
          </span>
        )}
        { isTyping && (
          <div>
            <div className={styles.typingBubble}>
              <div></div><div></div><div></div>
            </div>
          </div>
        )}
        {groupByDate(messages).map(group => (
          <div key={group.date} className={styles.dateGroup}>
            {group.messages.map(item => (
              <MessageBubble
                key={item.id}
                id={`message-${item.id}`}
                direction={item.direction === "incoming" ? "incoming" : "outgoing"}
                highlighted={highlightMessageId === item.id}
                pending={item.state === 'bot_intermediary_message' || item.state === 'bot_processing'}
                timestamp={<MessageTimestamp message={item} />}
                rowActions={
                  (item.state !== 'bot_processing' && item.state !== 'bot_intermediary_message')
                    ? (
                      <>
                        <MessageHighlightToggle message={item} />
                        <MessageDropdownMenu message={item} />
                      </>
                    )
                    : undefined
                }
                bubbleActions={
                  item.interactive_buttons?.length
                    ? <InteractiveButtons fromMe={fromMe} message={item} />
                    : undefined
                }
              >
                <ParsedText text={item.body} />
              </MessageBubble>
            ))}
            <DatePill className={styles.stickyDate} value={new Date(group.date)} />
          </div>
        ))}
        { fromMe && !messages.length &&
          <EmptyState
            icon="conversations"
            message={
              <FormattedMessage
                id="global.emptyMessages"
                defaultMessage="Type a message below to begin this conversation."
                description="Empty state message for state where there are no messages in an internal conversation"
              />
            }
            size="small"
          />
        }
        { isLoadingNext && (
          <span className="scroll-observer-push-out">
            <FormattedMessage
              id="global.loadingMore"
              defaultMessage="Loading more…"
              description="Message shown when loading more items"
            />
          </span>
        )}
        { messagesQuery.hasNext && (
          <span ref={bottomObserverTarget} className="scroll-observer-large">
          </span>
        )}
      </div>
      <ConversationJumpButtons
        containerElementId="conversation-messages"
        itemCount={messages.length}
        hasUnloadedOlder={messagesQuery.hasNext}
        hasUnloadedNewer={messagesQuery.hasPrevious}
        onJumpToFirst={() => messagesQuery.jumpToEdge('last')}
        onJumpToLatest={jumpToLatest}
      />
    </div>
  );
});

export default ConversationsMessagesPanel;
