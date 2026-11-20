import { useRef, useState } from 'react';
import { defineMessages, FormattedDate, FormattedMessage, useIntl } from 'react-intl';
import { useQuery } from '@tanstack/react-query';

import { SUPPORT_EMAIL } from '@constants/App';

import type { FormValidationRules } from '@helpers/forms';
import { validateField, validateForm, validatePassword, validatePasswordStrength } from '@helpers/forms';

import { updatePassword } from '@services/AuthService';
import { fetchMe } from '@services/ProfileService';

import { HttpError } from '@root/NetworkLayer';

import { useToast } from '@hooks/useToast';

import Button from '@ui-components/input/Button';
import Checkbox from '@ui-components/input/Checkbox';
import TextInput from '@ui-components/input/TextInput';
import FormErrorSummary from '@ui-components/layout/FormErrorSummary';
import PasswordStrength from '@ui-components/layout/PasswordStrength';

import settingsStyles from '@pages/Settings.module.css';

const messages = defineMessages({
  passwordRequired: {
    id: 'global.passwordIsRequired',
    defaultMessage: 'Password is required',
    description: 'Error message when the password is blank',
  },
  currentPasswordPlaceholder: {
    id: 'global.securitycurrentPasswordPlaceholder',
    defaultMessage: 'Your current password',
    description: 'Placeholder for the current password field',
  },
  newPasswordPlaceholder: {
    id: 'global.passwordPlaceholder',
    defaultMessage: 'Create a strong password',
    description: 'Placeholder for password field',
  },
  newPasswordStrengthError: {
    id: 'global.passwordStrength',
    defaultMessage: 'Your password must contain 8 or more characters with a mix of letters, numbers, and symbols.',
    description: 'Instructions to the user for the requirements of the password they are creating'
  },
  confirmPasswordPlaceholder: {
    id: 'global.securityconfirmPasswordPlaceholder',
    defaultMessage: 'Re-enter your new password',
    description: 'Placeholder for the confirm new password field',
  },
  confirmPasswordMismatch: {
    id: 'global.securityconfirmPasswordMismatch',
    defaultMessage: 'The passwords you entered do not match.',
    description: 'Error message shown when the new password and confirmation do not match',
  },
  updateSuccess: {
    id: 'global.securityupdateSuccess',
    defaultMessage: 'Password updated successfully.',
    description: 'Success message shown to the user when they successfully change their password',
  },
  updateError: {
    id: 'global.securityupdateError',
    defaultMessage: 'There was an error updating your password. Please try again.',
    description: 'Generic error message shown when there is a problem updating the password',
  },
});

