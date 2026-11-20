export type PermalinkPaginationMetadata = {
  type: 'permalink';
  total_count: number;
  window_size: number;
  target_record_id: number;
  target_position: number;
  has_previous: boolean;
  has_next: boolean;
  first_record_id: number;
  last_record_id: number;
};
