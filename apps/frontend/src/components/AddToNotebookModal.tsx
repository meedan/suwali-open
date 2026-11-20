import { useMemo, useState } from "react";
import { defineMessages, FormattedMessage, useIntl } from "react-intl";
import { useNavigate } from "react-router";
import { useQueries, useQueryClient } from "@tanstack/react-query";

import type { Notebook } from "@customTypes/notebook";
import type { NotebookItemTypes } from "@customTypes/notebook-item";

import { getNotebookItemTypeIconId } from "@helpers/source";

import {
  createNotebook,
  fetchNotebookItems,
  fetchNotebooks,
  mutateAddToNotebook,
  mutateRemoveFromNotebook,
} from "@services/NotebooksService";

import { useSession } from "@root/SessionContext";

import { useHubPath } from '@hooks/useHubPath';
import { useToast } from '@hooks/useToast';

import Button from "@ui-components/input/Button";
import Checkbox from "@ui-components/input/Checkbox";
import Icon from "@ui-components/layout/Icon";
import { Modal } from "@ui-components/layout/Modal";
import Tooltip from '@ui-components/layout/Tooltip';

import { Can } from '@components/Can';

import styles from './AddToNotebookModal.module.css';

const messages = defineMessages({
  successAddTitle: {
    id: 'addToNotebookModal.successAddTitle',
    defaultMessage: 'Added to notebook',
    description: 'Title for toast message displayed when item is added to notebook',
  },
  successRemoveTitle: {
    id: 'global.itemRemovedFromNotebook',
    defaultMessage: 'Removed from notebook',
    description: 'Title for toast message displayed when item is removed from notebook',
  },
  errorTitle: {
    id: 'global.error',
    defaultMessage: 'Error',
    description: 'Generic error title for toast messages',
  },
  errorBody: {
    id: 'global.addToNotebookModalError',
    defaultMessage: 'Failed to update notebook',
    description: 'Toast message displayed when adding or removing an item fails',
  },
  openNotebook: {
    id: 'addToNotebookModal.openNotebook',
    defaultMessage: 'Open notebook',
    description: 'Label for button that allows the user to open the notebook in a new tab',
  },
  viewNotebook: {
    id: 'addToNotebookModal.viewNotebook',
    defaultMessage: 'View notebook',
    description: 'Label for toast action button that navigates to the notebook an item was just added to',
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
});

type AddToNotebookModalProps = {
  assetId: number | undefined;
  assetTitle: string | undefined;
  assetType: NotebookItemTypes;
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

const AddToNotebookModal = ({
  assetId,
  assetTitle,
  assetType,
  open,
  onOpenChange,
}: AddToNotebookModalProps) => {
  const hubId = useSession().currentHubId();
  const hubPath = useHubPath();
  const intl = useIntl();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const [selected, setSelected] = useState<Record<string, boolean>>({});
  const [createNewNotebook, setCreateNewNotebook] = useState<boolean>(false);
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);

  const itemsQueryPath = assetType ? `/${assetType === 'MessageCluster' ? 'message-clusters' : `${assetType.toLowerCase()}s`}/${assetId}/notebook-items` : '';

  const [nbsQuery, itemsQuery] = useQueries({
    queries: [
      { queryKey: [`/hubs/${hubId}/notebooks`], queryFn: () => fetchNotebooks(hubId), enabled: Boolean(hubId) && open },
      { queryKey: [itemsQueryPath], queryFn: () => fetchNotebookItems(itemsQueryPath), enabled: Boolean(assetId) && open },
    ],
  });

  const notebooks = useMemo(() => nbsQuery.data?.data || [], [nbsQuery.data]);
  const items = useMemo(() => itemsQuery.data || [], [itemsQuery.data]);

  const isPending = nbsQuery.isPending || itemsQuery.isPending;

  const canRenderModal = (assetId && assetTitle && assetType && !isPending);

  const previouslyChecked = items.map((i) => i.notebook_id);
  const isSelected = (id: number) => selected[id] !== undefined ? selected[id] : previouslyChecked.includes(id);
  const notebookCount = notebooks.filter((n: Notebook) => isSelected(n.id)).length + (createNewNotebook ? 1 : 0);
  const hasChanges = Object.keys(selected).length > 0 || createNewNotebook;

  const modalTitle = {
    Document: (
      <FormattedMessage
        id="global.addToNotebookModaltitleDocument"
        defaultMessage="Include document in notebooks"
        description="Title for dialog that allows adding assets to notebooks"
      />
    ),
    Conversation: (
      <FormattedMessage
        id="global.addToNotebookModaltitleConversation"
        defaultMessage="Include conversation in notebooks"
        description="Title for dialog that allows adding assets to notebooks"
      />
    ),
    Message: (
      <FormattedMessage
        id="global.addToNotebookModaltitleMessage"
        defaultMessage="Include message in notebooks"
        description="Title for dialog that allows adding assets to notebooks"
      />
    ),
    MessageCluster: (
      <FormattedMessage
        id="global.addToNotebookModaltitleMessageCluster"
        defaultMessage="Include end-user question cluster in notebooks"
        description="Title for dialog that allows adding assets to notebooks"
      />
    ),
    Contribution: (
      <FormattedMessage
        id="global.addToNotebookModaltitleContribution"
        defaultMessage="Include contribution in notebooks"
        description="Title for dialog that allows adding assets to notebooks"
      />
    ),
    Notebook: (
      <FormattedMessage
        id="global.addToNotebookModaltitleNotebook"
        defaultMessage="Include notebook summary in notebooks"
        description="Title for dialog that allows adding assets to notebooks"
      />
    ),
    Note: null,
  }[assetType];

  const handleToggleSelected = (id: number, checked: boolean) => {
    const newSelected = { ...selected };
    newSelected[id] = checked;

    // if not changing anything, simplify hash
    if (checked && previouslyChecked.includes(id) || !checked && !previouslyChecked.includes(id)) {
      delete newSelected[id];
    }

    setSelected(newSelected);
  };

  const handleSubmit = async () => {
    if (!hubId || isSubmitting) return;

    setIsSubmitting(true);

    const localSelected = { ...selected };
    let newNotebook: Notebook | undefined;

    try {
      if (createNewNotebook) {
        newNotebook = await createNotebook({
          notebook: {
            hub_id: hubId,
            name: intl.formatMessage(messages.untitledNotebook),
          },
        });
        queryClient.invalidateQueries({ queryKey: [`/hubs/${hubId}/notebooks`] });
        localSelected[newNotebook.id] = true;
      }
    } catch (err: unknown) {
      console.error("Failed to create notebook:", err);
      toast('error', intl.formatMessage(messages.createNotebookError));
    } finally {
      includeInSelectedNotebooks(localSelected, newNotebook);
      setIsSubmitting(false);
    }
  };

  const includeInSelectedNotebooks = (localSelected: Record<string, boolean>, newNotebook?: Notebook) => {
    if (!assetId) return;

    // The new notebook isn't in `notebooks` yet: that list is from before it was created
    const allNotebooks = newNotebook ? [...notebooks, newNotebook] : notebooks;

    Object.keys(localSelected).forEach(async (notebookId) => {
      const notebook = allNotebooks.find((n: Notebook) => n.id === Number(notebookId));
      const viewNotebookAction = notebook ? {
        label: intl.formatMessage(messages.viewNotebook),
        onClick: () => navigate(hubPath(`/notebooks/${notebookId}`)),
      } : undefined;

      if (localSelected[notebookId]) {
        try {
          await mutateAddToNotebook(notebookId, assetId, assetType);
          // Invalidate the notebook items query for this notebook
          queryClient.invalidateQueries({ queryKey: [`/notebooks/${notebookId}/items`] });
          // Also invalidate the notebooks list to update the updated_at timestamp
          queryClient.invalidateQueries({ queryKey: [`/hubs/${hubId}/notebooks`] });
          // Invalidate this asset's notebook memberships so reopening the modal reflects the change
          queryClient.invalidateQueries({ queryKey: [itemsQueryPath] });
          toast('success', notebook?.name ?? '', intl.formatMessage(messages.successAddTitle), viewNotebookAction);
        } catch (err: unknown) {
          console.error("Failed to add to notebook:", err);
          toast('error', intl.formatMessage(messages.errorBody), intl.formatMessage(messages.errorTitle));
        }
      }

      if (!localSelected[notebookId]) {
        const notebookItem = items.find((i) => i.notebook_id === Number(notebookId));
        if (!notebookItem) return;

        try {
          await mutateRemoveFromNotebook(notebookId, notebookItem.id);
          // Invalidate the notebook items query for this notebook
          queryClient.invalidateQueries({ queryKey: [`/notebooks/${notebookId}/items`] });
          // Also invalidate the notebooks list to update the updated_at timestamp
          queryClient.invalidateQueries({ queryKey: [`/hubs/${hubId}/notebooks`] });
          // Invalidate this asset's notebook memberships so reopening the modal reflects the change
          queryClient.invalidateQueries({ queryKey: [itemsQueryPath] });
          toast('success', notebook?.name ?? '', intl.formatMessage(messages.successRemoveTitle), viewNotebookAction);
        } catch (err: unknown) {
          console.error("Failed to remove from notebook:", err);
          toast('error', intl.formatMessage(messages.errorBody), intl.formatMessage(messages.errorTitle));
        }
      }
    });

    setSelected({});
    setCreateNewNotebook(false);

    if (onOpenChange) {
      onOpenChange(false);
    }
  };

  return (
    <>
      { canRenderModal && (
        <Modal
          actions={
            <>
              <Button
                label={
                  <FormattedMessage
                    id="global.cancel"
                    defaultMessage="Cancel"
                    description="Reusable label for cancel buttons"
                  />
                }
                themeMode
                variant="text"
                onClick={() => onOpenChange(false)}
              />
              <Button
                disabled={isSubmitting}
                themeMode={!hasChanges}
                label={hasChanges ? (
                  <FormattedMessage
                    id="global.addToNotebookModalincludeInXNotebooks"
                    defaultMessage="{count, plural, =0 {Remove from all notebooks} one {Include in (#) notebook} other {Include in (#) notebooks}}"
                    description="Add Document to Notebook dialog submit button label"
                    values={{ count: notebookCount }}
                  />
                ) : (
                  <FormattedMessage
                    id="global.addToNotebookModalnoChanges"
                    defaultMessage="No changes"
                    description="Add Document to Notebook dialog submit button label"
                  />
                )}
                onClick={handleSubmit}
              />
            </>
          }
          body={
            <ul className={styles.optionsWrapper}>
              <Can action="CREATE_NOTEBOOK">
                <li>
                  <Checkbox
                    id="CheckboxNewNotebook"
                    checked={createNewNotebook}
                    label={
                      <span className={styles.createNotebookOption}>
                        <Icon id="plus" aria-hidden />
                        <FormattedMessage
                          id="addToNotebookModal.createNewNotebook"
                          defaultMessage="Create new notebook"
                          description="Option for including an item in a new notebook to be created"
                        />
                      </span>
                    }
                    size="small"
                    value="new"
                    onChange={e => setCreateNewNotebook(e.target.checked)}
                  />
                </li>
              </Can>
              { notebooks
                .filter((n: Notebook) => !(assetType === "Notebook" && assetId === n.id)) // Filter out self when adding a notebook to notebooks
                .map((n: Notebook) => (
                <li key={n.id}>
                  <Checkbox
                    id={`CheckboxNotebook${n.id}`}
                    key={n.id}
                    checked={isSelected(n.id)}
                    label={n.name}
                    value={n.id}
                    onChange={(e) => handleToggleSelected(n.id, e.target.checked)}
                  />
                  <Tooltip content={intl.formatMessage(messages.openNotebook)}>
                    <Button
                      iconRight={<Icon id="arrow_square_out" />}
                      size="small"
                      themeMode
                      onClick={() => window.open(hubPath(`/notebooks/${n.id}`), '_blank', 'noopener,noreferrer')}
                    />
                  </Tooltip>
                </li>
              ))}
            </ul>
          }
          open={open}
          size="medium"
          title={modalTitle}
          titleContext={
            <>
              <Icon id={getNotebookItemTypeIconId(assetType)} aria-hidden />
              <strong title={assetTitle}>{assetTitle}</strong>
            </>
          }
          onOpenChange={onOpenChange}
        />
      )}
    </>
  );
};

export default AddToNotebookModal;
