import { defineMessages, FormattedDate, FormattedMessage, useIntl } from "react-intl";
import { useQuery } from "@tanstack/react-query";

import type { Notebook } from "@customTypes/notebook";

import { fetchNotebookSummary, regenerateSummary } from "@services/NotebooksService";

import { useToast } from "@hooks/useToast";

import Button from "@ui-components/input/Button";
import EmptyState from "@ui-components/layout/EmptyState";
import HintBox from "@ui-components/layout/HintBox";
import Icon from "@ui-components/layout/Icon";
import { Modal } from "@ui-components/layout/Modal";
import Tooltip from "@ui-components/layout/Tooltip";

import MarkdownPreview from "@components/MarkdownPreview";

import CopyToClipboardButton from "./CopyToClipboardButton";
import styles from './NotebookSummaryModal.module.css';

const POLLING_INTERVAL = 3000;

const messages = defineMessages({
  aiSummaryCopied: {
    id: 'notebookSummaryPanel.aiSummaryCopied',
    defaultMessage: 'AI summary copied to clipboard',
    description: 'Toast shown when the AI summary is copied to the clipboard',
  },
  regenerateTooltip: {
    id: 'global.regenerateTooltip',
    defaultMessage: 'Regenerate notebook AI summary',
    description: 'Tooltip for button to regenerate the notebook summary',
  },
  regenerateSuccess: {
    id: 'global.aiSummaryRequestSuccess',
    defaultMessage: 'An AI summary is being generated…',
    description: 'Message for sucessful AI summary regenerate request',
  },
  regenerateError: {
    id: 'global.aiSummaryFailed',
    defaultMessage: 'Failed to regenerate AI summary.',
    description: 'Message for failed AI summary regenerate request',
  },
});

const isPendingAiSummary = (notebook: Notebook | undefined): boolean => {
  if (!notebook?.ai_summary_update_requested_at) return false;

  return !notebook.ai_summary_updated_at ||
    new Date(notebook.ai_summary_update_requested_at) > new Date(notebook.ai_summary_updated_at);
};

const NotebookSummaryModal = ({
  disabled,
  notebookId,
}: {
  disabled: boolean,
  notebookId: number,
}) => {
  const intl = useIntl();
  const { toast } = useToast();


  const notebookQuery = useQuery({
    queryKey: [`/notebooks/${notebookId}`],
    queryFn: async () => fetchNotebookSummary(notebookId),
    enabled: Boolean(notebookId) && !disabled,
    refetchInterval: ((query) => {
      const { data: notebook } = query.state;

      if (isPendingAiSummary(notebook)) {
        return POLLING_INTERVAL;
      }

      return false;
    }),
  });

  const {
    data,
    refetch: refetchNotebook,
  } = notebookQuery;

  const notebook = data ?? ({} as Notebook);

  const loaded = Boolean(data);
  const canBeSummarized = notebook.summarizable !== false;
  const summaryGenerationOngoing = isPendingAiSummary(notebook);
  const showEmptyState = loaded && !summaryGenerationOngoing && !notebook.ai_summary && !canBeSummarized;
  const showStaleSummaryWarning = loaded && !summaryGenerationOngoing && Boolean(notebook.ai_summary) && !canBeSummarized;
  const regenerateDisabled = !loaded || summaryGenerationOngoing || !canBeSummarized;

  return (
    <Modal
      title={
        <FormattedMessage
          id="global.aiSourcesSummary"
          defaultMessage="AI sources summary"
          description="Title for an AI generated summary for a collection of source contents"
        />
      }
      titleContext={notebook.ai_summary_updated_at &&
        <FormattedMessage
          id="global.modifiedStrong"
          defaultMessage="<strong>Modified:</strong> {modified}"
          description="Reusable label and date the item was modified"
          values={{
            strong: msg => <strong key="strong">{msg}</strong>,
            modified:
              <FormattedDate
                key="modified"
                weekday="short"
                day="numeric"
                hour="numeric"
                minute="numeric"
                month="short"
                value={new Date(notebook.ai_summary_updated_at)}
              />,
          }}
        />
      }
      details={
        <div className={styles.buttonsWrapper}>
          <Tooltip content={intl.formatMessage(messages.regenerateTooltip)}>
            <Button
              disabled={regenerateDisabled}
              aria-label={intl.formatMessage(messages.regenerateTooltip)}
              iconLeft={<Icon aria-hidden id="arrow_clockwise" />}
              label={summaryGenerationOngoing ?
                <FormattedMessage
                  id="global.regenerating"
                  defaultMessage="Regenerating…"
                  description="Reusable label pending regenerate action"
                /> :
                <FormattedMessage
                  id="global.regenerate"
                  defaultMessage="Regenerate"
                  description="Reusable label for regenerate buttons"
                />
              }
              size="small"
              themeMode
              onClick={async () => {
                try {
                  await regenerateSummary(notebook.id);
                  refetchNotebook();

                  toast('success', intl.formatMessage(messages.regenerateSuccess));
                } catch {
                  toast('error', intl.formatMessage(messages.regenerateError));
                }
              }}
            />
          </Tooltip>
          <CopyToClipboardButton
            iconLeft={<Icon id="clipboard" aria-hidden />}
            label={
              <FormattedMessage
                id="global.copy"
                defaultMessage="Copy"
                description="Reusable label for copy buttons"
              />
            }
            size="small"
            variant="filled"
            themeMode
            value={notebook.ai_summary ?? undefined}
            successMessage={intl.formatMessage(messages.aiSummaryCopied)}
          />
        </div>
      }
      body={
        <div className={styles.bodyWrapper}>
          {showStaleSummaryWarning &&
            <HintBox
              className={styles.staleSummaryWarning}
              type="warning"
              body={
                <FormattedMessage
                  id="notebookSummaryPanel.summaryStale"
                  defaultMessage="Summary regeneration unavailable: one or more items in this notebook can’t be summarized. This summary may be out of date."
                  description="Shown above an existing AI summary when the notebook can no longer be regenerated because an item has no text to summarize"
                />
              }
            />
          }
          {notebook.ai_summary &&
            <MarkdownPreview key={notebook.ai_summary_updated_at} content={notebook.ai_summary} />}
          {showEmptyState &&
            <EmptyState
              icon="document_dashed"
              message={
                <FormattedMessage
                  id="notebookSummaryPanel.summaryUnavailable"
                  defaultMessage="Summary unavailable. One or more items in this notebook can’t be summarized."
                  description="Shown in the AI summary dialog when at least one item in the notebook has no text that can be summarized"
                />
              }
            />
          }
        </div>
      }
      trigger={
        <Button
          disabled={disabled}
          label={
            <FormattedMessage
              id="global.summarizeSources"
              defaultMessage="Summarize sources"
              description="Label for a button to generate a an AI summary for a collection of source contents"
            />
          }
          iconLeft={<Icon inlineSvg id="lightning_color" aria-hidden />}
          size="small"
          themeMode
        />
      }
      triggerDisabled={disabled}
      size="large"
    />
  );
};

export default NotebookSummaryModal;
