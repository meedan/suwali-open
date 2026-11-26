import { useState } from 'react';
import { defineMessages, FormattedMessage, useIntl } from 'react-intl';
import { Link, useNavigate } from 'react-router';

import type { FormValidationRules } from '@helpers/forms';
import { validateEmail, validateField, validateForm } from '@helpers/forms';

import { login } from '@services/AuthService';

import { HttpError } from '@root/NetworkLayer';
import { useSession } from '@root/SessionContext';

import usePageTitle from '@hooks/usePageTitle';

import Button, { ButtonLink } from '@ui-components/input/Button';
import Checkbox from '@ui-components/input/Checkbox';
import TextInput from '@ui-components/input/TextInput';
import FormErrorSummary from '@ui-components/layout/FormErrorSummary';

import styles from '@pages/Login.module.css';

import ConfirmationNeeded from "./ConfirmationNeeded";


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
  passwordRequired: {
    id: 'global.passwordIsRequired',
    defaultMessage: 'Password is required',
    description: 'Error message when the password is blank'
  },
  passwordPlaceholder: {
    id: 'login.passwordPlaceholder',
    defaultMessage: 'Your password',
    description: 'Placeholder for password field'
  },
  unexpectedError: {
    id: 'global.unexpectedError',
    defaultMessage: 'An unexpected error occurred. Please try again.',
    description: 'Generic error message for unexpected errors'
  },
});

const Login: React.FC = () => {
  const intl = useIntl();
  const session = useSession();
  const navigate = useNavigate();

  const [email, setEmail] = useState<string>('');
  const [emailError, setEmailError] = useState<string>('');
  const [password, setPassword] = useState<string>('');
  const [passwordError, setPasswordError] = useState<string>('');
  const [showPassword, setShowPassword] = useState(false);
  const [serverError, setServerError] = useState<string>(() => {
    const reason = sessionStorage.getItem('sessionEndedReason') || '';
    sessionStorage.removeItem('sessionEndedReason');
    return reason;
  });
  const [needsConfirmation, setNeedsConfirmation] = useState(false);

  usePageTitle(
    <FormattedMessage
      id="global.loginPageTitle"
      defaultMessage="Sign in"
      description="Browser Page title for the login page"
    />
  );

  const validationRules = [
    {
      id: 'loginEmail',
      value: email,
      setter: setEmailError,
      validator: validateEmail,
      errorMessage: intl.formatMessage(messages.emailInvalid),
      requiredMessage: intl.formatMessage(messages.emailRequired),
    },
    {
      id: 'loginPassword',
      value: password,
      setter: setPasswordError,
      validator: () => true,
      errorMessage: intl.formatMessage(messages.passwordRequired),
      requiredMessage: intl.formatMessage(messages.passwordRequired),
    },
  ] as FormValidationRules;

  const handleLogin = async () => {
    setServerError('');

    const errors = validateForm(validationRules);
    if (errors.length > 0) {
      return;
    }

    try {
      const data = await login(email, password);

      if (data.user) {
        session.setUser(data.user);
        navigate('/dashboard');
      }
    } catch (error: unknown) {
      console.error('Error during login:', error);

      if (
        error instanceof HttpError &&
        error.data?.error_code === 'unconfirmed_email'
      ) {
        setNeedsConfirmation(true);
        return;
      }

      if (error instanceof Error) {
        setServerError(error.message);
      } else {
        setServerError(intl.formatMessage(messages.unexpectedError));
      }
    }
  };

  if (needsConfirmation) {
    return (
      <ConfirmationNeeded
        email={email}
        password={password}
      />
    );
  }

  return (
    <>
      <div className={styles.loginTop}>
        <FormattedMessage
          id="global.loginwelcomeBack"
          defaultMessage="Welcome back"
          description="Header message on the login screen"
          tagName="h1"
        />
        <FormattedMessage
          id="global.loginupsell"
          defaultMessage="Built for organizations that need to inform, listen, and learn — at scale"
          description="Secondary welcome message upsell for login screen"
          tagName="h2"
        />
      </div>
      <div className={styles.loginForm}>
        <fieldset>
          <TextInput
            autoComplete="username"
            id="loginEmail"
            error={emailError}
            label={
              <FormattedMessage
                id="global.emailAddressInputLabel"
                defaultMessage="Email address"
                description="Text input label for email address field"
              />
            }
            placeholder={intl.formatMessage(messages.emailPlaceholder)}
            required
            type="email"
            size="large"
            value={email}
            onBlur={e => validateField(validationRules, e.target.id)}
            onChange={e => setEmail(e.target.value)}
          />
          <TextInput
            autoComplete="current-password"
            id="loginPassword"
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
            type={showPassword ? 'text' : 'password'}
            value={password}
            onBlur={e => validateField(validationRules, e.target.id)}
            onChange={e => setPassword(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") handleLogin();
            }}
          />
          <Checkbox
            id="loginShowPassword"
            label={
              <FormattedMessage
                id="global.showPassword"
                defaultMessage="Show password"
                description="Checkbox label to toggle the visibility of a password field"
              />
            }
            value="showPassword"
            checked={showPassword}
            onChange={() => setShowPassword(!showPassword)}
          />
        </fieldset>
        <FormErrorSummary
          errors={[emailError, passwordError, serverError].filter(Boolean)}
        />
        <div className={styles.buttonWrapper}>
          <Button
            onClick={handleLogin}
            size="large"
            label={
              <FormattedMessage
                id="global.signIn"
                defaultMessage="Sign in"
                description="Reusable label for login action or button"
              />
            }
            type="submit"
          />
        </div>
      </div>
      <div className={styles.loginFooter}>
        <p>
          <FormattedMessage
            id="global.createAccountUpsell"
            defaultMessage="New to Suwali? or need to join an existing organization?"
            description="Text asking the user if they need to create an account instead of logging in"
          />
          <FormattedMessage
            id="global.logincreateAccount"
            defaultMessage="<createLink>Create an account</createLink>"
            description="Text for instructions on how to create an account"
            values={{
              createLink: msg => (
                <ButtonLink
                  className={styles.loginFooterAction}
                  size="small"
                  themeMode
                  label={msg}
                  key="button"
                  to={{ pathname: '/signup' }}
                />
              ),
            }}
          />
        </p>
        <p>
          <FormattedMessage
            id="global.troubleSigningIn"
            defaultMessage="Trouble signing in?"
            description="Reusable title or label for recover password process"
          />
          <br />
          <FormattedMessage
            id="global.loginrecoverAccount"
            defaultMessage="<recoverLink>Recover your password.</recoverLink>"
            description="Text for instructions on how to recover an account"
            values={{
              recoverLink: msg => (
                <Link key="link" to={{ pathname: '/forgot-password' }}>
                  {msg}
                </Link>
              ),
            }}
          />
        </p>
      </div>
    </>
  );
};

export default Login;
