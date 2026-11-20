import { FormattedMessage } from 'react-intl';

import type { Notebook } from '@customTypes/notebook';

import Button from '@ui-components/input/Button';
import Icon from '@ui-components/layout/Icon';
import { Modal } from '@ui-components/layout/Modal';

type ConfirmDeleteNotebookModalProps = {
  open: boolean;
  notebook: Notebook | null;
  onCancel: () => void;
  onConfirm: () => void;
};

const ConfirmDeleteNotebookModal = ({
  open,
  notebook,
  onCancel,
  onConfirm,
}: ConfirmDeleteNotebookModalProps) => {
  const isPublished = notebook?.published;
  return (
    <Modal
      alert
      title={
        isPublished ? (
          <FormattedMessage
            id="global.confirmDeletePublishedNotebookModaltitle"
            defaultMessage="Unpublish summary and remove notebook?"
            description="Confirmation dialog title before deleting a published notebook"
          />
        ) : (
          <FormattedMessage
            id="global.confirmDeleteNotebookModaltitle"
            defaultMessage="Remove notebook?"
            description="Confirmation dialog title before deleting a notebook"
          />
        )
      }
      titleContext={
        <>
          <Icon id="notebook" aria-hidden />
          <strong title={notebook?.name}>{notebook?.name}</strong>
        </>
      }
      open={open}
      size="small"
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
            size="small"
            themeMode
            variant="text"
            onClick={onCancel}
          />
          <Button
            label={
              isPublished ? (
                <FormattedMessage
                  id="global.confirmDeletePublishedNotebookModalconfirm"
                  defaultMessage="Yes, remove notebook"
                  description="Confirmation dialog submit button label before deleting a published notebook"
                />
              ) : (
                <FormattedMessage
                  id="global.confirmDeleteNotebookModalconfirm"
                  defaultMessage="Remove notebook"
                  description="Confirmation dialog submit button label before deleting a notebook"
                />
              )
            }
            size="small"
            onClick={onConfirm}
          />
        </>
      }
      body={
        isPublished ? (
          <>
            <FormattedMessage
              id="global.confirmDeletePublishedNotebookModalwarningMessage1"
              defaultMessage="This notebook summary is <strong>published</strong> and being used to respond to end-users."
              description="Confirmation dialog message before deleting a published notebook (part 1)"
              tagName="p"
              values={{
                strong: msg => <strong key="strong">{msg}</strong>,
              }}
            />
            <FormattedMessage
              id="global.confirmDeletePublishedNotebookModalwarningMessage2"
              defaultMessage="Removing this notebook will <strong>unpublish</strong> the summary and it will <strong>no longer be available</strong> to the chatbot to respond to end-users."
              description="Confirmation dialog message before deleting a published notebook (part 2)"
              tagName="p"
              values={{
                strong: msg => <strong key="strong">{msg}</strong>,
              }}
            />
          </>
        ) : (
          <>
            <FormattedMessage
              id="global.confirmDeleteNotebookModalwarningMessage"
              defaultMessage="The notebook and all its notes will be permanently removed."
              description="Confirmation dialog message before deleting a notebook"
              tagName="p"
            />
            <FormattedMessage
              id="global.cannotBeUndoneAreYouSure"
              defaultMessage="This action <strong>cannot be undone</strong>. Are you sure?"
              description="Reusable confirmation dialog message before deleting something"
              tagName="p"
              values={{
                strong: msg => (<strong key="strong">{msg}</strong>),
              }}
            />
          </>
        )
      }
    />
  );
};

export default ConfirmDeleteNotebookModal;
