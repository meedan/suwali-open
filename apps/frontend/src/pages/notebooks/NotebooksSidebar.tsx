import { useState } from 'react';
import { defineMessages, FormattedDate, FormattedMessage, useIntl } from 'react-intl';
import { useNavigate } from 'react-router';
import { useQueryClient } from '@tanstack/react-query';

import type { Notebook } from "@customTypes/notebook";

import { getLastPath, removeLastPath } from "@helpers/lastPath";

import { createNotebook, deleteNotebook } from '@services/NotebooksService';

import { useSession } from '@root/SessionContext';

import { useHubPath } from '@hooks/useHubPath';
import { useToast } from '@hooks/useToast';

import Button from "@ui-components/input/Button";
import EmptyState from "@ui-components/layout/EmptyState";
import Icon from "@ui-components/layout/Icon";
import ListHeader from "@ui-components/layout/ListHeader";
import ListItem from "@ui-components/layout/ListItem";
import { ListSkeleton } from "@ui-components/layout/LoadingIndicator";
import StatusPrefix from "@ui-components/layout/StatusPrefix";
import Tooltip from "@ui-components/layout/Tooltip";

import { Can } from '@components/Can';
import JumpToTopOfListButton from '@components/JumpToTopOfListButton';

import ConfirmDeleteNotebookModal from './ConfirmDeleteNotebookModal';

const messages = defineMessages({
  backArrow: {
    id: 'notebooksSidebar.backArrow',
    defaultMessage: 'Back',
    description: 'Accessibility label for back button',
  },
  newNotebook: {
    id: 'global.newNotebook',
    defaultMessage: 'New notebook',
    description: 'Button label for adding a new notebook',
  },
  deleteNotebook: {
    id: 'notebooksSidebar.deleteNotebook',
    defaultMessage: 'Remove notebook',
    description: 'Tooltip for button to delete a notebook',
  },
  untitledNotebook: {
    id: 'notebooksSidebar.untitledNotebook',
    defaultMessage: 'Untitled notebook',
    description: 'Default notebook title',
  },
  createNotebookError: {
    id: 'notebooksSidebar.createNotebookError',
    defaultMessage: 'There was an error creating the notebook. Please try again.',
    description: 'Error message when creating a new notebook fails',
  },
  deleteNotebookError: {
    id: 'notebooksSidebar.deleteNotebookError',
    defaultMessage: 'There was an error removing the notebook. Please try again.',
    description: 'Error message when deleting a notebook fails',
  },
  deleteNotebookSuccess: {
    id: 'notebooksSidebar.deleteNotebookSuccess',
    defaultMessage: 'Notebook removed successfully.',
    description: 'Toast message displayed when notebook is deleted',
  },
});

type NotebooksSidebarProps = {
  topObserverTarget?: React.RefObject<HTMLSpanElement | null>;
  bottomObserverTarget?: React.RefObject<HTMLSpanElement | null>;
  isPending?: boolean;
  notebooks: Notebook[];
  totalCount?: number;
  selectedNotebook?: Notebook | null;
  refetchAroundId: (itemId?: number) => Promise<void>;
  onNavigateBack?: () => void;
  onNotebookSelect: (notebook: Notebook, postDelete?: boolean) => void;
  // Set only while the notebooks above the loaded window aren't loaded, such as after opening a permalink
  onJumpToTop?: () => void;
};

