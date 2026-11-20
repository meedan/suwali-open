export type ExternalUser = {
  type: "ExternalUser";
  id: number;
  external_id: string;
  first_message_at: string;
  last_message_at: string;
  last_conversation_id: number | null;
  messages_count: number;
  name: string;
  platform: string;
  trusted_user: boolean;
};
