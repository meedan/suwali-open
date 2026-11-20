import { useState } from 'react';
import { defineMessages, FormattedMessage, useIntl } from 'react-intl';
import { Link, useNavigate } from 'react-router';

import { validateForm, validatePassword, validatePasswordStrength } from '@helpers/forms';

import { changePassword } from '@services/AuthService';

import usePageTitle from '@hooks/usePageTitle';

import Button from '@ui-components/input/Button';
import TextInput from '@ui-components/input/TextInput';
import FormErrorSummary from '@ui-components/layout/FormErrorSummary';
import PasswordStrength from '@ui-components/layout/PasswordStrength';

import styles from '@pages/Login.module.css';

const messages = defineMessages({
  tokenRequired: {
    id: 'changePassword.tokenRequired',
    defaultMessage: 'Token is required',
    description: 'Error message when the reset token is not in the URL'
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
  changePasswordFailed: {
    id: 'changePassword.failed',
    defaultMessage: 'It was not possible to change your password. Please try again.',
    description: 'Failure message when it was not possible to change the password'
  },
  passwordStrength: {
    id: 'global.passwordStrength',
    defaultMessage: 'Your password must contain 8 or more characters with a mix of letters, numbers, and symbols.',
    description: 'Instructions to the user for the requirements of the password they are creating'
  },
});

const ChangePassword: React.FC = () => {
  const intl = useIntl();
  const navigate = useNavigate();
  const urlParams = new URLSearchParams(window.location.search);
  const token = urlParams.get('token') || '';
  const tokenError = token ? '' : intl.formatMessage(messages.tokenRequired);

  const [password, setPassword] = useState<string>('');
  const [passwordError, setPasswordError] = useState<string>('');
  const [strength, setStrength] = useState<number>(0);
  const [serverError, setServerError] = useState<string>('');
  const [passwordChanged, setPasswordChanged] = useState<boolean>(false);

  usePageTitle(
    <FormattedMessage
      id="global.changePassword"
      defaultMessage="Change password"
      description="Title or label for changing the current user login password"
    />
  );

  const validationRule = {
    id: 'changePassword',
    value: password,
    setter: setPasswordError,
    validator: validatePassword,
    errorMessage: intl.formatMessage(messages.passwordStrength),
    requiredMessage: intl.formatMessage(messages.passwordRequired),
  };

  const handlePassword = (newValue: string) => {
    setPassword(newValue);
    setStrength(validatePasswordStrength(newValue));
  };

  const handleChangePassword = () => {
    if (tokenError) return;

    setServerError('');
    if (!password) {
      setPasswordError(intl.formatMessage(messages.passwordRequired));
      return;
    }

    changePassword(password, token)
      .then((data) => {
        if (data.message) {
          setPasswordChanged(true);
        }
      })
      .catch((error: unknown) => {
        console.error('Error when changing password:', error);
        setServerError(intl.formatMessage(messages.changePasswordFailed));
      });
  };

  const handleGoToLoginPage = () => {
    navigate('/login');
  };

  return (
    <>
      { passwordChanged ?
        <>
          <div className={styles.loginTop}>
            <FormattedMessage
              id="global.changePasswordtitleChanged"
              defaultMessage="Password successfully changed"
              description="Header message on the change password screen, after changing the password"
              tagName="h1"
            />
            <div className={styles.forgotPasswordMessage}>
              <FormattedMessage
                id="global.changePasswordchangedMessage"
                defaultMessage="You can use your new password to sign in."
                description="Success message displayed when password is changed"
                tagName="p"
              />
            </div>
          </div>
          <div className={styles.loginForm}>
            <div className={styles.buttonWrapper}>
              <Button
                onClick={handleGoToLoginPage}
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
        </> :
        <>
          <div className={styles.loginTop}>
            <FormattedMessage
              id="global.changePasswordtitleChange"
              defaultMessage="Change your password"
              description="Header message on the change password screen, before changing the password"
              tagName="h1"
            />
          </div>
          <div className={styles.loginForm}>
            <fieldset>
              <TextInput
                id="newPassword"
                error={passwordError}
                label={
                  <FormattedMessage
                    id="global.changePasswordpassword"
                    defaultMessage="New password"
                    description="Text input label for new password field"
                  />
                }
                placeholder={intl.formatMessage(messages.passwordPlaceholder)}
                required
                size="large"
                type="password"
                value={password}
                onBlur={() => { validateForm([validationRule], false); }}
                onChange={e => handlePassword(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") handleChangePassword();
                }}
              />
              <PasswordStrength strength={strength} />
            </fieldset>
            <FormErrorSummary
              errors={[tokenError, passwordError, serverError].filter(Boolean)}
            />
            <div className={styles.buttonWrapper}>
              <Button
                onClick={handleChangePassword}
                size="large"
                label={
                  <FormattedMessage
                    id="global.changePasswordsubmit"
                    defaultMessage="Change my password"
                    description="Button label to submit new password"
                  />
                }
                type="submit"
              />
            </div>
          </div>
        </>
      }
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

export default ChangePassword;
