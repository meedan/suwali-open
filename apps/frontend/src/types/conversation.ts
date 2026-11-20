import type { Participant } from './participant';
import type { MessagingPlatform } from './platform';

export type ConversationFrom = 'audience' | 'me' | 'team';

export type ConversationContextNote = {
  id: string;
  text: string;
};

export type Conversation = {
  id: number;
  hub_id: number;
  context?: ConversationContextNote[];
  participant: Participant;
  participant_id: number;
  platform: MessagingPlatform;
  title: string;
  created_at: string;
  updated_at: string;
};

export type BulkConversationExport = {
  id: number;
  status: 'pending' | 'ready' | 'failed' | 'expired';
  created_at: string;
  expires_at: string;
  download_url: string | null;
};