const Account = () => {
  const intl = useIntl();
  const { toast } = useToast();

  const { data: user } = useQuery({ queryKey: ['/me'], queryFn: fetchMe });

  const [currentPassword, setCurrentPassword] = useState('');
  const [currentPasswordError, setCurrentPasswordError] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [newPasswordError, setNewPasswordError] = useState('');
  const [newPasswordStrength, setNewPasswordStrength] = useState(0);
  const [confirmPassword, setConfirmPassword] = useState('');
  const [confirmPasswordError, setConfirmPasswordError] = useState('');
  const [showPasswords, setShowPasswords] = useState(false);
  const [serverError, setServerError] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const changePasswordDetailsRef = useRef<HTMLDetailsElement>(null);

  const requiredMessage = intl.formatMessage(messages.passwordRequired);

  const validationRules = [
    {
      id: 'currentPassword',
      value: currentPassword,
      setter: setCurrentPasswordError,
      validator: () => true,
      errorMessage: requiredMessage,
      requiredMessage,
    },
    {
      id: 'newPassword',
      value: newPassword,
      setter: setNewPasswordError,
      validator: validatePassword,
      errorMessage: intl.formatMessage(messages.newPasswordStrengthError),
      requiredMessage,
    },
    {
      id: 'confirmPassword',
      value: confirmPassword,
      setter: setConfirmPasswordError,
      validator: (value: string) => value === newPassword,
      errorMessage: intl.formatMessage(messages.confirmPasswordMismatch),
      requiredMessage,
    },
  ] as FormValidationRules;

  const resetFields = () => {
    setCurrentPassword('');
    setCurrentPasswordError('');
    setNewPassword('');
    setNewPasswordError('');
    setNewPasswordStrength(0);
    setConfirmPassword('');
    setConfirmPasswordError('');
    setServerError('');
  };

  const handleUpdatePassword = async () => {
    if (isSubmitting) return;

    setServerError('');

    const errors = validateForm(validationRules);
    if (errors.length > 0) return;

    setIsSubmitting(true);

    try {
      await updatePassword(currentPassword, newPassword);
      resetFields();
      // The toast already confirms success - collapse the section instead of
      // leaving the cleared form visible.
      if (changePasswordDetailsRef.current) changePasswordDetailsRef.current.open = false;
      toast('success', intl.formatMessage(messages.updateSuccess));
    } catch (error: unknown) {
      console.error('Error updating password', error);
      setServerError(error instanceof HttpError ? error.message : intl.formatMessage(messages.updateError));
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleCancel = () => {
    resetFields();
    if (changePasswordDetailsRef.current) changePasswordDetailsRef.current.open = false;
  };

  return (
    <>
      <details className={settingsStyles.detailsSection} ref={changePasswordDetailsRef}>
        <FormattedMessage
          id="global.changePassword"
          defaultMessage="Change password"
          description="Title or label for changing the current user login password"
          tagName="summary"
        />
        <div className={settingsStyles.detailsContent}>
          <fieldset className="form-sections">
            <TextInput
              id="currentPassword"
              autoComplete="current-password"
              error={currentPasswordError}
              label={
                <FormattedMessage
                  id="global.securitycurrentPasswordLabel"
                  defaultMessage="Current password"
                  description="Input label for the user’s current password when changing their password"
                />
              }
              placeholder={intl.formatMessage(messages.currentPasswordPlaceholder)}
              required
              size="large"
              type={showPasswords ? 'text' : 'password'}
              value={currentPassword}
              onBlur={e => validateField(validationRules, e.target.id)}
              onChange={e => setCurrentPassword(e.target.value)}
            />
            <TextInput
              id="newPassword"
              autoComplete="new-password"
              error={newPasswordError}
              label={
                <FormattedMessage
                  id="global.securitynewPasswordLabel"
                  defaultMessage="New password"
                  description="Input label for the new password field when changing a password"
                />
              }
              placeholder={intl.formatMessage(messages.newPasswordPlaceholder)}
              required
              size="large"
              type={showPasswords ? 'text' : 'password'}
              value={newPassword}
              onBlur={e => validateField(validationRules, e.target.id)}
              onChange={(e) => {
                setNewPassword(e.target.value);
                setNewPasswordStrength(validatePasswordStrength(e.target.value));
              }}
            />
            <PasswordStrength strength={newPasswordStrength} />
            <TextInput
              id="confirmPassword"
              autoComplete="new-password"
              error={confirmPasswordError}
              label={
                <FormattedMessage
                  id="global.securityconfirmPasswordLabel"
                  defaultMessage="Confirm new password"
                  description="Input label for confirming the new password when changing a password"
                />
              }
              placeholder={intl.formatMessage(messages.confirmPasswordPlaceholder)}
              required
              size="large"
              type={showPasswords ? 'text' : 'password'}
              value={confirmPassword}
              onBlur={e => validateField(validationRules, e.target.id)}
              onChange={e => setConfirmPassword(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') handleUpdatePassword();
              }}
            />
            <Checkbox
              id="securityShowPasswords"
              label={
                <FormattedMessage
                  id="global.showPassword"
                  defaultMessage="Show password"
                  description="Checkbox label to toggle the visibility of a password field"
                />
              }
              value="showPasswords"
              checked={showPasswords}
              onChange={() => setShowPasswords(!showPasswords)}
            />
            <FormErrorSummary
              errors={[currentPasswordError, newPasswordError, confirmPasswordError, serverError].filter(Boolean)}
            />
          </fieldset>
          <div className={settingsStyles.buttonWrapper}>
            <Button
              label={
                <FormattedMessage
                  id="global.securityupdatePassword"
                  defaultMessage="Update password"
                  description="Button label for submitting a password change"
                />
              }
              size="medium"
              disabled={isSubmitting}
              onClick={handleUpdatePassword}
            />
            <Button
              label={
                <FormattedMessage
                  id="global.cancel"
                  defaultMessage="Cancel"
                  description="Reusable label for cancel buttons"
                />
              }
              size="medium"
              variant="text"
              themeMode
              disabled={isSubmitting}
              onClick={handleCancel}
            />
          </div>
        </div>
      </details>

      <details className={settingsStyles.detailsSection}>
        <FormattedMessage
          id="global.accountInformation"
          defaultMessage="Your information"
          description="Section title for account information"
          tagName="summary"
        />
        <div className={settingsStyles.detailsContent}>
          <dl className={settingsStyles.activityList}>
            <FormattedMessage
              id="account.lastLoginLabel"
              defaultMessage="Last sign-in"
              description="Label for the date and time the user most recently signed in"
              tagName="dt"
            />
            <dd>
              {user?.last_login_at
                ? <FormattedDate value={user.last_login_at} dateStyle="long" timeStyle="short" />
                : (
                  <FormattedMessage
                    id="global.notRecorded"
                    defaultMessage="Not recorded yet"
                    description="Shown in place of a date when the value was never measured, e.g. a last login that happened before activity tracking existed"
                  />
                )}
            </dd>
            <FormattedMessage
              id="account.lastActiveLabel"
              defaultMessage="Last active"
              description="Label for the date and time the user most recently used the application"
              tagName="dt"
            />
            <dd>
              {user?.last_active_at
                ? <FormattedDate value={user.last_active_at} dateStyle="long" timeStyle="short" />
                : (
                  <FormattedMessage
                    id="global.notRecorded"
                    defaultMessage="Not recorded yet"
                    description="Shown in place of a date when the value was never measured, e.g. a last login that happened before activity tracking existed"
                  />
                )}
            </dd>
          </dl>
          <FormattedMessage
            id="account.privacyPolicyReview"
            defaultMessage="Please review our <legalLink>privacy policy</legalLink> to learn how Suwali uses and stores your information."
            description="Reminder on how users can access the system privacy policy"
            tagName="p"
            values={{
              legalLink: msg => (
                <a key="legalLink" target="_blank" href="https://meedan.org/legal" rel="noopener noreferrer">
                  {msg}
                </a>
              ),
            }}
          />
        </div>
      </details>

      <details className={settingsStyles.detailsSection}>
        <FormattedMessage
          id="global.informationRequests"
          defaultMessage="Information requests"
          description="Generic title for requesting information"
          tagName="summary"
        />
        <div className={settingsStyles.detailsContent}>
          <FormattedMessage
            id="account.informationRequest"
            defaultMessage="To correct, request a deletion, or receive a file with the content and data you have created and generated on Suwali, contact {helpLink}."
            description="Instructions on how users can request information about their account"
            tagName="p"
            values={{
              helpLink: (
                <a key="helpLink" href={`mailto:${SUPPORT_EMAIL}`} rel="noopener noreferrer" title={SUPPORT_EMAIL}>
                  {SUPPORT_EMAIL}
                </a>
              ),
            }}
          />
        </div>
      </details>

      <details className={settingsStyles.detailsSection}>
        <FormattedMessage
          id="global.accountdeleteTitle"
          defaultMessage="Remove your account"
          description="Section title for how to delete your account"
          tagName="summary"
        />
        <div className={settingsStyles.detailsContent}>
          <FormattedMessage
            id="global.accountdeleteInstructions"
            defaultMessage="Please contact {helpLink} to have your account removed."
            description="Instructions on how to delete your account"
            tagName="p"
            values={{
              helpLink: (
                <a key="helpLink" href={`mailto:${SUPPORT_EMAIL}`} rel="noopener noreferrer" title={SUPPORT_EMAIL}>
                  {SUPPORT_EMAIL}
                </a>
              ),
            }}
          />
        </div>
      </details>
    </>
  );
};

export default Account;
