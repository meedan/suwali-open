import type { Contribution } from '@customTypes/contribution';
import type { PaginationMetadata } from '@customTypes/pagination-metadata';

import { NetworkLayer } from '@root/NetworkLayer';

import type { DocumentsFilter } from '@hooks/useFilterAndSort';

export const fetchContribution = async (contributionId: number): Promise<Contribution> => {
  const response = await NetworkLayer.get<Contribution>(`/contributions/${contributionId}`);
  return response.data;
};

type ContributionsResponse = {
  data: Contribution[];
  pagination: PaginationMetadata;
};

export const fetchContributions = async (
  hubId: number | string,
  page: number,
  perPage: number,
  filter: DocumentsFilter = {},
): Promise<ContributionsResponse>  => {
  const queryParams = new URLSearchParams({
    page: page.toString(),
    per_page: perPage.toString(),
    ...filter,
  });

  const response = await NetworkLayer.get<ContributionsResponse>(`/hubs/${hubId}/contributions?${queryParams}`);
  return response.data;
};

type RetryContributionSyncResponse = {
  success: boolean;
};

export const retryContributionSync = async (contributionId: number): Promise<RetryContributionSyncResponse>  => {
  const response = await NetworkLayer.post<RetryContributionSyncResponse>(`/contributions/${contributionId}/retry-sync`, {});
  return response.data;
};
