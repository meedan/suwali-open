import { FormattedMessage } from 'react-intl';

import Button from '@ui-components/input/Button';
import { Modal } from '@ui-components/layout/Modal';

type ConfirmSaveSummaryModalProps = {
  open: boolean;
  saving?: boolean;
  onCancel: () => void;
  onConfirm: () => void;
};

const ConfirmSaveSummaryModal = ({ open, saving, onCancel, onConfirm }: ConfirmSaveSummaryModalProps) => (
  <Modal
    alert
    title={
      <FormattedMessage
        id="documentSummary.confirmTitle"
        defaultMessage="Save summary?"
        description="Title of the confirmation dialog shown before saving changes to the summary of a document"
      />
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
          disabled={saving}
          label={
            <FormattedMessage
              id="documentSummary.confirmSave"
              defaultMessage="Yes, save"
              description="Submit button of the confirmation dialog shown before saving changes to the summary of a document"
            />
          }
          size="small"
          onClick={onConfirm}
        />
      </>
    }
    body={
      <>
        <FormattedMessage
          id="documentSummary.confirmQuestion"
          defaultMessage="Are you sure you want to <strong>save</strong> your changes to this summary?"
          description="Question in the confirmation dialog shown before saving changes to the summary of a document"
          tagName="p"
          values={{
            strong: msg => <strong key="strong">{msg}</strong>,
          }}
        />
        <FormattedMessage
          id="documentSummary.confirmDetails"
          defaultMessage="The new summary will replace the current one."
          description="Details in the confirmation dialog shown before saving changes to the summary of a document"
          tagName="p"
        />
      </>
    }
  />
);

export default ConfirmSaveSummaryModal;
