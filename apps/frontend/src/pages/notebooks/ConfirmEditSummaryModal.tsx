import { FormattedMessage } from 'react-intl';

import Button from '@ui-components/input/Button';
import { Modal } from '@ui-components/layout/Modal';

type ConfirmEditSummaryModalProps = {
  open: boolean;
  onCancel: () => void;
  onConfirm: () => void;
};

const ConfirmEditSummaryModal = ({
  open,
  onCancel,
  onConfirm,
}: ConfirmEditSummaryModalProps) => (
  <Modal
    alert
    title={
      <FormattedMessage
        id="global.confirmUnpublishToEdit"
        defaultMessage="Unpublish and edit summary?"
        description="Confirmation dialog title before unpublishing a notebook summary"
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
          label={
            <FormattedMessage
              id="global.confirmPublishModalyesUnpublish"
              defaultMessage="Yes, unpublish summary"
              description="Confirmation dialog submit button label before publishing a notebook summary"
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
          id="global.confirmEditPublishedModalareYouSureUnpublish"
          defaultMessage="This notebook summary is <strong>published</strong>. You must <strong>unpublish</strong> it in order to edit."
          description="Confirmation dialog message before unpublishing a notebook summary"
          tagName="p"
          values={{
            strong: msg => <strong key="strong">{msg}</strong>,
          }}
        />
        <FormattedMessage
          id="global.confirmPublishModalareYouSureUnpublishDetails"
          defaultMessage="The text in this notebook summary will <strong>no longer be available</strong> to the chatbot to respond to end-users."
          description="Confirmation dialog message details before unpublishing a notebook summary"
          tagName="p"
          values={{
            strong: msg => <strong key="strong">{msg}</strong>,
          }}
        />
        <FormattedMessage
          id="global.publishAfterEditingDetails"
          defaultMessage="Once your edits are complete, you can <strong>publish</strong> this notebook summary again, making it available to the chatbot to respond to end-users."
          description="Details about noting to the user the steps to do after they have edited their summary"
          tagName="p"
          values={{
            strong: msg => <strong key="strong">{msg}</strong>,
          }}
        />
      </>
    }
  />
);

export default ConfirmEditSummaryModal;
