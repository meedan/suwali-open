import { FormattedMessage } from 'react-intl';

import Button from '@ui-components/input/Button';
import Icon from '@ui-components/layout/Icon';
import { Modal } from '@ui-components/layout/Modal';

type ConfirmPublishModalProps = {
  open: boolean;
  title?: string;
  published: boolean;
  onCancel: () => void;
  onConfirm: () => void;
};

const ConfirmPublishModal = ({
  open,
  published,
  title,
  onCancel,
  onConfirm,
}: ConfirmPublishModalProps) => (
  <Modal
    alert
    title={
      published ?
      <FormattedMessage
        id="global.confirmPublishModalunpublishSummary"
        defaultMessage="Unpublish summary?"
        description="Confirmation dialog title before unpublishing a notebook summary"
      /> :
      <FormattedMessage
        id="global.confirmPublishModalpublishSummary"
        defaultMessage="Publish summary?"
        description="Confirmation dialog title before publishing a notebook summary"
      />
    }
    titleContext={title &&
      <>
        <Icon id="notebook" aria-hidden />
        <strong title={title}>{title}</strong>
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
            published ?
            <FormattedMessage
              id="global.confirmPublishModalyesUnpublish"
              defaultMessage="Yes, unpublish summary"
              description="Confirmation dialog submit button label before publishing a notebook summary"
            /> :
            <FormattedMessage
              id="global.confirmPublishModalyesPublish"
              defaultMessage="Yes, publish summary"
              description="Confirmation dialog submit button label before publishing a notebook summary"
            />
          }
          size="small"
          onClick={onConfirm}
        />
      </>
    }
    body={published ?
      <>
        <FormattedMessage
          id="global.confirmPublishModalareYouSureUnpublish"
          defaultMessage="Are you sure you want to <strong>unpublish</strong> this notebook summary?"
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
      </> :
      <>
        <FormattedMessage
          id="global.confirmPublishModalareYouSurePublish"
          defaultMessage="Are you sure you want to <strong>publish</strong> this notebook summary?"
          description="Confirmation dialog message before publishing a notebook summary"
          tagName="p"
          values={{
            strong: msg => <strong key="strong">{msg}</strong>,
          }}
        />
        <FormattedMessage
          id="global.confirmPublishModalareYouSurePublishDetails"
          defaultMessage="The text in this notebook summary <strong>will become available</strong> to the chatbot to respond to end-users."
          description="Confirmation dialog message details before publishing a notebook summary"
          tagName="p"
          values={{
            strong: msg => <strong key="strong">{msg}</strong>,
          }}
        />
      </>
    }
  />
);

export default ConfirmPublishModal;
