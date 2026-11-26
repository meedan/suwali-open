import { useEffect, useState } from 'react'
import { defineMessages, FormattedMessage, useIntl } from 'react-intl';
import { useNavigate } from 'react-router';

import { confirmEmail, login } from '@services/AuthService';

import { HttpError } from '@root/NetworkLayer';
import { useSession } from '@root/SessionContext';

import usePageTitle from '@hooks/usePageTitle';

import Button from '@ui-components/input/Button';
import TextInput from '@ui-components/input/TextInput';
import FormErrorSummary from '@ui-components/layout/FormErrorSummary';
import Icon from '@ui-components/layout/Icon';

import layoutStyles from '@layouts/InterstitialLayout.module.css';

import styles from '@pages/EmailConfirmation.module.css';
import loginStyles from '@pages/Login.module.css';

const messages = defineMessages({
  emailMissing: {
    id: 'global.emailConfirmationEmailMissing',
    defaultMessage: 'Email address is missing from this link. Please use the original link from your email.',
    description: 'Error shown on the confirmation page when the email query parameter is missing from the URL'
  },
  passwordPlaceholder: {
    id: 'login.passwordPlaceholder',
    defaultMessage: 'Your password',
    description: 'Placeholder for password field'
  },
  passwordRequired: {
    id: 'global.passwordIsRequired',
    defaultMessage: 'Password is required',
    description: 'Error message when the password is blank'
  },
  unexpectedError: {
    id: 'global.unexpectedError',
    defaultMessage: 'An unexpected error occurred. Please try again.',
    description: 'Generic error message for unexpected errors'
  },
});

type ConfirmationState = 'idle' | 'submitting' | 'failure';

const EmailConfirmation = () => {
  const intl = useIntl();
  const navigate = useNavigate();
  const session = useSession();
  const urlParams = new URLSearchParams(window.location.search);
  const token = urlParams.get('confirmation_token');
  const emailFromUrl = urlParams.get('email') ?? '';

  const emailError = emailFromUrl ? '' : intl.formatMessage(messages.emailMissing);

  const [confirmationState, setConfirmationState] = useState<ConfirmationState>('idle');
  const [password, setPassword] = useState('');
  const [passwordError, setPasswordError] = useState('');
  const [serverError, setServerError] = useState('');

  usePageTitle(
    <FormattedMessage
      id="global.emailConfirmationPageTitle"
      defaultMessage="Email confirmation"
      description="Browser Page title for the email confirmation page"
    />
  );

  useEffect(() => {
    if (!token) {
      navigate('/');
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // Run once on mount to check for token and redirect if missing

  const handleConfirmAndSignIn = async () => {
    if (!token || !emailFromUrl) return;

    if (!password) {
      setPasswordError(intl.formatMessage(messages.passwordRequired));
      return;
    }

    setPasswordError('');
    setServerError('');
    setConfirmationState('submitting');

    try {
      // Step 1: Attempt login
      const loginResponse = await login(emailFromUrl, password);

      // Already confirmed — just sign in
      session.setUser(loginResponse.user!);
      navigate('/dashboard');
      return;
    } catch (error: unknown) {
      // Only continue if password is correct but email is unconfirmed
      if (
        error instanceof HttpError &&
        error.data?.error_code === 'unconfirmed_email'
      ) {
        try {
          // Step 2: Confirm email
          const confirmResponse = await confirmEmail(token);

          if (!confirmResponse.success) {
            setConfirmationState('failure');
            return;
          }

          // Step 3: Login again
          const finalLoginResponse = await login(emailFromUrl, password);
          session.setUser(finalLoginResponse.user!);
          navigate('/dashboard');
          return;

        } catch (confirmError) {
          console.error('Error during confirmation:', confirmError);

          setConfirmationState('idle');
          setServerError(intl.formatMessage(messages.unexpectedError));
          return;
        }
      }

      // Any other error → wrong password or unknown
      console.error('Error during confirmation:', error);
      setConfirmationState('idle');

      if (error instanceof Error) {
        setServerError(error.message);
      } else {
        setServerError(
          intl.formatMessage(messages.unexpectedError)
        );
      }
    }
  };

  if (!token) {
    return null;
  }

  return (
    <div className={styles.emailConfirmationWrapper}>
      {confirmationState == 'failure' && (
        <>
          <hgroup>
            <Icon id="error" className={layoutStyles.interstitialIcon} />
            <FormattedMessage
              id="global.emailConfirmationfailure"
              defaultMessage="We couldn’t confirm your account."
              description="Header message on the account confirmation page when confirmation fails"
              tagName="h1"
            />
            <FormattedMessage
              id="global.emailConfirmationfailureCorrect"
              defaultMessage="Please make sure the link is correct."
              description="Header message on the account confirmation page when confirmation fails to ensure the user checks for correctness"
              tagName="p"
            />
          </hgroup>
          <div className={loginStyles.buttonWrapper}>
            <Button
              onClick={() => navigate('/login')}
              size="large"
              label={
                <FormattedMessage
                  id="global.emailConfirmationgoToLoginPage"
                  defaultMessage="Go to the sign-in page"
                  description="Button label to go to the login page"
                />
              }
              type="submit"
            />
          </div>
        </>
      )}
      {(confirmationState === 'idle' || confirmationState === 'submitting') && (
        <>
          <hgroup>
            <Icon id="hand_waving_color" className={layoutStyles.interstitialIcon} />
            <FormattedMessage
              id="global.emailConfirmationConfirmTitle"
              defaultMessage="Confirm your email address"
              description="Header message on the confirmation page when user needs to confirm their email"
              tagName="h1"
            />
            <FormattedMessage
              id="global.emailConfirmationConfirmMessage"
              defaultMessage="Enter your password to confirm your email and sign in."
              description="Message explaining the user needs to enter their password to confirm their email and sign in"
              tagName="p"
            />
          </hgroup>
          <div className={styles.emailConfirmationFormWrapper}>
            <div className={loginStyles.loginForm}>
              <fieldset>
                <TextInput
                  autoComplete="username"
                  disabled
                  error={emailError}
                  id="confirmEmail"
                  label={
                    <FormattedMessage
                      id="global.emailAddressInputLabel"
                      defaultMessage="Email address"
                      description="Text input label for email address field"
                    />
                  }
                  size="large"
                  type="email"
                  value={emailFromUrl}
                />
                <TextInput
                  autoComplete="current-password"
                  autoFocus // eslint-disable-line jsx-a11y/no-autofocus
                  id="confirmPassword"
                  error={passwordError}
                  label={
                    <FormattedMessage
                      id="global.loginpassword"
                      defaultMessage="Password"
                      description="Text input label for password field"
                    />
                  }
                  placeholder={intl.formatMessage(messages.passwordPlaceholder)}
                  required
                  size="large"
                  type="password"
                  value={password}
                  onBlur={e => { if (e.target.value) setPasswordError(''); }}
                  onChange={e => setPassword(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter') handleConfirmAndSignIn(); }}
                />
              </fieldset>
              <FormErrorSummary errors={[emailError, serverError].filter(Boolean)} />
              <div className={loginStyles.buttonWrapper}>
                <Button
                  label={
                    <FormattedMessage
                      id="global.emailConfirmationConfirmButton"
                      defaultMessage="Confirm and sign in"
                      description="Button label to confirm email address and sign in"
                    />
                  }
                  onClick={handleConfirmAndSignIn}
                  size="large"
                  disabled={!!emailError || confirmationState === 'submitting'}
                  type="submit"
                />
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
};

export default EmailConfirmation;
