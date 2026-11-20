import { lazy, Suspense } from "react";
import { FormattedMessage } from "react-intl";

import type { NotebookPreviewItem } from "@customTypes/data-source-item";
import type { Notebook } from "@customTypes/notebook";
import type { PriorityTier } from "@customTypes/priority-tier";
import type { User } from "@customTypes/user";

import { getUserFallback } from "@helpers/user";

import Avatar from "@ui-components/layout/Avatar";
import { PanelLoading } from "@ui-components/layout/LoadingIndicator";

import styles from './DocumentPreviewModal.module.css';
import PreviewDetails from './PreviewDetails';
import PreviewDetailsDate from './PreviewDetailsDate';
import PreviewModalBase from "./PreviewModalBase";
import PriorityTierField from './PriorityTierField';
import PriorityTierToggle from './PriorityTierToggle';
import StatusField from './StatusField';
import TopicsMetaItem from "./TopicsMetaItem";

const MarkdownEditor = lazy(() => import('@components/MarkdownEditor'));

type NotebookSummaryPreviewModalProps = {
  notebook: NotebookPreviewItem | Notebook | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onRetry?: () => void;
  onTogglePause?: () => void;
  onTogglePriorityTier?: () => void;
  onTopicAdded?: () => void;
  onTopicDeleted?: () => void;
  priorityTier?: PriorityTier;
};

const Person = ({ person }: { person: Pick<User, 'name' | 'email' | 'profile_picture_url'> }) => (
  <div className={styles.person}>
    <Avatar editor picture={person.profile_picture_url} fallback={getUserFallback(person.name, person.email)} />
    <strong>{person.name || person.email}</strong>
  </div>
);

const NotebookSummaryPreviewModal = ({
  notebook,
  open,
  onOpenChange,
  onRetry,
  onTogglePause,
  onTogglePriorityTier,
  onTopicAdded,
  onTopicDeleted,
  priorityTier,
}: NotebookSummaryPreviewModalProps) => {
  if (!notebook) return null;

  const titleNode = priorityTier !== undefined ? (
    <span className={styles.titleWrapper}>
      <PriorityTierToggle disabled={notebook.sync_status === 'pending' || notebook.sync_status === 'error'} priorityTier={priorityTier} onToggle={onTogglePriorityTier} variant="filled" />
      {notebook.name}
    </span>
  ) : notebook.name;

  const details = (
    <PreviewDetails>
      <PreviewDetails.Section>
        {priorityTier !== undefined && (
          <PriorityTierField priorityTier={priorityTier} onToggle={onTogglePriorityTier} syncStatus={notebook.sync_status} />
        )}
        <StatusField
          active={notebook.active !== false}
          syncStatus={notebook.sync_status}
          onToggle={onTogglePause}
          // An error a retry can't fix is not offered one
          onRetry={'retryable' in notebook && notebook.retryable === false ? undefined : onRetry}
        />
      </PreviewDetails.Section>
      <PreviewDetails.Section>
        <TopicsMetaItem
          stacked
          topics={'topics' in notebook ? notebook.topics : undefined}
          onTopicDeleted={onTopicDeleted}
          addTopic={onTopicAdded ? { itemType: 'Notebook', itemId: notebook.id, onAdded: onTopicAdded } : undefined}
        />
      </PreviewDetails.Section>
      <PreviewDetails.Section>
        <PreviewDetails.Field
          label={
            <FormattedMessage
              id="previewDetails.lastEditedBy"
              defaultMessage="Last edited by"
              description="Label for the person who last edited a notebook summary"
            />
          }
        >
          {notebook.summary_updated_by ? <Person person={notebook.summary_updated_by} /> : '—'}
        </PreviewDetails.Field>
        <PreviewDetails.Field
          label={
            <FormattedMessage
              id="previewDetails.published"
              defaultMessage="Published"
              description="Label for when a notebook summary was published"
            />
          }
        >
          <PreviewDetailsDate value={notebook.published_at} />
        </PreviewDetails.Field>
        <PreviewDetails.Field
          label={
            <FormattedMessage
              id="previewDetails.modified"
              defaultMessage="Modified"
              description="Label for when an item was last modified"
            />
          }
        >
          <PreviewDetailsDate value={notebook.updated_at} />
        </PreviewDetails.Field>
      </PreviewDetails.Section>
    </PreviewDetails>
  );

  return (
    <PreviewModalBase
      className={styles.editorModal}
      active={notebook.active}
      syncStatus={notebook.sync_status}
      open={open}
      onOpenChange={onOpenChange}
      title={titleNode}
      details={details}
      detailsPlacement="side"
      content={
        <Suspense fallback={<PanelLoading />}>
          <MarkdownEditor initialValue={notebook?.summary || ''} />
        </Suspense>
      }
    />
  );
};

export default NotebookSummaryPreviewModal;
