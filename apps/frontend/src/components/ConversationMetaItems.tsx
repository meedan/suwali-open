import { FormattedMessage } from "react-intl";

import type { Conversation } from "@customTypes/conversation";
import type { ExternalUser } from "@customTypes/external-user";

import Icon from '@ui-components/layout/Icon';
import MetaList from "@ui-components/layout/MetaList";
import PlatformCaption from "@ui-components/layout/PlatformCaption";
import TrustedUserStatus from "@ui-components/layout/TrustedUserStatus";

type ConversationMetaItemsProps = {
  // Absent while the conversation loads, and the items that need it are left out until it has
  conversation?: Conversation;
};

// Who the conversation is with and where it happens, as items for a MetaList, so the previews of a
// conversation and of one of its messages say the same thing in the same way
const ConversationMetaItems = ({ conversation }: ConversationMetaItemsProps) => (
  <>
    <MetaList.Item
      avatarLayout
      icon={<Icon id="user" />}
    >
      <strong>{conversation?.participant?.name}</strong>
    </MetaList.Item>
    <FormattedMessage
      id="global.conversationPanelplatform"
      defaultMessage="<strong>Platform:</strong> {platform}"
      description="Label before the platform where the conversation below occurred, such as whatsapp or telegram"
      tagName={MetaList.Item}
      values={{
        strong: (msg: React.ReactNode) => <strong key="strong">{msg}</strong>,
        platform: conversation?.platform
          ? <PlatformCaption key="platform" id={conversation.platform} />
          : null,
      }}
    />
    {conversation?.participant?.type === "ExternalUser" &&
      <FormattedMessage
        id="global.conversationPaneltrusted"
        defaultMessage="<strong>Trusted end-user:</strong> {user}"
        description="Label before the text that indicated if the user is a trusted end user or not"
        tagName={MetaList.Item}
        values={{
          strong: (msg: React.ReactNode) => <strong key="strong">{msg}</strong>,
          user: <TrustedUserStatus
            key="user"
            icon
            label="short"
            trusted={Boolean((conversation.participant as ExternalUser).trusted_user)}
          />,
        }}
      />
    }
  </>
);

export default ConversationMetaItems;
