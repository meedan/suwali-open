import type { PriorityTier } from './priority-tier';

export type DataSourceItem = {
  id: number;
  title: string;
  type: 'Contribution' | 'Document' | 'Notebook'; // These are cms-api models
  deleted: boolean;
  usage_count: number;
  active?: boolean;
  priority_tier?: PriorityTier;
  sync_status?: 'pending' | 'error' | 'complete';
};

export type ContributionPreviewItem = DataSourceItem & {
  type: 'Contribution';
  content: string;
  updated_at: string;
  active?: boolean;
  sync_status?: 'pending' | 'error' | 'complete';
  message: {
    conversation: {
      platform: string;
      participant: {
        name: string;
        trusted_user: boolean;
        type: string;
      };
    };
  };
};

export type DocumentPreviewItem = DataSourceItem & {
  type: 'Document';
  content: string;
  updated_at: string;
  active?: boolean;
  sync_status?: 'pending' | 'error' | 'complete';
  document_type: 'pdf' | 'doc' | 'blog_post' | 'docx' | 'txt' | 'rss_entry' | 'json' | 'md';
  external_url?: string;
  published_at?: string | null;
  document_size?: number;
};

type NotebookPerson = {
  name: string;
  email: string;
  profile_picture_url: string;
};

export type NotebookPreviewItem = DataSourceItem & {
  type: 'Notebook';
  updated_at: string;
  active?: boolean;
  sync_status?: 'pending' | 'error' | 'complete';
  name: string;
  summary: string;
  published_at: string;
  user: NotebookPerson;
  summary_updated_by?: NotebookPerson | null;
};

export type DataSourcePreviewItem =
  | ContributionPreviewItem
  | DocumentPreviewItem
  | NotebookPreviewItem;
