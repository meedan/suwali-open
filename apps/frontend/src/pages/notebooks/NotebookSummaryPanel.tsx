import clsx from 'clsx';
import React, { lazy, Suspense, useState } from 'react';
import { defineMessages, FormattedDate, FormattedMessage, useIntl } from 'react-intl';
import { useDebouncedCallback } from 'use-debounce';
import { useQuery, useQueryClient } from '@tanstack/react-query';

import type { Notebook } from '@customTypes/notebook';

import { getUserFallback } from '@helpers/user';

import {
  fetchNotebookSummary,
  publishNotebook,
  unpublishNotebook,
  updateNotebook,
} from '@services/NotebooksService';
import { updateEntityActiveStatus } from '@services/SourcesService';

import { useSession } from '@root/SessionContext';

import { useToast } from '@hooks/useToast';

import Button from '@ui-components/input/Button';
import Avatar from "@ui-components/layout/Avatar";
import Icon from '@ui-components/layout/Icon';
import { PanelLoading } from '@ui-components/layout/LoadingIndicator';
import StatusBanner from "@ui-components/layout/StatusBanner";
import Tooltip from "@ui-components/layout/Tooltip";

import ConfirmPauseModal from '@components/ConfirmPauseModal';
import ConfirmPublishModal from '@components/ConfirmPublishModal';
import type { MarkdownEditorRef } from '@components/MarkdownEditor';
import TopicsMetaItem from "@components/TopicsMetaItem";

import ConfirmEditSummaryModal from './ConfirmEditSummaryModal';
import NotebookEmptyStatePanel from './NotebookEmptyStatePanel';
import styles from './NotebookSummaryPanel.module.css';

const MarkdownEditor = lazy(() => import('@components/MarkdownEditor'));

const messages = defineMessages({
  saved: {
    id: 'notebookSummaryPanel.saved',
    defaultMessage: 'Saved',
    description: 'Confirmation title that appears when the save was successful',
  },
  publishButton: {
    id: 'global.publish',
    defaultMessage: 'Publish',
    description: 'Reusable label for publish buttons',
  },
  publishedButton: {
    id: 'notebookSummaryPanel.publishedButton',
    defaultMessage: 'Published',
    description: 'Button label that states the notebook summary is published',
  },
  published: {
    id: 'notebookSummaryPanel.published',
    defaultMessage: 'Published',
    description: 'Confirmation title that appears when the notebook was published to the data sources',
  },
  unpublished: {
    id: 'global.unpublished',
    defaultMessage: 'Unpublished',
    description: 'Generic title or label that appears when the notebook is not currently published',
  },
  notebookSummaryPaneleditModeTooltip: {
    id: 'global.notebookSummaryPaneleditModeTooltip',
    defaultMessage: 'Edit notebook summary',
    description: 'Tooltip for button turn on editing mode for the notebook summary',
  },
  summarySaved: {
    id: 'global.notebookSummaryPanelsummarySaved',
    defaultMessage: 'Notebook summary successfully saved.',
    description: 'Confirmation message that appears when the save was successful',
  },
  summarySaveError: {
    id: 'notebookSummaryPanel.summarySaveError',
    defaultMessage: 'Failed to save notebook summary.',
    description: 'Error message that appears when the save was unsuccessful',
  },
  publishSuccess: {
    id: 'global.notebookPublishSuccess',
    defaultMessage: 'Notebook summary published successfully.',
    description: 'Confirmation message that appears when the a notebook summary was published to the data sources',
  },
  unpublishSuccess: {
    id: 'global.notebookUnpublishSuccess',
    defaultMessage: 'Notebook summary unpublished successfully.',
    description: 'Message for successful notebook unpublish action',
  },
  publishError: {
    id: 'global.notebookPublishError',
    defaultMessage: 'Error publishing notebook summary.',
    description: 'Confirmation message that appears when there is an error publishing the notebook summary',
  },
  unpublishError: {
    id: 'global.notebookUnpublishError',
    defaultMessage: 'Failed to unpublish notebook summary.',
    description: 'Message for failed notebook unpublish action',
  },
  pauseError: {
    id: 'global.pauseError',
    defaultMessage: 'Failed to pause item.',
    description: 'Toast message when pausing an item fails',
  },
  reactivateError: {
    id: 'global.reactivateError',
    defaultMessage: 'Failed to reactivate item.',
    description: 'Toast message when reactivating an item fails',
  },
  pauseTooltip: {
    id: 'global.pauseTooltip',
    defaultMessage: 'Pause this item so it will no longer be available to the chatbot to respond to end-users.',
    description: 'Tooltip for pause action',
  },
  reactivateTooltip: {
    id: 'global.reactivateTooltip',
    defaultMessage: 'Reactivate this item, making it available to the chatbot to respond to end-users.',
    description: 'Tooltip for reactivate action',
  },
  notebookSummaryPanelPublishedTooltip: {
    id: 'global.notebookSummaryPanelPublishedTooltip',
    defaultMessage: 'This notebook summary is published and being used to respond to end-users.',
    description: 'Confirmation dialog message before unpublishing a notebook summary',
  },
  notebookSummaryPanelPausedPublishedTooltip: {
    id: 'global.notebookSummaryPanelPausedPublishedTooltip',
    defaultMessage: 'This published notebook is paused. Content is unavailable to the chatbot to respond to end-users.',
    description: 'Details describing how content will be handled when an it is paused',
  }
});

