import { useState } from 'react';
import { defineMessages, FormattedMessage, useIntl } from 'react-intl';
import { Link } from 'react-router';

import { validateEmail } from '@helpers/forms';

import { resetPassword } from '@services/AuthService';

import usePageTitle from '@hooks/usePageTitle';

import Button from '@ui-components/input/Button';
import TextInput from '@ui-components/input/TextInput';
import FormErrorSummary from '@ui-components/layout/FormErrorSummary';

import styles from '@pages/Login.module.css';

const messages = defineMessages({
  emailRequired: {
    id: 'global.emailRequired',
    defaultMessage: 'Email is required',
    description: 'Error message when the email address is blank'
  },
  emailInvalid: {
    id: 'global.emailInvalid',
    defaultMessage: 'Please provide a valid email address',
    description: 'Error message when the email address is not valid'
  },
  emailPlaceholder: {
    id: 'global.emailPlaceholder',
    defaultMessage: 'Your email address',
    description: 'Placeholder for email address field'
  },
  forgotPasswordFailed: {
    id: 'forgotPassword.forgotPasswordFailed',
    defaultMessage: 'Something went wrong. Please try again later.',
    description: 'Error message if the request to recover password fails'
  },
});

const ForgotPassword: React.FC = () => {
  const intl = useIntl();

  const [email, setEmail] = useState<string>('');
  const [emailError, setEmailError] = useState<string>('');
  const [serverError, setServerError] = useState<string>('');
  const [emailSent, setEmailSent] = useState<boolean>(false);

  usePageTitle(
    <FormattedMessage
      id="global.forgotPasswordPageTitle"
      defaultMessage="Forgot password"
      description="Browser Page title for the forgot password page"
    />
  );

  const handleForgotPassword = () => {
    setServerError('');
    if (!email) {
      setEmailError(intl.formatMessage(messages.emailRequired));
    } else if (!validateEmail(email)) {
      setEmailError(intl.formatMessage(messages.emailInvalid));
    }
    if (!email || !validateEmail(email)) return;

    resetPassword(email)
      .then(() => {
        setEmailSent(true);
      })
      .catch((error: unknown) => {
        console.error('Error when trying to reset password:', error);
        setServerError(intl.formatMessage(messages.forgotPasswordFailed));
      });
  };

  return (
    <>
      <div className={styles.loginTop}>
        <FormattedMessage
          id="global.troubleSigningIn"
          defaultMessage="Trouble signing in?"
          description="Reusable title or label for recover password process"
          tagName="h1"
        />
        { emailSent ?
          <div className={styles.forgotPasswordMessage}>
            <FormattedMessage
              id="global.forgotPasswordemailSentPrimary"
              defaultMessage="We sent a recovery link to you at:"
              description="First text displayed when reset password email is sent, followed by the email address"
              tagName="p"
            />
            <div>{email}</div>
            <FormattedMessage
              id="global.forgotPasswordemailSentSecondary"
              defaultMessage="If you haven’t received the email, check your spam folder or <signupLink>sign up</signupLink>."
              description="Second text displayed when reset password email is sent, right after the email address"
              tagName="p"
              values={{
                signupLink: msg => (
                  <Link key="link" to={{ pathname: '/signup' }}>
                    {msg}
                  </Link>
                ),
              }}
            />
          </div> :
          <FormattedMessage
            id="global.forgotPasswordmessage"
            defaultMessage="We will email you instructions on how to reset your password."
            description="Secondary message for forgot password screen"
            tagName="h2"
          />
        }
      </div>
      { !emailSent && (
        <div className={styles.loginForm}>
          <fieldset>
            <TextInput
              autoComplete="username"
              id="forgotPasswordEmail"
              error={emailError}
              label={
                <FormattedMessage
                  id="global.emailAddressInputLabel"
                  defaultMessage="Email address"
                  description="Text input label for email address field"
                />
              }
              helpContent={
                <FormattedMessage
                  id="global.forgotPasswordemailAddressHelp"
                  defaultMessage="We will send a recovery link to this email address."
                  description="Helper text for email address field on forgot password page"
                />
              }
              placeholder={intl.formatMessage(messages.emailPlaceholder)}
              required
              type="email"
              size="large"
              value={email}
              onBlur={e => {
                if (e.target.value && !validateEmail(e.target.value)) {
                  setEmailError('Please provide a valid email address');
                } else if (e.target.value) {
                  setEmailError('');
                }
              }}
              onChange={e => setEmail(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") handleForgotPassword();
              }}
            />
          </fieldset>
          <FormErrorSummary
            errors={[emailError, serverError].filter(Boolean)}
          />
          <div className={styles.buttonWrapper}>
            <Button
              onClick={handleForgotPassword}
              size="large"
              label={
                <FormattedMessage
                  id="global.forgotPasswordsendRecoveryLink"
                  defaultMessage="Send recovery link"
                  description="Button label to recover password"
                />
              }
              type="submit"
            />
          </div>
        </div>
      )}
      <div className={styles.loginFooter}>
        <FormattedMessage
          id="global.returnToSignIn"
          defaultMessage="<loginLink>Return to sign in.</loginLink>"
          description="Text to return to sign in page"
          values={{
            loginLink: msg => (
              <Link key="link" to={{ pathname: '/login' }}>
                {msg}
              </Link>
            ),
          }}
          tagName="p"
        />
      </div>
    </>
  );
};

export default ForgotPassword;
