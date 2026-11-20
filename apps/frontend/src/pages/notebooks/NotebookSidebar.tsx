import { useState } from 'react';
import { defineMessages, FormattedDate, FormattedMessage, useIntl } from 'react-intl';
import { useNavigate } from 'react-router';
import { useQueryClient } from "@tanstack/react-query";

import type { Notebook } from "@customTypes/notebook";
import type { NotebookItem } from '@customTypes/notebook-item';

import { getPlatformIcon, getPlatformName, platformIconNeedsInlineSvg } from "@helpers/conversation";
import { getNotebookItemLabel, getNotebookItemTypeIconId, getNotebookItemTypeName } from '@helpers/source';

import { deleteNote, deleteNotebookItem } from '@services/NotebooksService';

import { useHubPath } from '@hooks/useHubPath';
import { useToast } from '@hooks/useToast';

import Button from "@ui-components/input/Button";
import EmptyState from "@ui-components/layout/EmptyState";
import Icon from "@ui-components/layout/Icon";
import ListHeader from "@ui-components/layout/ListHeader";
import ListItem from "@ui-components/layout/ListItem";
import { ListSkeleton } from "@ui-components/layout/LoadingIndicator"
import StatusPrefix from "@ui-components/layout/StatusPrefix";
import Tooltip from "@ui-components/layout/Tooltip";

import { Can } from '@components/Can';
import NotebookSummaryModal from '@components/NotebookSummaryModal';

import ConfirmDeleteNotebookItemModal from './ConfirmDeleteNotebookItemModal';
import styles from './NotebookSidebar.module.css';

const messages = defineMessages({
  arrowLeft: {
    id: 'global.arrowLeft',
    defaultMessage: 'Arrow left to go back',
    description: 'Accessibility label to indicate the user can click to go left',
  },
  removeFromNotebook: {
    id: 'notebookSidebar.removeFromNotebook',
    defaultMessage: 'Remove from notebook',
    description: 'Tooltip to to indicate button allows you to remove the item from the current notebook',
  },
  successRemoveItem: {
    id: 'global.notebooksMainsuccessRemoveItem',
    defaultMessage: 'Item removed from notebook successfully.',
    description: 'Toast message displayed when item is removed from notebook',
  },
  errorRemoveItem: {
    id: 'global.removeItemFromNotebookFailed',
    defaultMessage: 'Failed to remove item from notebook.',
    description: 'Toast message displayed when item removal from a notebook fails',
  },
});

type NotebookSidebarProps = {
  isPending: boolean;
  error: Error | null;
  notebook: Notebook | null;
  notebookItems: NotebookItem[];
  selectedItem: NotebookItem | null;
  onNavigateBack: () => void;
  onItemSelect: (item: NotebookItem) => void;
};

