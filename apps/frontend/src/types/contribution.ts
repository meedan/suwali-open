import type { Message } from "./message";
import type { PriorityTier } from "./priority-tier";
import type { ItemTopic } from "./topic";

export type Contribution = {
  id: number;
  ai_summary: string;
  content: string;
  created_at: string;
  first_contribution_at: string;
  first_time_contributor: boolean;
  hub_id: number;
  message: Message;
  message_id: number;
  updated_at: string;
  active?: boolean;
  sync_status?: 'pending' | 'error' | 'complete';
  priority_tier: PriorityTier;
  topics?: ItemTopic[];
};
