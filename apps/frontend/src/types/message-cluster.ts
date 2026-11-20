import type { Conversation } from "./conversation";

export type MessageCluster = {
  id: number;
  original_text: string;
  question_count: number;
  centroid_message_id: number;
  last_message_body: string;
};

export type PartialMessageCluster = MessageCluster & {
  updated_at: string;
  last_message_answered_status: boolean | null;
  current_answered_status_count: number | null;
}

export type ClusterMessage = {
  id: number;
  body: string;
  reply: { id: number; body: string, created_at: string } | null;
  conversation: Conversation;
  created_at: string;
};
