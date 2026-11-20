import type { PriorityTier } from './priority-tier';
import type { ItemTopic } from './topic';
import type { User } from './user';

export type Notebook = {
  id: number;
  hub_id: number;
  user_id: number;
  name: string;
  summary: string;
  summary_updated_at: string;
  created_at: string;
  updated_at: string;
  published: boolean;
  published_at: string;
  summary_updated_by: User | null;
  ai_summary: string | null;
  ai_summary_updated_at: string | null;
  ai_summary_update_requested_at: string | null;
  user: User;
  active?: boolean;
  sync_status?: 'pending' | 'error' | 'complete';
  // False for an error a retry can't fix
  retryable?: boolean;
  priority_tier: PriorityTier;
  summarizable?: boolean;
  topics?: ItemTopic[];
};
