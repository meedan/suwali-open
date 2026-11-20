import { FormattedMessage } from 'react-intl';

import Button from '@ui-components/input/Button';
import { Modal } from '@ui-components/layout/Modal';

type SignupConfirmationModalProps = {
  open: boolean;
  onCancel: () => void;
  onConfirm: () => void;
};

const SignupConfirmationModal = ({
  open,
  onCancel,
  onConfirm,
}: SignupConfirmationModalProps) => (
  <Modal
    alert
    title={
      <FormattedMessage
        id="signup.confirmationModalTitle"
        defaultMessage="Privacy Policy and Terms of Service"
        description="Title of the TOS confirmation dialog shown before account creation"
      />
    }
    open={open}
    size="medium"
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
              id="signup.confirmationModalFirstPersonAccept"
              defaultMessage="I accept"
              description="Confirm button label in TOS confirmation dialog before account creation"
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
          id="signup.confirmationModalBodyCommittment"
          defaultMessage="We are committed to protecting the rights of organizations using our services while also protecting our own rights and interests."
          description="Body text in TOS confirmation dialog shown before account creation"
          tagName="p"
        />
        <FormattedMessage
          id="signup.confirmationModalBodyArticulation"
          defaultMessage="Your use of Suwali is governed by our <tosLink>Terms of Service</tosLink> and <dpaLink>Data Processing Agreement</dpaLink>. Our <privacyLink>Privacy Policy</privacyLink> explains how we collect, use, and protect personal information."
          description="Body text in TOS confirmation dialog shown before account creation"
          tagName="p"
          values={{
            tosLink: msg => (
              <a key="tosLink" target="_blank" href="https://www.suwali.io/terms-of-service/" rel="noopener noreferrer">
                {msg}
              </a>
            ),
            dpaLink: msg => (
              <a key="dpaLink" target="_blank" href="https://meedan.org/legal/meedan-data-processing-agreement/" rel="noopener noreferrer">
                {msg}
              </a>
            ),
            privacyLink: msg => (
              <a key="privacyLink" target="_blank" href="https://www.suwali.io/privacy-policy/" rel="noopener noreferrer">
                {msg}
              </a>
            ),
          }}
        />
        <FormattedMessage
          id="signup.confirmationModalBodyConfirmation"
          defaultMessage="By clicking “I accept”, you agree to our <tosLink>Terms of Service</tosLink> and <dpaLink>Data Processing Agreement</dpaLink>."
          description="Body text in TOS confirmation dialog shown before account creation"
          tagName="p"
          values={{
            tosLink: msg => (
              <a key="tosLink" target="_blank" href="https://www.suwali.io/terms-of-service/" rel="noopener noreferrer">
                {msg}
              </a>
            ),
            dpaLink: msg => (
              <a key="dpaLink" target="_blank" href="https://meedan.org/legal/meedan-data-processing-agreement/" rel="noopener noreferrer">
                {msg}
              </a>
            ),
          }}
        />
      </>
    }
  />
);

export default SignupConfirmationModal;
