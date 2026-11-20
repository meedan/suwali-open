import { useEffect, useState } from 'react';
import { defineMessages } from 'react-intl';
import { useQuery } from '@tanstack/react-query';

import { fetchClusterMessages } from '@services/MessageClustersService';

export const endUserQuestionMessages = defineMessages({
  answeredTitle: {
    id: 'endUserQuestionPreviewModal.answeredTitle',
    defaultMessage: 'Answered end-user question',
    description: 'Title for the preview modal when the question has been answered',
  },
  unansweredTitle: {
    id: 'endUserQuestionPreviewModal.unansweredTitle',
    defaultMessage: 'Unanswered end-user question',
    description: 'Title for the preview modal when the question has not been answered',
  },
});

export const useClusterMessages = (
  clusterId: number | undefined,
  answered: boolean,
  options?: { enabled?: boolean },
) => {
  const [page, setPage] = useState(1);

  useEffect(() => {
    setPage(1);
  }, [clusterId]);

  const { data } = useQuery({
    queryKey: [`/message-clusters/${clusterId}/messages`, answered, page],
    queryFn: () => fetchClusterMessages(clusterId!, answered, page),
    enabled: options?.enabled !== false && Boolean(clusterId),
  });

  return {
    currentMessage: data?.data[0],
    pagination: data?.pagination,
    page,
    setPage,
  };
};
