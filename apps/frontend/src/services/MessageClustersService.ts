import type { ClusterMessage } from "@customTypes/message-cluster";
import type { PaginationMetadata } from "@customTypes/pagination-metadata";

import { NetworkLayer } from "@root/NetworkLayer";

type ClusterMessagesResponse = {
  data: ClusterMessage[];
  pagination: PaginationMetadata;
};

export const fetchClusterMessages = async (
  clusterId: number,
  answered: boolean,
  page: number = 1,
): Promise<ClusterMessagesResponse> => {
  const response = await NetworkLayer.get<ClusterMessagesResponse>(
    `/message-clusters/${clusterId}/messages?answered=${answered}&page=${page}&per_page=1`,
  );
  return response.data;
};
