import { useQueries, useQuery, useQueryClient } from "@tanstack/react-query";

import type { PriorityTier } from "@customTypes/priority-tier";

import { fetchContribution } from "@services/ContributionsService";
import { fetchDocument, updateDocumentSummary } from "@services/DocumentsService";
import { fetchNotebookSummary } from "@services/NotebooksService";
import { fetchSource } from "@services/SourcesService";

import { useSession } from "@root/SessionContext";

import NotebookSummaryPreviewModal from "@components/NotebookSummaryPreviewModal";

import ContributionPreviewModal from "./ContributionPreviewModal";
import DocumentPreviewModal from "./DocumentPreviewModal";

type DataSourceItemPreviewModalProps = {
  id?: number,
  type?: 'Document' | 'Contribution' | 'Notebook';
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onRetry?: () => void;
  onTogglePause?: () => void;
  onTogglePriorityTier?: () => void;
};

const DataSourceItemPreviewModal = ({
  id,
  type,
  open,
  onOpenChange,
  onRetry,
  onTogglePause,
  onTogglePriorityTier,
}: DataSourceItemPreviewModalProps) => {

  const [documentQuery, contributionQuery, notebookSummaryQuery] = useQueries({
    queries: [
      {
        queryKey: [`/documents/${id}`],
        queryFn: async () => fetchDocument(id!),
        enabled: open && Boolean(id) && type === 'Document',
      },
      {
        queryKey: [`/contributions/${id}`],
        queryFn: async () => fetchContribution(id!),
        enabled: open && Boolean(id) && type === 'Contribution',
      },
      {
        queryKey: [`/notebooks/${id}`],
        queryFn: async () => fetchNotebookSummary(id),
        enabled: open && Boolean(id) && type === 'Notebook',
      },
    ],
  });

  const document = documentQuery.data;

  const { data: source } = useQuery({
    queryKey: [`/sources/${id}`],
    queryFn: async () => fetchSource(document!.source_id!),
    enabled: Boolean(document?.source_id),
  });

  const contribution = contributionQuery.data;

  const notebook = notebookSummaryQuery.data;

  const queryClient = useQueryClient();
  const session = useSession();

  const queryKeyByType = {
    Document: `/documents/${id}`,
    Contribution: `/contributions/${id}`,
    Notebook: `/notebooks/${id}`,
  };

  const handleTopicsChanged = () => {
    if (!type) return;
    const hubId = session.currentHubId();
    const listKeyByType = {
      Document: `/sources/${document?.source_id}/documents`,
      Contribution: `/hubs/${hubId}/contributions`,
      Notebook: `/hubs/${hubId}/notebooks?published=true`,
    };
    queryClient.invalidateQueries({ queryKey: [queryKeyByType[type]] });
    queryClient.invalidateQueries({ queryKey: [listKeyByType[type]] });
  };

  // Refetched rather than taken from the response, which is rendered before the document is marked pending for re-ingestion
  const handleSaveSummary = async (summary: string) => {
    await updateDocumentSummary(id!, summary);
    queryClient.invalidateQueries({ queryKey: [`/documents/${id}`] });
    queryClient.invalidateQueries({ queryKey: [`/sources/${document?.source_id}/documents`] });
  };

  const makeToggleHandler = <T extends { priority_tier: PriorityTier }>(item: T, queryKey: string) =>
    onTogglePriorityTier
      ? () => {
          onTogglePriorityTier();
          queryClient.setQueryData([queryKey], { ...item, priority_tier: item.priority_tier === 2 ? 1 : 2 });
        }
      : undefined;

  if (document) {
    return (
      <DocumentPreviewModal
        key={document.id}
        document={document}
        source={source}
        open={open}
        onOpenChange={onOpenChange}
        onSaveSummary={handleSaveSummary}
        onTogglePause={onTogglePause}
        onTogglePriorityTier={makeToggleHandler(document, `/documents/${id}`)}
        onTopicAdded={handleTopicsChanged}
        onTopicDeleted={handleTopicsChanged}
        priorityTier={document.priority_tier}
      />
    );
  };

  if (contribution) {
    return (
      <ContributionPreviewModal
        key={contribution.id}
        contribution={contribution}
        open={open}
        onOpenChange={onOpenChange}
        onTogglePause={onTogglePause}
        onTogglePriorityTier={makeToggleHandler(contribution, `/contributions/${id}`)}
        onTopicAdded={handleTopicsChanged}
        onTopicDeleted={handleTopicsChanged}
        priorityTier={contribution.priority_tier}
      />
    );
  }

  if (notebook) {
    return (
      <NotebookSummaryPreviewModal
        key={notebook.id}
        open={open}
        notebook={notebook}
        onOpenChange={onOpenChange}
        onRetry={onRetry}
        onTogglePause={onTogglePause}
        onTogglePriorityTier={makeToggleHandler(notebook, `/notebooks/${id}`)}
        onTopicAdded={handleTopicsChanged}
        onTopicDeleted={handleTopicsChanged}
        priorityTier={notebook.priority_tier}
      />
    );
  }

  return null;
};

export default DataSourceItemPreviewModal;
