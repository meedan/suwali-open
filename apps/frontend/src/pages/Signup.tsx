import clsx from 'clsx';
import { useEffect, useRef, useState } from 'react';
import { defineMessages, FormattedMessage, useIntl } from 'react-intl';

import type { FormValidationRules } from '@helpers/forms';
import {
  validateEmail,
  validateField,
  validateForm,
  validateInviteCode,
  validatePassword,
  validatePasswordStrength,
} from '@helpers/forms';

import { signup } from '@services/AuthService';

import usePageTitle from '@hooks/usePageTitle';

import Button, { ButtonLink } from '@ui-components/input/Button';
import Checkbox from '@ui-components/input/Checkbox';
import TextInput from '@ui-components/input/TextInput';
import FormErrorSummary from '@ui-components/layout/FormErrorSummary';
import Icon from "@ui-components/layout/Icon";
import PasswordStrength from '@ui-components/layout/PasswordStrength';

import styles from '@pages/Login.module.css';

import ConfirmationNeeded from './ConfirmationNeeded';
import SignupConfirmationModal from './SignupConfirmationModal';

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
    id: 'global.passwordPlaceholder',
    defaultMessage: 'Create a strong password',
    description: 'Placeholder for password field'
  },
  passwordStrength: {
    id: 'global.passwordStrength',
    defaultMessage: 'Your password must contain 8 or more characters with a mix of letters, numbers, and symbols.',
    description: 'Instructions to the user for the requirements of the password they are creating'
  },
  invitePlaceholder: {
    id: 'signup.invitePlaceholder',
    defaultMessage: 'Invite code',
    description: 'Placeholder for the invite code field'
  },
  inviteCodeInvalidFormat: {
    id: 'signup.inviteCodeInvalidFormat',
    defaultMessage: 'Please provide a valid invite code.',
    description: 'More verbose error message about invite code being incorrect format'
  },
  unexpectedError: {
    id: 'global.unexpectedError',
    defaultMessage: 'An unexpected error occurred. Please try again.',
    description: 'Generic error message for unexpected errors'
  },
});

