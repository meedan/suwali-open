import clsx from "clsx";
import { type RefObject, useRef, useState } from "react";
import { defineMessages, FormattedMessage, useIntl } from "react-intl";
import { useSearchParams } from "react-router";

import type { Conversation, ConversationFrom } from "@customTypes/conversation";
import type { Message } from "@customTypes/message";
import type { Participant } from "@customTypes/participant";
import type { User } from "@customTypes/user";

import { getConversationTitle } from "@helpers/conversation";
import { getUserFallback } from "@helpers/user";

import { mutateEditConversationTitle, sendMessage } from "@services/ConversationsService";

import { useSession } from "@root/SessionContext";

import MessageSelectProvider from "@contexts/MessageSelectContext";

import { useIsMobileScreen } from '@hooks/useLayout';
import { useToast } from "@hooks/useToast";

import Button from "@ui-components/input/Button";
import ConversationInput from "@ui-components/input/ConversationInput";
import Avatar from "@ui-components/layout/Avatar";
import Icon from "@ui-components/layout/Icon";
import MetaList from "@ui-components/layout/MetaList";
import PlatformCaption from "@ui-components/layout/PlatformCaption";
import TrustedUserStatus from "@ui-components/layout/TrustedUserStatus";

import AddToNotebookModal from "@components/AddToNotebookModal";
import ConversationFlow from "@components/ConversationFlow";
import ConversationParticipantData from "@components/ConversationParticipantData";
import EditableTitle from "@components/EditableTitle";

import ConversationActionsMenu from './ConversationActionsMenu';
import ConversationsMessagesPanel, { type ConversationsMessagesPanelHandle } from "./ConversationsMessagesPanel";
import styles from './ConversationStack.module.css';

const isUser = (participant: Participant): participant is User => participant.type === 'User';

const messages = defineMessages({
  showHidePanel: {
    id: 'global.showHidePanel',
    defaultMessage: 'Show/Hide',
    description: 'Generic label for button to show or hide an area of the app',
  },
  editConversationTitleError: {
    id: 'conversationStack.editConversationTitleError',
    defaultMessage: 'Failed to update conversation title. Please try again.',
    description: 'Error message when updating conversation title fails',
  },
  sendMessageError: {
    id: 'conversationStack.sendMessageError',
    defaultMessage: 'Failed to send message. Please try again.',
    description: 'Error message when sending a message fails',
  },
});