const NotebooksSidebar = ({
  topObserverTarget,
  bottomObserverTarget,
  isPending = false,
  notebooks,
  totalCount,
  refetchAroundId,
  selectedNotebook,
  onNavigateBack,
  onNotebookSelect,
  onJumpToTop,
}: NotebooksSidebarProps) => {
  const intl = useIntl();
  const { toast } = useToast();
  const session = useSession();
  const hubId = session.currentHubId();
  const hubPath = useHubPath();
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const [notebookToDelete, setNotebookToDelete] = useState<Notebook | null>(null);

  const handleClickNewNotebook = async () => {
    try {
      const newNotebook = await createNotebook({
        notebook: {
          hub_id: hubId,
          name: intl.formatMessage(messages.untitledNotebook),
        },
      });
      await refetchAroundId(newNotebook.id);
      queryClient.invalidateQueries({ queryKey: [`/hubs/${hubId}/notebooks`] });
      onNotebookSelect(newNotebook);
    } catch {
      toast('error', intl.formatMessage(messages.createNotebookError));
    }
  };

  const handleConfirmDeleteNotebook = async () => {
    if (!notebookToDelete) return;

    try {
      await deleteNotebook(notebookToDelete.id);
      if (notebookToDelete?.published) {
        queryClient.invalidateQueries({ queryKey: [`/hubs/${hubId}/notebooks?published=true`]});
      }
      // Forgotten so returning to notebooks doesn't reopen it
      if (getLastPath('notebooksLastPath', hubId) === `/notebooks/${notebookToDelete.id}`) removeLastPath('notebooksLastPath', hubId);
      const isSelected = notebookToDelete.id === selectedNotebook?.id;
      const index = notebooks.findIndex((notebook) => notebook.id === notebookToDelete.id);
      const nextNotebook = isSelected && index >= 0 ? notebooks[index + 1] ?? notebooks[index - 1] : undefined;

      if (nextNotebook) {
        onNotebookSelect(nextNotebook, true);
      } else if (isSelected) {
        navigate(hubPath('/notebooks'), { replace: true });
      }

      setNotebookToDelete(null);
      toast('success', intl.formatMessage(messages.deleteNotebookSuccess));
      refetchAroundId(nextNotebook?.id);
    } catch {
      toast('error', intl.formatMessage(messages.deleteNotebookError));
    }
  };

  const nbIcon = (notebook: Notebook) => {
    if (notebook.published) {
      return (notebook.active ? 'published_status' : 'published_paused');
    }
    else {
      return 'unpublished_dashed';
    }
  }

  const nbStatus= (notebook: Notebook) => {
    if (notebook.published) {
      return (notebook.active ?
        <FormattedMessage
          id="global.published"
          defaultMessage="Published"
          description="Reusable label for notebook summary that is published"
        />
        :
        <StatusPrefix status="paused" icon={false} hyphen={false} />
      );
    }
    else {
      return (
        <FormattedMessage
          id="global.unpublished"
          defaultMessage="Unpublished"
          description="Generic title or label that appears when the notebook is not currently published"
        />
      );
    }
  }

  return (
    <>
      <ConfirmDeleteNotebookModal
        notebook={notebookToDelete}
        open={Boolean(notebookToDelete)}
        onCancel={() => setNotebookToDelete(null)}
        onConfirm={() => handleConfirmDeleteNotebook()}
      />
      <ListHeader
        actionRight={
          onNavigateBack &&
          <Tooltip content={
            <FormattedMessage
              id="global.notebooksSidebarbackToCurrent"
              defaultMessage="Back to current notebook"
              description="Tooltip for button to show user they can go back and view the currently selected notebook"
            />
          }>
            <Button
              aria-label={intl.formatMessage(messages.backArrow)}
              iconLeft={<Icon id="arrow_right" className="icon-flip-rtl" aria-hidden />}
              size="small"
              themeMode
              onClick={onNavigateBack}
            />
          </Tooltip>
        }
        title={
          <FormattedMessage
            id="global.yourNotebooks"
            defaultMessage="Your notebooks"
            description="List header for the notebooks sidebar"
          />
        }
        count={isPending ? undefined : totalCount ?? notebooks.length}
      />
      <div id="notebooks-sidebar-list" className="layout-left-column-scrollable-area">
        {!isPending && onJumpToTop && <JumpToTopOfListButton onClick={onJumpToTop} />}
        {isPending && <ListSkeleton count={10} skipHeader />}
        {!isPending && <span ref={topObserverTarget} className="scroll-observer" />}
        {!isPending && notebooks.map((notebook) => (
          <ListItem
            id={`notebook-${notebook.id}`}
            key={notebook.id}
            type={nbStatus(notebook)}
            icon={<Icon id={nbIcon(notebook)} aria-hidden />}
            isActive={selectedNotebook?.id === notebook.id}
            isPublished={notebook.published && notebook.active}
            isPaused={notebook.published && !notebook.active}
            hoverAction={
              <Tooltip content={intl.formatMessage(messages.deleteNotebook)}>
                <Button
                  aria-label={intl.formatMessage(messages.deleteNotebook)}
                  iconLeft={<Icon id="trash" aria-hidden />}
                  size="small"
                  themeMode
                  onClick={(e: React.MouseEvent<HTMLButtonElement>) => {
                    e.stopPropagation();
                    setNotebookToDelete(notebook);
                  }}
                />
              </Tooltip>
            }
            navigateAction
            title={notebook.name}
            caption={!notebook.summary_updated_at ? '—' :
              <FormattedDate
                key="date"
                weekday="short"
                day="numeric"
                hour="numeric"
                minute="numeric"
                second="numeric"
                month="short"
                value={new Date(notebook.summary_updated_at)}
              />
            }
            onClick={() => onNotebookSelect(notebook)}
          />
        ))}
        {!isPending && !notebooks.length &&
          <EmptyState
            icon="notebook_dashed"
            layout="list"
            message={
              <FormattedMessage
                id="notebooksSidebar.emptyMessage"
                defaultMessage="Use notebooks to collect, track, or analyze content from around the system."
                description="Empty state message when there are no notebooks"
              />
            }
            size="small"
          />
        }
        {!isPending && <span ref={bottomObserverTarget} className="scroll-observer" />}
      </div>
      <Can action="CREATE_NOTEBOOK">
        <footer>
          <Button
            iconLeft={<Icon id="plus" aria-hidden />}
            label={intl.formatMessage(messages.newNotebook)}
            orientation="vertical"
            size="small"
            themeMode
            variant="menu"
            onClick={handleClickNewNotebook}
          />
        </footer>
      </Can>
    </>
  );
};

export default NotebooksSidebar;
