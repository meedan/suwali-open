import type { Conversation } from '@customTypes/conversation';

// A WhatsApp conversation with an external user; pass only the fields a test cares about
export const buildConversation = (overrides: Partial<Conversation> = {}): Conversation => ({
  id: 7,
  hub_id: 1,
  participant: {
    type: 'ExternalUser',
    id: 3,
    external_id: '5511999999999',
    first_message_at: '2026-01-01T00:00:00Z',
    last_message_at: '2026-01-02T00:00:00Z',
    last_conversation_id: 7,
    messages_count: 2,
    name: 'Maria',
    platform: 'whatsapp',
    trusted_user: false,
  },
  participant_id: 3,
  platform: 'whatsapp',
  title: 'Maria',
  created_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-01-02T00:00:00Z',
  ...overrides,
});
