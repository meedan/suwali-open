import { FormattedDate, FormattedMessage } from 'react-intl';

import type { Conversation } from '@customTypes/conversation';
import type { Participant } from "@customTypes/participant";

import { getExternalId } from '@helpers/conversation';

import Icon from '@ui-components/layout/Icon';
import { Modal } from '@ui-components/layout/Modal';
import PlatformCaption from "@ui-components/layout/PlatformCaption";
import TrustedUserStatus from "@ui-components/layout/TrustedUserStatus";

import { Can } from '@components/Can';

import styles from './ConversationParticipantData.module.css';
import UpdateTrustedUserStatus from './UpdateTrustedUserStatus';

type ConversationParticipantDataProps = {
  user: Participant | null;
  conversation: Conversation;
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

const ConversationParticipantData = ({
  user,
  conversation,
  open,
  onOpenChange,
}: ConversationParticipantDataProps) => {
  return (
    <Modal
      title={
        <FormattedMessage
          id="global.endUserDetails"
          defaultMessage="End-user details"
          description="Reusable label to indicate user details are available"
        />
      }
      titleContext={user &&
        <>
          <Icon id="user" aria-hidden />
          <strong>{user.type === "ExternalUser" ? user.name : user.email}</strong>
        </>
      }
      open={open}
      onOpenChange={onOpenChange}
      body={
        <div className={styles.content}>
          <dl>
            {user?.type === 'ExternalUser' && user?.external_id &&
              (() => {
                const { label, value } = getExternalId(conversation.platform, user.external_id);
                return (
                  <div>
                    <dt>{label}</dt>
                    <dd>{value}</dd>
                  </div>
                );
              })()
            }
            {user?.type === 'ExternalUser' &&
              <div>
                <FormattedMessage
                  id="global.trustedEndUser"
                  defaultMessage="Trusted end-user"
                  description="Reusable label to indicate if the user is a trusted end user or not"
                  tagName="dt"
                />
                <dd>
                  <TrustedUserStatus icon label="short" trusted={user?.trusted_user} />
                  <Can action="IS_WRITE_ADMIN">
                    <UpdateTrustedUserStatus user={user} />
                  </Can>
                </dd>
              </div>
            }
            <div>
              <FormattedMessage
                id="global.platform"
                defaultMessage="Platform"
                description="Reusable label for the platform the conversation is from"
                tagName="dt"
              />
              <dd>
                <PlatformCaption id={conversation.platform} />
              </dd>
            </div>
            <div>
              <FormattedMessage
                id="global.conversationContext"
                defaultMessage="Conversation context"
                description="Label for the notes kept about the user in this conversation, such as their location"
                tagName="dt"
              />
              {conversation.context && conversation.context.length > 0 ?
                <dd>{conversation.context.map((note) => note.text).join(", ")}</dd> :
                <FormattedMessage
                  id="global.conversationContextEmpty"
                  defaultMessage="Nothing saved yet"
                  description="Shown when nothing has been saved about the user in this conversation yet"
                  tagName="dd"
                />
              }
            </div>
            {user?.type === 'ExternalUser' &&
              <>
                <div>
                  <FormattedMessage
                    id="global.conversationParticipantDatamostRecent"
                    defaultMessage="Most recent received"
                    description="Label for field shows the date of the most recent message sent"
                    tagName="dt"
                  />
                  <dd>
                    <FormattedDate
                      weekday="short"
                      day="numeric"
                      hour="numeric"
                      minute="numeric"
                      month="short"
                      value={new Date(user?.last_message_at)}
                    />
                  </dd>
                </div>
                <div>
                  <FormattedMessage
                    id="global.conversationParticipantDatafirstMessage"
                    defaultMessage="First message received"
                    description="Label for field that shows the date of the first message sent by the end user in conversation"
                    tagName="dt"
                  />
                  <dd>
                    <FormattedDate
                      weekday="short"
                      day="numeric"
                      hour="numeric"
                      minute="numeric"
                      month="short"
                      value={new Date(user?.first_message_at)}
                    />
                  </dd>
                </div>
                <div>
                  <FormattedMessage
                    id="global.conversationParticipantDatamessageCount"
                    defaultMessage="End-user messages"
                    description="Label for field that shows the total count of messages sent by the end user"
                    tagName="dt"
                  />
                  <dd>
                    {user?.messages_count ? user?.messages_count : '0'}
                  </dd>
                </div>
              </>
            }
          </dl>
        </div>
      }
    />
  );
}

export default ConversationParticipantData;
