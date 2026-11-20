import type { Conversation } from "./conversation";
import type { DataSourceItem } from "./data-source-item";

export type MessageStatus = 'sent' | 'delivered' | 'failed';

export type MessageDeliveryError = { code?: string, message?: string };

export type MessageState =
  'user_message' |
  'bot_processing' |
  'bot_message' |
  'user_contribution_started' |
  'bot_contribution_started' |
  'user_contribution_cancelled' |
  'bot_contribution_cancelled' |
  'user_contribution_submitted' |
  'bot_contribution_submitted' |
  'closed_window' |
  'unsupported_message' |
  'knowledge_service_error' |
  'rate_limit_reached' |
  'bot_intermediary_message' |
  'subscription_confirmed' |
  'topic_notification' |
  'unsubscription_confirmed' |
  'topic_notification_sources' |
  'interaction_see_sources' |
  'bot_welcome_message' |
  'non_question_reply';

export type Message = {
  id: number;
  answered: boolean | null,
  body: string;
  conversation: Conversation;
  conversation_id: number;
  direction: 'incoming' | 'outgoing';
  interactive_buttons?: {
    id: string,
    text: string,
    type: string,
  }[];
  created_at: string;
  updated_at: string;
  reply_to_id: number;
  state: MessageState;
  metadata: {
    answerable: boolean | null,
    reasoning: string,
    rewritten_question: string,
    documents_count: number,
    error_type: string,
    step: 'parsing_question' | 'searching_sources' | 'evaluating_results',
    router_intent: 'purchase_subscribe' | 'speak_to_person' | 'question' | 'non_question' | 'location_noted',
    total_duration_ms: number,
    context_updates?: { op: 'add' | 'remove', text: string }[],
    delivery_error?: MessageDeliveryError,
  };
  data_source_items: DataSourceItem[],
  data_source_items_count: number,
  topic_names: string[],
  status?: MessageStatus;
};
