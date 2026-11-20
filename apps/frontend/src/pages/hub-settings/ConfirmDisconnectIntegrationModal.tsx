import { FormattedMessage } from 'react-intl';

import Button from '@ui-components/input/Button';
import { Modal } from '@ui-components/layout/Modal';

type ConfirmDisconnectIntegrationModalProps = {
  open: boolean;
  onCancel: () => void;
  onConfirm: () => void;
};

const ConfirmDisconnectIntegrationModal = ({
  open,
  onCancel,
  onConfirm,
}: ConfirmDisconnectIntegrationModalProps) => (
  <Modal
    alert
    title={
      <FormattedMessage
        id="global.confirmDisconnectIntegrationModaltitle"
        defaultMessage="Disconnect messaging integration?"
        description="Confirmation dialog title before disconnecting a messaging integration"
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
              id="global.confirmDisconnectIntegrationModalyesDisable"
              defaultMessage="Yes, disconnect"
              description="Confirmation dialog submit button label before disconnecting a messaging integration"
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
          id="global.confirmDisconnectIntegrationModalareYouSureDisconnect"
          defaultMessage="Are you sure you want to disconnect this messaging integration? You can re-connect at any time."
          description="Confirmation dialog message before disconnecting a messaging integration"
          tagName="p"
        />
        <FormattedMessage
          id="global.confirmDisconnectIntegrationModalareYouSureDisconnectResult"
          defaultMessage="End-users will no longer receive responses from your chatbot on this platform."
          description="Additional confirmation dialog message before disconnecting a messaging integration"
          tagName="p"
        />
      </>
    }
  />
);

export default ConfirmDisconnectIntegrationModal;
