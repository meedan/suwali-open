import { type CountryCode, getCountryCallingCode, parsePhoneNumberFromString } from 'libphonenumber-js';
import { useState } from 'react';
import { defineMessages, FormattedMessage, useIntl } from 'react-intl';
import { useQueryClient } from '@tanstack/react-query';

import { SUPPORT_EMAIL } from '@constants/App';

import { isBsuid } from '@helpers/conversation';
import { guessCountry } from '@helpers/countries';

import { createExternalUser } from '@services/ExternalUsersService';

import { HttpError, sanitizeApiErrors } from '@root/NetworkLayer';
import { useSession } from '@root/SessionContext';

import { useSignalEnabled } from '@hooks/useSignalEnabled';
import { useToast } from '@hooks/useToast';

import Button from '@ui-components/input/Button';
import PhoneInput from '@ui-components/input/PhoneInput';
import { Select, SelectItem } from '@ui-components/input/SelectInput';
import TextInput from '@ui-components/input/TextInput';
import { Modal } from '@ui-components/layout/Modal';

import styles from './AddTrustedEndUserModal.module.css';

const messages = defineMessages({
  addSuccess: {
    id: 'global.addTrustedEndUserModalSuccess',
    defaultMessage: 'Trusted end-user added successfully.',
    description: 'Success toast after adding a new trusted end-user',
  },
  addError: {
    id: 'global.addTrustedEndUserModalError',
    defaultMessage: 'There was an error adding the trusted end-user. Please try again.',
    description: 'Error toast when adding a new trusted end-user fails',
  },
  telegramIdPlaceholder: {
    id: 'addTrustedEndUserModal.telegramIdPlaceholder',
    defaultMessage: 'ID',
    description: 'Placeholder for the Telegram user ID input in the add trusted end-user modal',
  },
});

type AddTrustedEndUserModalProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

