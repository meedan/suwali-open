import { parsePhoneNumber } from 'libphonenumber-js';
import { FormattedMessage } from "react-intl";

import type { Conversation } from "@customTypes/conversation";

export const getConversationTitle = (conversation: Conversation): string => {
  // The participant can be missing if it was deleted while its conversation was kept
  if (!conversation.participant) {
    return conversation.title;
  }
  if (conversation.participant.type === 'ExternalUser') {
    return conversation.participant.name;
  }
  return `${conversation.participant.name || conversation.participant.email} - ${conversation.title}`;
};

export const getPlatformIcon = (source: string): string => {
  switch (source) {
    case 'internal':
      return 'bot';
    case 'telegram':
      return 'telegram';
    case 'whatsapp':
      return 'whatsapp';
    case 'sms':
      return 'sms';
    case 'signal':
      return 'signal';
    default:
      return 'bot';
  }
}

// The telegram icon is a gradient, which only renders correctly when the SVG is inlined rather than referenced with <use>
export const platformIconNeedsInlineSvg = (source: string): boolean => source === 'telegram';

// WhatsApp BSUIDs have the format "XX.alphanumeric" (e.g., "US.1349120865530274")
export const isBsuid = (id: string): boolean => /^[A-Z]{2}\./.test(id);

export const getExternalId = (platform: string, externalId: string): { label: React.ReactNode; value: string } => {
  // WhatsApp ids are digits only; SMS ids arrive from Twilio already in E.164 (with a leading "+").
  const isPhonePlatform = (platform === 'whatsapp' && !isBsuid(externalId)) || platform === 'sms';
  if (isPhonePlatform) {
    const e164 = externalId.startsWith('+') ? externalId : `+${externalId}`;
    let formattedPhone = e164;
    try {
      formattedPhone = parsePhoneNumber(e164).formatInternational();
    } catch {
      // fall back to the raw E.164 string if parsing fails
    }
    return {
      label: (
        <FormattedMessage
          id="global.externalUserPhone"
          defaultMessage="Phone"
          description="Label for the phone number of a WhatsApp end user"
        />
      ),
      value: formattedPhone,
    };
  }
  return {
    label: (
      <FormattedMessage
        id="global.externalUserIdentifier"
        defaultMessage="End-user ID"
        description="Reusable label to indicate the identifier of an end user"
      />
    ),
    value: externalId,
  };
};

export const getPlatformName = (platform: string): React.ReactNode | string | null => {
  switch (platform) {
    case 'internal':
      return ({
        internal: (
          <FormattedMessage
            id="global.conversationplatformInternal"
            defaultMessage="Internal"
            description="Label for the Internal Conversation platform type"
          />
        ),
      }[platform] || platform);
    case 'telegram':
      return 'Telegram';
    case 'whatsapp':
      return 'WhatsApp';
    case 'sms':
      return 'SMS';
    case 'signal':
      return 'Signal';
    default:
      return platform;
  }
};