const NotebookSidebar = ({
  isPending,
  error,
  notebook,
  notebookItems,
  selectedItem,
  onNavigateBack,
  onItemSelect,
}: NotebookSidebarProps) => {
  const intl = useIntl();
  const navigate = useNavigate();
  const hubPath = useHubPath();

  const [notebookItemToDelete, setNotebookItemToDelete] = useState<NotebookItem | null>(null);
  const { toast } = useToast();

  const queryClient = useQueryClient();
  const refetchItems = () => queryClient.invalidateQueries({ queryKey: [`/notebooks/${notebook?.id}/items`] });
  const refetchNotebook = () => queryClient.invalidateQueries({ queryKey: [`/notebooks/${notebook?.id}`] });

  if (isPending) return <ListSkeleton count={10} />;
  if (!notebook) return;
  // The error is thrown to be caught by the SuwaliErrorBoundary, which will show a fallback UI and report the error to Sentry.
  if (error) throw error;

  const nbItemIcon = (nbItem: NotebookItem) => {
    switch (nbItem.item_type) {
      case 'Conversation':
        return getPlatformIcon(nbItem.item.platform);
      case 'Document':
      case 'Contribution':
        return nbItem.item.active === false ? 'pause' : getNotebookItemTypeIconId(nbItem.item_type);
      case 'MessageCluster':
        return nbItem.item.last_message_answered_status === true ? getNotebookItemTypeIconId('AnsweredMessageCluster') : getNotebookItemTypeIconId('UnansweredMessageCluster');
      default:
        return  getNotebookItemTypeIconId(nbItem.item_type);
    }
  }

  const nbItemTypeTypeName = (nbItem: NotebookItem) => {
    switch (nbItem.item_type) {
      case 'MessageCluster':
        return nbItem.item.last_message_answered_status === true ? getNotebookItemTypeName('AnsweredMessageCluster') : getNotebookItemTypeName('UnansweredMessageCluster');
      default:
        return  getNotebookItemTypeName(nbItem.item_type);
    }
  }

  const handleConfirmDeleteNotebookItem = async (notebookItem: NotebookItem | null) => {
    if (!notebookItem) return;

    try {
      if (notebookItem.item_type === 'Note') {
        await deleteNote(notebookItem.item.id);
      } else {
        await deleteNotebookItem(notebook.id, notebookItem.id);
      }
      setNotebookItemToDelete(null);
      navigate(hubPath(`/notebooks/${notebook?.id}`));
      toast('success', intl.formatMessage(messages.successRemoveItem));
      refetchItems();
      refetchNotebook();
    } catch {
      toast('error', intl.formatMessage(messages.errorRemoveItem));
    }
  };

  return (
    <>
      <ConfirmDeleteNotebookItemModal
        notebookItem={notebookItemToDelete}
        open={Boolean(notebookItemToDelete)}
        onCancel={() => setNotebookItemToDelete(null)}
        onConfirm={() => handleConfirmDeleteNotebookItem(notebookItemToDelete)}
      />
      <ListHeader
        actionLeft={
          <Tooltip content={
            <FormattedMessage
              id="global.notebookSidebarlistNotebooks"
              defaultMessage="View your notebooks"
              description="Tooltip for button to show user they can list all of their notebooks"
            />
          }>
            <Button
              aria-label={intl.formatMessage(messages.arrowLeft)}
              iconLeft={<Icon id="arrow_left" className="icon-flip-rtl" aria-hidden />}
              size="small"
              themeMode
              onClick={onNavigateBack}
            />
          </Tooltip>
        }
        key={notebook.id}
        title={
          <FormattedMessage
            id="notebookSidebar.title"
            defaultMessage="Notebook sources ({sourceCount})"
            description="Title of the notebook sidebar. {sourceCount} is the number of sources in the notebook"
            values={{ sourceCount: notebookItems.length }}
          />
        }
      />
      <div id="notebook-items-scroll" className="layout-left-column-scrollable-area">
        {!notebookItems.length &&
          <Can action="CREATE_NOTEBOOK_ITEM">
            <EmptyState
              icon="notebook_dashed"
              layout="list"
              message={
                <>
                  <FormattedMessage
                    id="notebookSidebar.emptyMessage"
                    defaultMessage="Questions and sources you add will appear here."
                    description="Empty state message"
                  />
                  <br />
                  <br />
                  <FormattedMessage
                    id="notebookSidebar.emptyMessageContinued"
                    defaultMessage="Find sources while browsing and add to this notebook."
                    description="Empty state message continue for notebooks"
                  />
                </>
              }
              size="small"
            />
          </Can>
        }
        {notebookItems.map((nbItem: NotebookItem, index: number) => (
          <ListItem
            key={nbItem.id}
            icon={<Icon id={nbItemIcon(nbItem)} inlineSvg={nbItem.item_type === 'Conversation' && platformIconNeedsInlineSvg(nbItem.item.platform)} aria-hidden /> }
            isActive={(
              selectedItem?.item_id === nbItem.item_id &&
              selectedItem?.item_type === nbItem.item_type
            )}
            isPaused={(nbItem.item_type === 'Document' || nbItem.item_type === 'Contribution') && nbItem.item.active === false}
            hoverAction={
              <Tooltip content={intl.formatMessage(messages.removeFromNotebook)}>
                <Button
                  aria-label={intl.formatMessage(messages.removeFromNotebook)}
                  iconLeft={<Icon id="trash" aria-hidden />}
                  size="small"
                  themeMode
                  onClick={(e) => {
                    e.stopPropagation();
                    setNotebookItemToDelete(nbItem);
                  }}
                />
              </Tooltip>
            }
            title={getNotebookItemLabel(nbItem)}
            type={
              <>
                {(nbItem.item_type === 'Contribution' || nbItem.item_type === 'Document') && nbItem.item.active === false && <StatusPrefix status="paused" icon={false} />}
                {nbItem.item_type === 'Conversation' && <span>{getPlatformName(nbItem.item.platform)}</span>}
                {nbItemTypeTypeName(nbItem)}
              </>
            }
            caption={
              <>
                {nbItem.item_type === 'MessageCluster' && nbItem.item.current_answered_status_count !== null &&
                  <>
                    <FormattedMessage
                      id="endUserQuestionNotebook.currentCount"
                      defaultMessage="{questionCount, plural, one {# Entry} other {# Entries}}"
                      description="Question count for the message cluster currently displayed status"
                      values={{questionCount: nbItem.item.current_answered_status_count}}
                    />
                    {' / '}
                  </>
                }
                <FormattedDate
                  weekday="short"
                  day="numeric"
                  hour="numeric"
                  minute="numeric"
                  month="short"
                  value={new Date(nbItem.item.updated_at)}
                />
              </>
            }
            onClick={() => onItemSelect(nbItem)}
            tabIndex={index}
          />
        ))}
      </div>
      <footer className={styles.notebookSidebarFooter}>
        <NotebookSummaryModal
          disabled={notebookItems.length === 0}
          notebookId={notebook.id}
        />
      </footer>
    </>
  );
};

export default NotebookSidebar;