const Signup = () => {
  const intl = useIntl();
  const [email, setEmail] = useState<string>('');
  const [emailError, setEmailError] = useState<string>('');
  const [password, setPassword] = useState<string>('');
  const [strength, setStrength] = useState<number>(0);
  const [passwordError, setPasswordError] = useState<string>('');
  const [showPassword, setShowPassword] = useState(false);
  const [inviteCode, setInviteCode] = useState<string>('');
  const [inviteCodeError, setInviteCodeError] = useState<string>('');
  const [errorSummary, setErrorSummary] = useState<string[]>([]);
  const [needsConfirmation, setNeedsConfirmation] = useState(false);
  const [confirmModalOpen, setConfirmModalOpen] = useState(false);
  const [showInviteCode, setShowInviteCode] = useState(false);
  const inviteCodeRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (showInviteCode) {
      inviteCodeRef.current?.focus();
    }
  }, [showInviteCode]);

  usePageTitle(
    <FormattedMessage
      id="global.signupPageTitle"
      defaultMessage="Sign up"
      description="Browser Page title for the sign up page"
    />
  );

  const validationRules = [
    {
      id: 'signupEmail',
      value: email,
      setter: setEmailError,
      validator: validateEmail,
      errorMessage: intl.formatMessage(messages.emailInvalid),
      requiredMessage: intl.formatMessage(messages.emailRequired),
    },
    {
      id: 'signupPassword',
      value: password,
      setter: setPasswordError,
      validator: validatePassword,
      errorMessage: intl.formatMessage(messages.passwordStrength),
      requiredMessage: intl.formatMessage(messages.passwordRequired),
    },
    {
      id: 'signupInviteCode',
      value: inviteCode,
      setter: setInviteCodeError,
      validator: validateInviteCode,
      errorMessage: intl.formatMessage(messages.inviteCodeInvalidFormat),
    },
  ] as FormValidationRules;

  const handlePassword = (newValue: string) => {
    setPassword(newValue);
    setStrength(validatePasswordStrength(newValue));
  };

  const handleSignup = () => {
    const errors = validateForm(validationRules);
    setErrorSummary(errors);
    if (errors.length > 0) {
      return;
    }
    setConfirmModalOpen(true);
  };

  const handleConfirmedSignup = () => {
    setConfirmModalOpen(false);
    signup(email, password, inviteCode)
      .then(() => {
        setNeedsConfirmation(true);
      })
      .catch((error: Error) => {
        if (error instanceof Error) {
          setErrorSummary([error.message]);
        } else {
          setErrorSummary([intl.formatMessage(messages.unexpectedError)]);
        }
      });
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
      <SignupConfirmationModal
        open={confirmModalOpen}
        onCancel={() => setConfirmModalOpen(false)}
        onConfirm={handleConfirmedSignup}
      />
      <div className={styles.loginTop}>
        <FormattedMessage
          id="global.signupwelcome"
          defaultMessage="Welcome, create your Suwali account"
          description="Header message on the sign up screen"
          tagName="h1"
        />
        <FormattedMessage
          id="global.signupupsell"
          defaultMessage="You are seconds away from meeting your audience demand without compromising your organization’s values."
          description="Secondary welcome message up sell for signup screen"
          tagName="h2"
        />
      </div>
      <div className={styles.loginForm}>
        <TextInput
          autoComplete="username"
          id="signupEmail"
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
              id="global.emailAddressSignUpContext"
              defaultMessage="Use an organization email to easily collaborate with teammates."
              description="Help text for email address to encourage user to use their organization email address instead of a personal email address"
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
          autoComplete="new-password"
          id="signupPassword"
          error={passwordError}
          label={
            <FormattedMessage
              id="global.signuppassword"
              defaultMessage="Create your password"
              description="Text input label for password field"
            />
          }
          placeholder={intl.formatMessage(messages.passwordPlaceholder)}
          required
          type={showPassword ? 'text' : 'password'}
          size="large"
          value={password}
          onBlur={e => validateField(validationRules, e.target.id)}
          onChange={e => handlePassword(e.target.value)}
        />
        <Checkbox
          id="signupShowPassword"
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
        <PasswordStrength strength={strength} />

        {!showInviteCode && (
          <Button
            className={styles.signupInviteToggle}
            iconLeft={<Icon id="chevron_right" />}
            label={
              <FormattedMessage
                id="global.signupInviteToggle"
                defaultMessage="Have an invite code to join a team already on Suwali?"
                description="Link to reveal the invite code field on the sign up form"
              />
            }
            size="medium"
            variant="text"
            onClick={() => setShowInviteCode(true)}
          />
        )}
        <div className={clsx(styles.signupInvite, !showInviteCode && styles.signupInviteHidden)}>
          <FormattedMessage
            id="global.signupInviteDescription"
            defaultMessage="If you have been given an invite code to join an organization, please provide it below. Contact your administrator if you need help locating your invite code."
            description="Description of using an invite code from an organization to join the system"
            tagName="p"
          />
          <TextInput
            ref={inviteCodeRef}
            id="signupInviteCode"
            error={inviteCodeError}
            helpContent={
              <FormattedMessage
                id="global.signupinviteHelp"
                defaultMessage="If you have an invite code from your organization provide it here. Don’t worry, this is optional to get started."
                description="Help text for the invite code field to help users locate their code"
              />
            }
            label={
              <FormattedMessage
                id="global.inviteCode"
                defaultMessage="Invite code"
                description="Reusable label for invite code"
              />
            }
            labelContext={
              <FormattedMessage
                id="global.optional"
                defaultMessage="Optional"
                description="Reusable label for optional areas or inputs"
              />
            }
            placeholder={intl.formatMessage(messages.invitePlaceholder)}
            size="large"
            value={inviteCode}
            onBlur={e => validateField(validationRules, e.target.id)}
            onChange={e => setInviteCode(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") handleSignup();
            }}
          />
        </div>
        <FormErrorSummary
          errors={errorSummary}
        />
        <div className={styles.buttonWrapper}>
          <Button
            onClick={handleSignup}
            size="large"
            label={
              <FormattedMessage
                id="global.signupcreateAccount"
                defaultMessage="Create account"
                description="Button label to create an account for the system"
              />
            }
            type="submit"
          />
        </div>
      </div>
      <div className={styles.loginFooter}>
        <p>
          <FormattedMessage
            id="global.signupalready"
            defaultMessage="Already have an account?"
            description="Question asking the user if they need to login instead of registering"
          />
          <br />
          <FormattedMessage
            id="global.signupbackToLogin"
            defaultMessage="<loginLink>Sign in to an existing account</loginLink>"
            description="Link taking the user back to the login screen"
            values={{
              loginLink: msg => (
                <ButtonLink
                  className={styles.loginFooterAction}
                  label={msg}
                  size="small"
                  key="button"
                  themeMode
                  to={{ pathname: '/login' }}
                />
              ),
            }}
          />
        </p>
      </div>
    </>
  );
};

export default Signup;
