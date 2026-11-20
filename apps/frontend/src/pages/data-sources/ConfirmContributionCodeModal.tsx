import { FormattedMessage } from 'react-intl';

import Button from '@ui-components/input/Button';
import { Modal } from '@ui-components/layout/Modal';

type ConfirmContributionCodeModalProps = {
  contributionCode: string;
  open: boolean;
  onCancel: () => void;
  onConfirm: () => void;
};

const ConfirmContributionCodeModal = ({
  contributionCode,
  open,
  onCancel,
  onConfirm,
}: ConfirmContributionCodeModalProps) => (
  <Modal
    alert
    open={open}
    size="small"
    title={
      <FormattedMessage
        id="global.confirmContributionCodeTitle"
        defaultMessage="Change contribution code?"
        description="Confirmation dialog title before changing the contribution code"
      />
    }
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
              id="global.changeCode"
              defaultMessage="Change code"
              description="Confirmation dialog submit button label for changing the contribution code"
            />
          }
          size="small"
          variant="filled"
          onClick={onConfirm}
        />
      </>
    }
    body={
      <>
        <FormattedMessage
          id="global.confirmContributionCodeBody"
          defaultMessage="To send a community contribution, end-users will need to use the new code <strong>{contributionCode}</strong>."
          description="Confirmation dialog message before changing the contribution code"
          tagName="p"
          values={{
            contributionCode,
            strong: (chunks: React.ReactNode) => <strong key="strong">{chunks}</strong>,
          }}
        />
        <FormattedMessage
          id="global.confirmContributionCodeDetails"
          defaultMessage="The old contribution code will no longer work."
          description="Details shown in the confirmation dialog before changing the contribution code"
          tagName="p"
        />
      </>
    }
  />
);

export default ConfirmContributionCodeModal;
