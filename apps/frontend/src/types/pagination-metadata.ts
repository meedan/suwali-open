export type PaginationMetadata = {
  current_page: number;
  per_page: number;
  total_pages: number;
  total_count: number;
  unfiltered_count?: number;
  next_page: number | null;
  prev_page: number | null;
  first_page: boolean;
  last_page: boolean;
};
