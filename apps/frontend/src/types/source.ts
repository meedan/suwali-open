export type IngestionError = {
  external_id: string;
  title: string;
  link?: string | null;
  reason: 'unsupported_type' | 'file_too_large' | 'shortcut_target_inaccessible' | 'folder_not_supported' | 'import_failed' | string;
  details?: string | null;
};

export type NonRetryableDocument = {
  id: number;
  title: string;
  external_id: string | null;
  last_sync_error_code: 'NO_TEXT_FOUND' | 'TEXT_TOO_LARGE' | string;
  external_url: string | null;
};

export type Source = {
  id: number;
  config: object;
  documents_count: number;
  name: string;
  updated_at: string;
  source_type: 'website' | 'google_drive_folder' | 'conversation' | 'rss_feed' | 'json_api' | 'uploaded_files' | 'wordpress_api';
  external_url?: string | null;
  active?: boolean;
  last_synced_at?: string | null;
  ingestion_errors?: IngestionError[];
  non_retryable_documents?: NonRetryableDocument[];
};