type NotebookSummaryPanelProps = {
  className?: string;
  editableTitle?: React.ReactNode;
  notebookId: number;
  refetchAroundId?: () => void;
};

const NotebookSummaryPanel = ({
  className,
  editableTitle,
  notebookId,
  refetchAroundId,
}: NotebookSummaryPanelProps) => {
  const editorRef = React.useRef<MarkdownEditorRef>(null);

  const intl = useIntl();
  const queryClient = useQueryClient();
  const hubId = useSession().currentHubId();
  const { toast } = useToast();

  const [saving, setSaving] = useState<boolean>(false);
  const [showConfirmPublishModal, setShowConfirmPublishModal] = useState<boolean>(false);
  const [showConfirmEditModal, setShowConfirmEditModal] = useState<boolean>(false);
  const [showPauseModal, setShowPauseModal] = useState<boolean>(false);

  const notebookQuery = useQuery({
    queryKey: [`/notebooks/${notebookId}`],
    queryFn: async () => fetchNotebookSummary(notebookId),
    enabled: Boolean(notebookId),
  });

  const {
    data,
    isPending,
    refetch: refetchNotebook,
  } = notebookQuery;

  const notebook = data ?? ({} as Notebook);
  const topics = 'topics' in notebook ? notebook.topics : undefined;

  const saveSummary = async (silentSuccess: boolean = true) => {
    const summaryText = editorRef.current?.getMarkdown();

    if (notebook.published || summaryText === notebook.summary) {
      return;
    }

    setSaving(true);
    try {
      await updateNotebook({
        ...notebook,
        summary: summaryText,
      });
      if (!silentSuccess) {
        toast('success', intl.formatMessage(messages.summarySaved), intl.formatMessage(messages.saved));
      }
      refetchNotebook();
    } catch {
      toast('error', intl.formatMessage(messages.summarySaveError));
    } finally {
      setSaving(false);
    }
  };

  const debouncedSave = useDebouncedCallback(saveSummary, 3000);

  if (isPending) return <PanelLoading />;

  const caption = (date: string | null) => {
    return (
      <FormattedMessage
        id="global.modifiedStrong"
        defaultMessage="<strong>Modified:</strong> {modified}"
        description="Reusable label and date the item was modified"
        values={{
          strong: msg => <strong key="strong">{msg}</strong>,
          modified: !date ? '—' :
            <FormattedDate
              key="date"
              weekday="short"
              day="numeric"
              hour="numeric"
              minute="numeric"
              second="numeric"
              month="short"
              value={new Date(date)}
            />
        }}
      />
    );
  };

  const refetchPublishedNotebooks = () => queryClient.invalidateQueries({
    queryKey: [`/hubs/${hubId}/notebooks?published=true`]
  });

  const onChangePublishedSuccess = (notebook: Notebook) => {
    if (notebook.published) {
      toast('success', intl.formatMessage(messages.publishSuccess), intl.formatMessage(messages.published));
    } else {
      toast('success', intl.formatMessage(messages.unpublishSuccess), intl.formatMessage(messages.unpublished));
    }
    setShowConfirmPublishModal(false);
    refetchPublishedNotebooks();
    refetchNotebook();
    refetchAroundId?.();
  };

  const onUnpublishAndEdit = () => {
    toast('success', intl.formatMessage(messages.unpublishSuccess), intl.formatMessage(messages.unpublished));
    setShowConfirmEditModal(false);
    refetchPublishedNotebooks();
    refetchNotebook();
    refetchAroundId?.();
  };

  const onPublishError = () => {
    toast('error', intl.formatMessage(messages.publishError));
  };

  const onUnpublishError = () => {
    toast('error', intl.formatMessage(messages.unpublishError));
  };

  const getPublishButtonLabel = () => {
    if (saving) {
      return (
        <FormattedMessage
          id="global.saving"
          defaultMessage="Saving…"
          description="Generic label for ongoing save action"
        />
      );
    }

    if (notebook.published) {
      return intl.formatMessage(messages.publishedButton);
    }

    return intl.formatMessage(messages.publishButton);
  };

  return (
    <div className={clsx(styles.wrapper, className, 'layout-main-column-scrollable-area')}>
      <div className={styles.titleArea}>
        {editableTitle}
      </div>
      <div className={styles.cards}>
        <div className={clsx(
          styles.card,
          styles.userCard,
        )}>
          <header>
            <div className={styles.main}>
              <Avatar
                className={styles.headerIcon}
                editor
                picture={notebook.user?.profile_picture_url}
                name={notebook.user?.name}
                fallback={getUserFallback(notebook.user?.name, notebook.user?.email)}
              />
              {caption(notebook.summary_updated_at)}
            </div>
            <div className={styles.actions}>
              { notebook.published && (
                <>
                  <Tooltip content={notebook.active === false ? intl.formatMessage(messages.notebookSummaryPanelPausedPublishedTooltip) : intl.formatMessage(messages.notebookSummaryPanelPublishedTooltip)}>
                    <Button
                      aria-label={notebook.active === false ? intl.formatMessage(messages.notebookSummaryPanelPausedPublishedTooltip) : intl.formatMessage(messages.notebookSummaryPanelPublishedTooltip)}
                      iconLeft={<Icon aria-hidden id={notebook.active === false ? 'published_paused' : 'published_status'} />}
                      label={
                        <FormattedMessage
                          id="global.published"
                          defaultMessage="Published"
                          description="Reusable label for notebook summary that is published"
                        />
                      }
                      size="small"
                      themeMode
                      variant="text"
                      onClick={() => setShowConfirmEditModal(true)}
                    />
                  </Tooltip>
                  <Tooltip content={intl.formatMessage(messages.notebookSummaryPaneleditModeTooltip)}>
                    <Button
                      aria-label={intl.formatMessage(messages.notebookSummaryPaneleditModeTooltip)}
                      iconLeft={<Icon aria-hidden id="pencil" />}
                      label={
                        <FormattedMessage
                          id="global.edit"
                          defaultMessage="Edit"
                          description="Generic label for Edit action"
                        />
                      }
                      size="small"
                      themeMode
                      onClick={() => setShowConfirmEditModal(true)}
                    />
                  </Tooltip>
                  <Tooltip content={intl.formatMessage(notebook.active ? messages.pauseTooltip : messages.reactivateTooltip)}>
                    <Button
                      aria-label={intl.formatMessage(notebook.active ? messages.pauseTooltip : messages.reactivateTooltip)}
                      iconLeft={
                        notebook.active ?
                          <Icon aria-hidden id="pause" /> :
                          <Icon aria-hidden id="play" />
                      }
                      label={
                        notebook.active ?
                          <FormattedMessage
                            id="global.pause"
                            defaultMessage="Pause"
                            description="Reusable label for pause action"
                          /> :
                          <FormattedMessage
                            id="global.reactivate"
                            defaultMessage="Reactivate"
                            description="Reusable label for reactivate action"
                          />
                      }
                      size="small"
                      themeMode
                      onClick={() => setShowPauseModal(true)}
                    />
                  </Tooltip>
                </>
              )}
              {!notebook.published && (
                <Tooltip
                  content={
                    intl.formatMessage({
                      id: 'notebookSummaryPanel.notPublishedTooltip',
                      defaultMessage: 'Publish this notebook summary to data sources.',
                      description: 'Tooltip for button to un publish the notebook summary'
                    })
                  }
                >
                  <Button
                    disabled={!notebook.summary || saving}
                    iconLeft={<Icon aria-hidden id={"publish"} />}
                    label={getPublishButtonLabel()}
                    size="small"
                    themeMode
                    onClick={() => setShowConfirmPublishModal(true)}
                  />
                </Tooltip>
              )}
              <ConfirmEditSummaryModal
                open={showConfirmEditModal}
                onCancel={() => setShowConfirmEditModal(false)}
                onConfirm={async () => {
                  try {
                    await unpublishNotebook(notebook.id);
                    onUnpublishAndEdit();
                  } catch {
                    onUnpublishError();
                  }
                }}
              />
              <ConfirmPauseModal
                entityTitle={notebook.name}
                entityType="Notebook"
                paused={notebook.active === false}
                open={showPauseModal}
                onCancel={() => setShowPauseModal(false)}
                onConfirm={async () => {
                  try {
                    await updateEntityActiveStatus({
                      entityType: 'notebooks',
                      entityId: notebook.id,
                      active: !notebook.active,
                    });
                    refetchNotebook();
                    refetchAroundId?.();
                  } catch {
                    if (notebook.active) {
                      toast('error', intl.formatMessage(messages.pauseError));
                    } else {
                      toast('error', intl.formatMessage(messages.reactivateError));
                    }
                  } finally {
                    setShowPauseModal(false);
                  }
                }}
              />
              <ConfirmPublishModal
                open={showConfirmPublishModal}
                published={notebook.published}
                title={notebook.name}
                onCancel={() => setShowConfirmPublishModal(false)}
                onConfirm={async () => {
                  if (notebook.published) {
                    try {
                      const responseNotebook = await unpublishNotebook(notebook.id);
                      onChangePublishedSuccess(responseNotebook);
                    } catch {
                      onUnpublishError();
                    }
                  } else {
                    try {
                      const responseNotebook = await publishNotebook(notebook.id);
                      onChangePublishedSuccess(responseNotebook);
                    } catch {
                      onPublishError();
                    }
                  }
                }}
              />
            </div>
          </header>
          {notebook.published && (
            <div className={styles.publishedTopics}>
              {topics && topics.length > 0 && (
                <TopicsMetaItem
                  title={
                    <FormattedMessage
                      id="global.publishedTopics"
                      defaultMessage="Published topics"
                      description="Label preceding the list of topics extracted from a data source item when the item is published"
                    />
                  }
                  topics={topics}
                  onTopicDeleted={refetchNotebook}
                />
              )}
            </div>
          )}
          { (notebook.published && notebook.active === false) && <StatusBanner status="paused" /> }
          <div className={
            clsx(
              styles.content,
              styles.editorSummaryWrite,
            )
          }>
            <Suspense fallback={<PanelLoading />}>
              <div className={styles.editorWrapper}>
                <MarkdownEditor
                  ref={editorRef}
                  className={clsx(
                    styles.notebookMarkdownEditor,
                    {[styles.notebookMarkdownEditorPublished]: notebook.published}
                  )}
                  initialValue={notebook.summary || ''}
                  isEditing={!notebook.published}
                  onChange={() => {
                    if (notebook.published) return;
                    setSaving(true);
                    debouncedSave();
                  }}
                />
                {!notebook.summary && !notebook.ai_summary && <NotebookEmptyStatePanel className={styles.emptyHint} />}
              </div>
            </Suspense>
          </div>
        </div>
      </div>
    </div>
  );
};

export default NotebookSummaryPanel;
