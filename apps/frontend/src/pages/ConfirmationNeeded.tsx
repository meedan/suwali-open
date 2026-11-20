import { useEffect, useRef, useState } from 'react';
import { defineMessages, FormattedMessage, useIntl } from 'react-intl';
import { useNavigate } from 'react-router';

import { SUPPORT_EMAIL } from '@constants/App';

import { login, resendConfirmation } from '@services/AuthService';

import { HttpError } from '@root/NetworkLayer';
import { useSession } from '@root/SessionContext';

import usePageTitle from '@hooks/usePageTitle';
import { useToast } from '@hooks/useToast';

import Button from '@ui-components/input/Button';

import styles from '@pages/Login.module.css';

const messages = defineMessages({
  resendSuccess: {
    id: 'global.emailConfirmationResendPlain',
    defaultMessage: 'Email verification sent to {email}',
    description: 'Toast message shown when the confirmation email is successfully sent',
  },
  resendError: {
    id: 'global.emailConfirmationResendError',
    defaultMessage: 'Failed to resend email. Please try again later.',
    description: 'Toast error shown when resending the confirmation email fails',
  },
});

type ConfirmationNeededProps = {
  email: string;
  password: string;
};

const ConfirmationNeeded: React.FC<ConfirmationNeededProps> = ({ email, password }) => {
  const intl = useIntl();
  const { toast } = useToast();
  const [isSending, setIsSending] = useState(false);
  const navigate = useNavigate();
  const session = useSession();
  const isLoggingInRef = useRef(false);

  usePageTitle(
    <FormattedMessage
      id="global.confirmationNeededPageTitle"
      defaultMessage="Confirmation needed"
      description="Browser page title for the screen blocking access until email verification is complete"
    />
  );

  useEffect(() => {
  if (!email || !password) {
    navigate('/');
    return;
  }

  const attemptLogin = async () => {
    if (isLoggingInRef.current) return;
    isLoggingInRef.current = true;

    try {
      const data = await login(email, password);

      if (data.user) {
        session.setUser(data.user);
        navigate('/dashboard', { replace: true });
      }

    } catch (error: unknown) {
      if (
        error instanceof HttpError &&
        error.data?.error_code === 'unconfirmed_email'
      ) {
        return;
      }
      console.error('Error during auto-login:', error);
    } finally {
      isLoggingInRef.current = false;
    }
  };

  const handleFocus = () => {
    attemptLogin();
  };

  window.addEventListener('focus', handleFocus);

  return () => {
    window.removeEventListener('focus', handleFocus);
  };
}, [email, password, navigate, session]);

  const handleResend = () => {
    if (isSending || !email) return;
    setIsSending(true);

    resendConfirmation(email)
    .then(() => {
      toast('success', intl.formatMessage(messages.resendSuccess, { email }));
    })
    .catch((error: unknown) => {
      toast('error', intl.formatMessage(messages.resendError));
      console.error('Failed to resend confirmation email:', error);
    })
    .finally(() => {
      setIsSending(false);
    });
  };

  return (
    <>
      <>
        <div className={styles.loginTop}>
          <hgroup>
            <FormattedMessage
              id="global.accountCreated"
              defaultMessage="Account created!"
              description="Header message on the account confirmation page that indicates the account was successfully created"
              tagName="h1"
            />
          </hgroup>
          <div className={styles.forgotPasswordMessage}>
            <FormattedMessage
              id="global.emailConfirmationconfirming"
              defaultMessage="Next, confirm your email address."
              description="Header message on the account confirmation page when the user needs to complete email confirmation"
              tagName="p"
            />
            <FormattedMessage
              id="global.emailConfirmationconfirmingAddress"
              defaultMessage="We have sent an email verification link to:"
              description="Message that explains what email address the account confirmation link was sent to"
              tagName="p"
            />
            <div>{email}</div>
            <FormattedMessage
              id="global.emailConfirmationThanks"
              defaultMessage="Thanks for helping us keep Suwali secure!"
              description="Message that explains that verifying your email address helps the system be more secure"
              tagName="p"
            />
          </div>
        </div>
        <div className={styles.loginForm}>
          <div className={styles.buttonWrapper}>
            <Button
              onClick={handleResend}
              size="large"
              disabled={isSending}
              label={
                isSending ?
                <FormattedMessage
                  id="global.sending"
                  defaultMessage="Sending…"
                  description="Generic label for ongoing send operation."
                />
                :
                <FormattedMessage
                  id="global.emailConfirmationresendEmail"
                  defaultMessage="Resend email"
                  description="Button label to allow the user to resend the email with confirmation link."
                />
              }
              type="submit"
            />
          </div>
        </div>
        <FormattedMessage
          id="global.emailConfirmationquestions"
          defaultMessage="If you have any questions, get in touch at {helpLink}."
          description="Text for instructions on how to create an account"
          tagName="p"
          values={{
            helpLink: (
              <strong key="helpLink">
                <a href={`mailto:${SUPPORT_EMAIL}`} rel="noopener noreferrer" title={SUPPORT_EMAIL}>
                  {SUPPORT_EMAIL}
                </a>
              </strong>
            ),
          }}
        />
      </>
    </>
  );
};

export default ConfirmationNeeded;
