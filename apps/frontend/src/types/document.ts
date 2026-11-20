import type { PriorityTier } from './priority-tier';
import type { ItemTopic } from './topic';

export type Document = {
  id: number;
  content: string;
  document_size: string;
  document_type: 'pdf' | 'doc' | 'blog_post' | 'docx' | 'txt' | 'rss_entry' | 'json' | 'md';
  external_url: string;
  file_url: string | null;
  title: string;
  summary: string | null;
  ai_summary: string | null;
  updated_at: string;
  published_at: string | null;
  active?: boolean;
  source_id?: number;
  sync_status?: 'pending' | 'error' | 'complete';
  refresh_supported: boolean;
  priority_tier: PriorityTier;
  topics?: ItemTopic[];
};
