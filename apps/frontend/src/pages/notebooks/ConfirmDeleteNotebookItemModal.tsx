import { FormattedMessage } from 'react-intl';

import type { NotebookItem } from '@customTypes/notebook-item';

import { getNotebookItemLabel, getNotebookItemTypeIconId } from '@helpers/source';

import Button from '@ui-components/input/Button';
import Icon from "@ui-components/layout/Icon";
import { Modal } from '@ui-components/layout/Modal';

type ConfirmDeleteNotebookItemModalProps = {
  open: boolean;
  notebookItem: NotebookItem | null;
  onCancel: () => void;
  onConfirm: () => void;
};

const ConfirmDeleteNotebookItemModal = ({
  open,
  notebookItem,
  onCancel,
  onConfirm,
}: ConfirmDeleteNotebookItemModalProps) => (
  <Modal
    alert
    title={(
      <>
        {notebookItem?.item_type === 'Note' &&
          <FormattedMessage
            id="global.confirmDeleteNotebookItemModaltitleNote"
            defaultMessage="Remove note?"
            description="Confirmation dialog title before deleting a note"
          />
        }
        {notebookItem?.item_type !== 'Note' &&
          <FormattedMessage
            id="global.confirmDeleteNotebookItemModaltitle"
            defaultMessage="Remove from notebook?"
            description="Confirmation dialog title before deleting a notebook item"
          />
        }
      </>
    )}
    titleContext={
      notebookItem &&
      <>
        <Icon id={getNotebookItemTypeIconId(notebookItem?.item_type)} aria-hidden />
        <strong title={getNotebookItemLabel(notebookItem)}>{getNotebookItemLabel(notebookItem)}</strong>
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
          label={(
            <>
              {notebookItem?.item_type === 'Note' &&
                <FormattedMessage
                  id="global.confirmDeleteNotebookItemModalconfirmNote"
                  defaultMessage="Remove note"
                  description="Confirmation dialog submit button label before deleting a note"
                />
              }
              {notebookItem?.item_type !== 'Note' &&
                <FormattedMessage
                  id="global.confirmDeleteNotebookItemModalconfirm"
                  defaultMessage="Remove from notebook"
                  description="Confirmation dialog submit button label before deleting a notebook item"
                />
              }
            </>
          )}
          size="small"
          onClick={onConfirm}
        />
      </>
    }
    body={
      <>
        { notebookItem?.item_type === 'Note' &&
          <FormattedMessage
            id="global.confirmDeleteNotebookItemModalwarningMessageNote"
            defaultMessage="This note will be removed permanently."
            description="Confirmation dialog message before deleting a note"
            tagName="p"
          />
        }
        { notebookItem?.item_type !== 'Note' &&
          <FormattedMessage
            id="global.confirmDeleteNotebookItemModalwarningMessage"
            defaultMessage="This item will be removed from the notebook."
            description="Confirmation dialog message before deleting a notebook"
            tagName="p"
          />
        }
        { notebookItem?.item_type === 'Note' &&
          <FormattedMessage
            id="global.cannotBeUndoneAreYouSure"
            defaultMessage="This action <strong>cannot be undone</strong>. Are you sure?"
            description="Reusable confirmation dialog message before deleting something"
            tagName="p"
            values={{
              strong: msg => (<strong key="strong">{msg}</strong>),
            }}
          />
        }
      </>
    }
  />
);

export default ConfirmDeleteNotebookItemModal;
