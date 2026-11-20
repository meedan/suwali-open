import clsx from "clsx";
import { defineMessages, FormattedMessage, useIntl } from "react-intl";

import type { DocumentPreviewItem } from "@customTypes/data-source-item";
import type { Document } from "@customTypes/document";
import type { PriorityTier } from "@customTypes/priority-tier";
import type { Source } from "@customTypes/source";

import { getDocumentEmbedUrl } from "@helpers/document";
import { getSourceTypeIcon } from "@helpers/source";

import Icon from '@ui-components/layout/Icon';
import MetaList from "@ui-components/layout/MetaList";
import ParsedText from "@ui-components/layout/ParsedText";

import MarkdownPreview from '@components/MarkdownPreview';

import styles from './DocumentPreviewModal.module.css';
import DocumentSummary from './DocumentSummary';
import PreviewDetails from './PreviewDetails';
import PreviewDetailsDate from './PreviewDetailsDate';
import PreviewModalBase from "./PreviewModalBase";
import PriorityTierField from './PriorityTierField';
import PriorityTierToggle from './PriorityTierToggle';
import StatusField from './StatusField';
import TopicsMetaItem from "./TopicsMetaItem";

const messages = defineMessages({
  documentPreview: {
    id: 'global.documentPreview',
    defaultMessage: 'Embedded document preview',
    description: 'Reusable label for iframe that embeds a document',
  },
});

type DocumentPreviewModalProps = {
  document: Document | DocumentPreviewItem | null;
  source?: Source | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSaveSummary?: (summary: string) => Promise<void>;
  onTogglePause?: () => void;
  onTogglePriorityTier?: () => void;
  onTopicAdded?: () => void;
  onTopicDeleted?: () => void;
  priorityTier?: PriorityTier;
};

const DocumentPreviewModal = ({
  document,
  source,
  open,
  onOpenChange,
  onSaveSummary,
  onTogglePause,
  onTogglePriorityTier,
  onTopicAdded,
  onTopicDeleted,
  priorityTier,
}: DocumentPreviewModalProps) => {
  const intl = useIntl();
  const showEmbed = (document?.document_type === 'blog_post' || document?.document_type === 'rss_entry') ? 'content' : 'embed';

  if (!document) return null;

  const titleNode = priorityTier !== undefined ? (
    <span className={styles.titleWrapper}>
      <PriorityTierToggle disabled={document.sync_status === 'pending' || document.sync_status === 'error'} priorityTier={priorityTier} onToggle={onTogglePriorityTier} variant="filled" />
      {document.title}
    </span>
  ) : document.title;

  const fileUrl = 'file_url' in document ? document.file_url : null;
  const inlineFileUrl = fileUrl?.replace('disposition=attachment', 'disposition=inline') ?? null;
  const embedUrl = getDocumentEmbedUrl(document.external_url, document.document_type, inlineFileUrl);

  const publishedAt = document.published_at;

  const details = (
    <PreviewDetails>
      <PreviewDetails.Section>
        {priorityTier !== undefined && (
          <PriorityTierField priorityTier={priorityTier} onToggle={onTogglePriorityTier} syncStatus={document.sync_status} />
        )}
        <StatusField active={document.active !== false} syncStatus={document.sync_status} onToggle={onTogglePause} />
      </PreviewDetails.Section>
      <PreviewDetails.Section>
        <TopicsMetaItem
          stacked
          topics={'topics' in document ? document.topics : undefined}
          onTopicDeleted={onTopicDeleted}
          addTopic={onTopicAdded ? { itemType: 'Document', itemId: document.id, onAdded: onTopicAdded } : undefined}
        />
      </PreviewDetails.Section>
      {onSaveSummary && 'summary' in document && (
        <DocumentSummary key={document.id} summary={document.summary || document.ai_summary || ''} onSave={onSaveSummary} />
      )}
      <PreviewDetails.Section>
        {source && (
          <PreviewDetails.Field
            label={
              <FormattedMessage
                id="previewDetails.source"
                defaultMessage="Source"
                description="Label for the data source an item comes from"
              />
            }
          >
            <a
              className={styles.sourceLink}
              href={source.external_url || undefined}
              title={source.name}
              target="_blank"
              rel="noopener noreferrer"
            >
              <Icon id={getSourceTypeIcon(source.source_type)} aria-hidden />
              <span>{source.name}</span>
            </a>
          </PreviewDetails.Field>
        )}
        {document.document_size && (
          <PreviewDetails.Field
            label={
              <FormattedMessage
                id="previewDetails.size"
                defaultMessage="Size"
                description="Label for the size of a document"
              />
            }
          >
            {document.document_size}
          </PreviewDetails.Field>
        )}
        {publishedAt && (
          <PreviewDetails.Field
            label={
              <FormattedMessage
                id="previewDetails.documentPublished"
                defaultMessage="Published"
                description="Label for when an item was published at its source"
              />
            }
          >
            <PreviewDetailsDate value={publishedAt} />
          </PreviewDetails.Field>
        )}
        <PreviewDetails.Field
          label={
            <FormattedMessage
              id="previewDetails.modified"
              defaultMessage="Modified"
              description="Label for when an item was last modified"
            />
          }
        >
          <PreviewDetailsDate value={document.updated_at} />
        </PreviewDetails.Field>
        <PreviewDetails.Field
          label={
            <FormattedMessage
              id="previewDetails.note"
              defaultMessage="Note"
              description="Label for a note about an item"
            />
          }
        >
          <FormattedMessage
            id="previewDetails.formattingInconsistent"
            defaultMessage="Formatting may be inconsistent from source."
            description="Warning that the preview of a document may not be formatted as the document is in its source"
          />
        </PreviewDetails.Field>
      </PreviewDetails.Section>
    </PreviewDetails>
  );

  const topDetails = document.external_url && (
    <MetaList.Item icon={<Icon id="link" />}>
      <a target="_blank" href={document.external_url} title={document.external_url} rel="noreferrer">
        {document.external_url}
      </a>
    </MetaList.Item>
  );

  const isEmbedded = showEmbed === 'embed' && !!embedUrl;

  const content = (
    <div
      className={clsx(
        {
          [styles.embed]: isEmbedded,
        }
      )}
    >
      {isEmbedded ? (
        <iframe
          height="100%"
          src={embedUrl}
          title={intl.formatMessage(messages.documentPreview)}
          width="100%"
        />
      ) : document.document_type === 'md' ? (
        document.content && <MarkdownPreview key={document.id} content={document.content} />
      ) : (
        document.content && <p><ParsedText text={document.content} /></p>
      )}
    </div>
  );

  return (
    <PreviewModalBase
      active={document.active}
      syncStatus={document.sync_status}
      open={open}
      onOpenChange={onOpenChange}
      title={titleNode}
      details={details}
      detailsPlacement="side"
      topDetails={topDetails}
      content={content}
    />
  );
};

export default DocumentPreviewModal;