const AddTrustedEndUserModal = ({ open, onOpenChange }: AddTrustedEndUserModalProps) => {
  const [platform, setPlatform] = useState('');
  const signalEnabled = useSignalEnabled();
  const [country, setCountry] = useState<CountryCode>(guessCountry());
  const [externalId, setExternalId] = useState('');
  const [isPending, setIsPending] = useState(false);
  const intl = useIntl();
  const hubId = useSession().currentHubId();
  const queryClient = useQueryClient();
  const { toast } = useToast();

  if (!hubId) {
    return null;
  }

  // These platforms need a phone number in E.164 (e.g. "+15551234567"); WhatsApp also accepts a
  // WhatsApp Business-scoped user id ("US.1349120865530274") instead, which already carries its
  // own country prefix, so the picker only applies when the value isn't one of those.
  // For Signal, the backend looks the number up to the user's Signal account.
  const isPhoneOnlyPlatform = platform === 'sms' || platform === 'signal';
  const showsCountryPicker = isPhoneOnlyPlatform || (platform === 'whatsapp' && !isBsuid(externalId.trim()));
  const dialCode = getCountryCallingCode(country);

  const digits = externalId.replace(/[^0-9]/g, '');
  // Submit what this parsed, not the dial code and digits joined: parsing strips national dialling
  // prefixes (the Brazilian trunk "0"), which would otherwise be stored as part of the number.
  const parsedPhone = showsCountryPicker ? parsePhoneNumberFromString(`+${dialCode}${digits}`) : null;
  const isPhoneValid = !showsCountryPicker || Boolean(parsedPhone?.isValid());
  const showsPhoneError = showsCountryPicker && digits.length > 0 && !isPhoneValid;

  const handleOpenChange = (nextOpen: boolean) => {
    if (!nextOpen) {
      setPlatform('');
      setCountry(guessCountry());
      setExternalId('');
    }
    onOpenChange(nextOpen);
  };

  const handleExternalIdChange = (value: string) => {
    setExternalId(isPhoneOnlyPlatform ? value.replace(/\D/g, '') : value);
  };

  const handleSubmit = async () => {
    setIsPending(true);
    try {
      let normalizedExternalId = externalId.trim();
      if (showsCountryPicker && parsedPhone) {
        // SMS and Signal numbers are E.164 (leading "+"); WhatsApp never sends one, and expects
        // its numbers without it.
        normalizedExternalId = isPhoneOnlyPlatform ? parsedPhone.number : parsedPhone.number.slice(1);
      }

      await createExternalUser(hubId, { platform, external_id: normalizedExternalId });
      await queryClient.invalidateQueries({ queryKey: [`/hubs/${hubId}/external-users?trusted=true`] });
      handleOpenChange(false);
      toast('success', intl.formatMessage(messages.addSuccess));
    } catch (error) {
      // The API explains failures worth showing, such as a Signal number with no Signal account
      const message = error instanceof HttpError ? sanitizeApiErrors(error.data) : null;
      toast('error', message || intl.formatMessage(messages.addError));
    } finally {
      setIsPending(false);
    }
  };

  const externalIdFieldByPlatform: Record<string, { label: React.ReactNode; placeholder: string; helpContent: React.ReactNode }> = {
    whatsapp: {
      label: (
        <FormattedMessage
          id="global.addTrustedEndUserModalWhatsappLabel"
          defaultMessage="End-user’s WhatsApp number or ID"
          description="Label for the WhatsApp phone number or BSUID input in the add trusted end-user modal"
        />
      ),
      placeholder: '5550000000',
      helpContent: (
        <FormattedMessage
          id="global.addTrustedEndUserModalWhatsappHelp"
          defaultMessage="Enter the end-user’s phone number, or their WhatsApp Business-scoped user ID."
          description="Help text for the WhatsApp phone number or BSUID input in the add trusted end-user modal"
        />
      ),
    },
    sms: {
      label: (
        <FormattedMessage
          id="global.addTrustedEndUserModalSmsLabel"
          defaultMessage="End-user’s phone number"
          description="Label for the phone number input in the add trusted end-user modal"
        />
      ),
      placeholder: '5550000000',
      helpContent: (
        <FormattedMessage
          id="global.addTrustedEndUserModalSmsHelp"
          defaultMessage="Enter the end-user’s phone number."
          description="Help text for the phone number input in the add trusted end-user modal"
        />
      ),
    },
    signal: {
      label: (
        <FormattedMessage
          id="global.addTrustedEndUserModalSignalLabel"
          defaultMessage="End-user’s Signal phone number"
          description="Label for the Signal phone number input in the add trusted end-user modal"
        />
      ),
      placeholder: '5550000000',
      helpContent: (
        <FormattedMessage
          id="global.addTrustedEndUserModalSignalHelp"
          defaultMessage="Enter the phone number of the end-user’s Signal account. We’ll find their account by number, which works unless they’ve turned off being found by phone number in Signal’s privacy settings."
          description="Help text for the Signal phone number input in the add trusted end-user modal"
        />
      ),
    },
    telegram: {
      label: (
        <FormattedMessage
          id="global.addTrustedEndUserModalTelegramLabel"
          defaultMessage="Telegram User ID"
          description="Label for the Telegram user ID input in the add trusted end-user modal"
        />
      ),
      placeholder: intl.formatMessage(messages.telegramIdPlaceholder),
      helpContent: (
        <FormattedMessage
          id="global.addTrustedEndUserModalTelegramHelp"
          defaultMessage="You must include the Telegram User ID even if the end-user has a username set up. You may be able to retrieve this by contacting {telegramBot} on Telegram. {contactSupport} for more information."
          description="Help text for the Telegram user ID input in the add trusted end-user modal"
          values={{
            telegramBot: (
              <a href="https://t.me/userinfobot" rel="noopener noreferrer" key="telegram" target="_blank">
                @userinfobot
              </a>
            ),
            contactSupport: (
              <a href={`mailto:${SUPPORT_EMAIL}`} rel="noopener noreferrer" key="support">
                <FormattedMessage
                  id="global.contactSupport"
                  defaultMessage="Contact support"
                  description="Reusable label for a link to contact support"
                />
              </a>
            ),
          }}
        />
      ),
    },
  };

  const externalIdField = externalIdFieldByPlatform[platform];

  return (
    <Modal
      open={open}
      onOpenChange={handleOpenChange}
      size="medium"
      title={
        <FormattedMessage
          id="global.addTrustedEndUserModalTitle"
          defaultMessage="Add trusted end-user status?"
          description="Title for the modal to add a trusted end-user"
        />
      }
      body={
        <div className={styles.body}>
          <FormattedMessage
            id="global.contributionsDescription"
            defaultMessage="Trusted end-users from your audience can submit tips, field notes, and knowledge directly into your data sources."
            description="Description for the contributions settings panel"
            tagName="p"
          />
          <FormattedMessage
            id="global.addTrustedEndUserModalDescription"
            defaultMessage="Add their contact information for the messaging platform they will use below."
            description="Secondary description in the add trusted end-user modal"
            tagName="p"
          />
          <Select
            label={
              <FormattedMessage
                id="global.addTrustedEndUserModalPlatformLabel"
                defaultMessage="Messaging platform"
                description="Label for the platform select in the add trusted end-user modal"
              />
            }
            placeholder={
              <FormattedMessage
                id="addTrustedEndUserModal.selectAPlatform"
                defaultMessage="Select a messaging platform"
                description="Description for an input placeholder for choosing which messaging platform to configure"
              />
            }
            value={platform}
            onValueChange={setPlatform}
            size="large"
          >
            <SelectItem value="whatsapp" key="whatsapp">WhatsApp</SelectItem>
            <SelectItem value="telegram" key="telegram">Telegram</SelectItem>
            <SelectItem value="sms" key="sms">SMS</SelectItem>
            {signalEnabled && <SelectItem value="signal" key="signal">Signal</SelectItem>}
          </Select>
          {(platform === 'whatsapp' || isPhoneOnlyPlatform) && (
            <PhoneInput
              label={externalIdField.label}
              placeholder={externalIdField.placeholder}
              helpContent={externalIdField.helpContent}
              error={showsPhoneError && (
                <FormattedMessage
                  id="global.addTrustedEndUserModalInvalidPhone"
                  defaultMessage="This does not look like a valid phone number."
                  description="Error shown when the phone number entered for a trusted end-user is not a plausible number"
                />
              )}
              country={country}
              onCountryChange={setCountry}
              hideCountry={!showsCountryPicker}
              value={externalId}
              onChange={handleExternalIdChange}
              inputProps={isPhoneOnlyPlatform ? { inputMode: 'numeric' } : undefined}
            />
          )}
          {platform === 'telegram' && (
            <TextInput
              label={externalIdField.label}
              placeholder={externalIdField.placeholder}
              helpContent={externalIdField.helpContent}
              value={externalId}
              onChange={(e) => handleExternalIdChange(e.target.value)}
              size="large"
            />
          )}
        </div>
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
            onClick={() => handleOpenChange(false)}
          />
          <Button
            label={
              <FormattedMessage
                id="global.addTrustedEndUserModalConfirm"
                defaultMessage="Add trusted status"
                description="Confirm button label in the add trusted end-user modal"
              />
            }
            size="small"
            disabled={!platform || !externalId.trim() || !isPhoneValid || isPending}
            onClick={handleSubmit}
          />
        </>
      }
    />
  );
};

export default AddTrustedEndUserModal;