const ToggleOpenButton = ({
  iconId,
  open,
  onOpenChange,
}: {
  iconId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) => {
  const intl = useIntl();

  return (
    <Button
      aria-label={intl.formatMessage(messages.showHidePanel)}
      iconLeft={<Icon id={iconId} aria-hidden />}
      iconRight={<Icon id={open ? "chevron_left" : "chevron_right"} aria-hidden className="icon-flip-rtl" />}
      size="small"
      variant="filled"
      themeMode
      onClick={() => onOpenChange(!open)}
    />
  );
};

const ConversationHeader = ({
  open,
  onOpenChange,
  conversation,
  from,
  refetchAroundId,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  conversation: Conversation;
  from: ConversationFrom;
  refetchAroundId?: (itemId?: number) => Promise<void>;
}) => {
  const intl = useIntl();
  const { toast } = useToast();
  const [notebookDialogOpen, setNotebookDialogOpen] = useState(false);
  const [userDialogOpen, setUserDialogOpen] = useState(false);
  const [editedTitle, setEditedTitle] = useState(conversation.title);

  const session = useSession();
  const user = isUser(conversation.participant) ? conversation.participant : null;
  const isInternal = user !== null;

  let conversationTitle = getConversationTitle(conversation);

  if (isInternal && session.user!.id == user!.id) {
    conversationTitle = conversation.title;
  }

  const toggleOpen = (
    <ToggleOpenButton
      iconId="conversations"
      open={open}
      onOpenChange={onOpenChange}
    />
  );

  const actionsMenu = (
    <ConversationActionsMenu
      conversation={conversation}
      onShowUserDetails={() => setUserDialogOpen(true)}
      onAddToNotebook={() => setNotebookDialogOpen(true)}
    />
  );

  return (
    <>
      <header className={clsx({ [styles.borderBottom]: open })}>
        <EditableTitle
          className={clsx(styles.headerTitle, { [styles.hidden]: !open })}
          icon={user &&
            <Avatar
              editor
              name={user?.name}
              picture={user?.profile_picture_url}
              fallback={getUserFallback(user?.name, user?.email)}
            />
          }
          value={conversationTitle}
          canEdit={from === 'me'}
          onChange={setEditedTitle}
          onSave={async () => {
            try {
              await mutateEditConversationTitle(conversation.id, editedTitle);
              refetchAroundId?.(conversation.id);
            } catch {
              toast('error', intl.formatMessage(messages.editConversationTitleError));
            }
          }}
          renderMeta={
            conversation.participant.type === "ExternalUser" &&
            <MetaList>
              <FormattedMessage
                id="global.conversationPanelplatform"
                defaultMessage="<strong>Platform:</strong> {platform}"
                description="Label before the platform where the conversation below occurred, such as whatsapp or telegram"
                tagName={MetaList.Item}
                values={{
                  strong: msg => <strong key="strong">{msg}</strong>,
                  platform: <PlatformCaption key="platform" id={conversation.platform} />,
                }}
              />
              <FormattedMessage
                id="global.conversationPaneltrusted"
                defaultMessage="<strong>Trusted end-user:</strong> {user}"
                description="Label before the text that indicated if the user is a trusted end user or not"
                tagName={MetaList.Item}
                values={{
                  strong: msg => <strong key="strong">{msg}</strong>,
                  user:
                    <TrustedUserStatus
                      key="user"
                      icon
                      label="short"
                      trusted={Boolean(conversation.participant?.trusted_user)}
                    />,
                }}
              />
            </MetaList>
          }
        />
        <div className={clsx(styles.headerButtons, { [styles.headerButtonsCollapsed]: !open })}>
          { open ?
            <>
              {actionsMenu}
              <div className={clsx('no-mobile-access', styles.divider)}>
                {toggleOpen}
              </div>
            </> :
            <>
              {toggleOpen}
              {actionsMenu}
            </>
          }
        </div>
      </header>
      <AddToNotebookModal
        assetId={conversation.id}
        assetTitle={conversationTitle}
        assetType="Conversation"
        open={notebookDialogOpen}
        onOpenChange={setNotebookDialogOpen}
      />
      <ConversationParticipantData
        conversation={conversation}
        user={conversation.participant}
        open={userDialogOpen}
        onOpenChange={setUserDialogOpen}
      />
    </>
  );
};

const ConversationFooter = ({
  className,
  from,
  conversation,
  messagesPanelRef,
}: {
  className: string,
  from: ConversationFrom;
  conversation: Conversation;
  messagesPanelRef: RefObject<ConversationsMessagesPanelHandle | null>;
}) => {
  const [, setSearchParams] = useSearchParams();
  const { toast } = useToast();
  const intl = useIntl();

  const handleSubmit = async (messageBody: string) => {
    try {
      const response = await sendMessage(conversation.id, messageBody);
      messagesPanelRef.current?.appendMessage({ ...response, state: 'user_message' } as Message);
      setSearchParams(params => {
        params.delete('messageId');
        return params;
      });
    } catch {
      toast('error', intl.formatMessage(messages.sendMessageError));
    }
  };

  return (
    <div className={clsx(styles.footerWrapper, className)}>
      { from === 'me' ? (
        <ConversationInput
          canSubmit
          onSubmit={handleSubmit}
        />
      ) : (
        <footer className={styles.readOnlyFooter}>
          { from === 'audience' && (
            <FormattedMessage
              id="conversationStack.readOnlyFooterAudience"
              defaultMessage="This is a read-only conversation with an end-user."
              description="Footer message on read-only conversation"
            />
          )}
          { from === 'team' && (
            <FormattedMessage
              id="conversationStack.readOnlyFooterTeam"
              defaultMessage="This is a read-only conversation from your team."
              description="Footer message on read-only conversation"
            />
          )}
        </footer>
      )}
    </div>
  );
};

const ConversationStack = ({
  className,
  from: fromProp,
  conversation,
  refetchAroundId,
}: {
  className?: string;
  from: ConversationFrom;
  conversation: Conversation;
  refetchAroundId?: (itemId?: number) => Promise<void>;
}) => {
  const session = useSession();
  // Team includes your own conversations, so ownership is decided by the participant, not the tab
  const from: ConversationFrom = fromProp === 'team' && conversation.participant_id === session.user?.id
    ? 'me'
    : fromProp;
  const [chatOpen, setChatOpen] = useState(true);
  const [flowOpen, setFlowOpen] = useState(true);
  const messagesPanelRef = useRef<ConversationsMessagesPanelHandle>(null);

  return (
    <div
      className={clsx(
        [className],
        styles.conversationAndFlowCard,
        {
          [styles.flowOpen]: flowOpen,
        })
      }
    >
      <MessageSelectProvider>
        <div className={clsx(styles.stackWrapper, { [styles.chatOpen]: chatOpen })}>
          <ConversationHeader
            key={conversation.id}
            conversation={conversation}
            open={chatOpen}
            onOpenChange={setChatOpen}
            from={from}
            refetchAroundId={refetchAroundId}
          />
          <div className={styles.conversationMessagesScrollArea}>
            <ConversationsMessagesPanel
              fromMe={from === 'me'}
              className={clsx({ [styles.hidden]: !chatOpen })}
              conversationId={conversation.id}
              ref={messagesPanelRef}
            />
          </div>
          <ConversationFooter
            className={clsx({ [styles.hidden]: !chatOpen })}
            messagesPanelRef={messagesPanelRef}
            conversation={conversation}
            from={from}
          />
        </div>
        {!useIsMobileScreen() &&
          <div className={clsx(styles.flowWrapper, { [styles.flowOpen]: flowOpen })}>
            <div className={styles.flowToggle}>
              <ToggleOpenButton
                iconId="flow"
                open={flowOpen}
                onOpenChange={setFlowOpen}
              />
            </div>
            <ConversationFlow
              className={clsx({ [styles.hidden]: !flowOpen })}
              key={conversation.id}
            />
          </div>
        }
      </MessageSelectProvider>
    </div>
  );
};

export default ConversationStack;
