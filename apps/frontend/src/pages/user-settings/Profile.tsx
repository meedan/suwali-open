import { useEffect, useState } from 'react';
import { defineMessages, FormattedMessage, useIntl } from 'react-intl';
import { useQuery } from '@tanstack/react-query';

import { getUserFallback } from '@helpers/user';

import { fetchMe, updateProfile } from '@services/ProfileService';

import { useSession } from '@root/SessionContext';

import { usePhotoUploader } from '@hooks/usePhotoUploader';
import { useToast } from '@hooks/useToast';

import Button from '@ui-components/input/Button';
import TextInput from '@ui-components/input/TextInput';

import ProfilePhotoUploader from '@components/ProfilePhotoUploader';

import settingsStyles from '@pages/Settings.module.css';

const messages = defineMessages({
  namePlaceholder: {
    id: 'global.namePlaceholder',
    defaultMessage: 'Your full name',
    description: 'Placeholder or label text for input where user adds their full name for their profile',
  },
  emailPlaceholder: {
    id: 'global.emailPlaceholder',
    defaultMessage: 'Your email address',
    description: 'Placeholder for email address field'
  },
  updateSuccess: {
    id: 'global.profileupdateSuccess',
    defaultMessage: 'Profile updated successfully.',
    description: 'Success message shown to user when they successfully update their profile',
  },
  updateError: {
    id: 'global.profileupdateError',
    defaultMessage: 'There was an error updating your profile. Please try again.',
    description: 'Error message shown to user when there is a problem updating their profile',
  },
});

const Profile = () => {
  const intl = useIntl();
  const [name, setName] = useState('');
  const { toast } = useToast();

  const {
    selectedFile,
    previewUrl,
    fileInputRef,
    handleFileChange,
    handleReplacePhotoClick,
    resetPhoto
  } = usePhotoUploader();

  const { data: user } = useQuery({
    queryKey: ['/me'],
    queryFn: fetchMe,
    throwOnError: true,
  });

  const session = useSession();

  useEffect(() => {
    if (user?.name) setName(user.name);
  }, [user?.name]);

  return (
    <>
      <fieldset className="form-sections">
        <ProfilePhotoUploader
          pictureUrl={user?.profile_picture_url}
          name={user?.name}
          fallbackText={getUserFallback(user?.name, user?.email)}
          previewUrl={previewUrl}
          fileInputRef={fileInputRef}
          handleFileChange={handleFileChange}
          handleReplacePhotoClick={handleReplacePhotoClick}
          type="profile"
        />

        <TextInput
          id="fullName"
          value={name}
          error={!name &&
            <FormattedMessage
              id="global.profilenameError"
              defaultMessage="Please provide the name you would like to be identified as around the interface."
              description="Error text if the user fails to enter their full name"
            />
          }
          helpContent={
            <FormattedMessage
              id="global.profilenameHelp"
              defaultMessage="Your name may appear around the interface where you are mentioned or contribute."
              description="Context description of how the user full name will be used in the interface"
            />
          }
          label={
            <FormattedMessage
              id="global.profilenameLabel"
              defaultMessage="Full name"
              description="Input label for user entering their full name"
            />
          }
          placeholder={intl.formatMessage(messages.namePlaceholder)}
          required
          type="text"
          size="large"
          onChange={(e) => setName(e.target.value)}
        />
        <TextInput
          disabled
          helpContent={
            <FormattedMessage
              id="profile.emailContactUs"
              defaultMessage="If you would like to change your email address, contact your system administrator."
              description="Context description of how the user can change their email address"
            />
          }
          id="emailAddress"
          label={
            <FormattedMessage
              id="global.emailAddressInputLabel"
              defaultMessage="Email address"
              description="Text input label for email address field"
            />
          }
          placeholder={intl.formatMessage(messages.emailPlaceholder)}
          required
          size="large"
          type="text"
          value={user?.email ?? ''}
        />
      </fieldset>
      <div className={settingsStyles.buttonWrapper}>
        <Button
          label={
            <FormattedMessage
              id="global.updateProfile"
              defaultMessage="Update profile"
              description="Button label for saving changes to the user or system profile"
            />
          }
          size="medium"
          onClick={async () => {
            try {
              await updateProfile({ name, file: selectedFile });
              await session.refreshUser();
              resetPhoto();
              toast('success', intl.formatMessage(messages.updateSuccess));
            } catch (error) {
              console.error('Error updating profile', error);
              toast('error', intl.formatMessage(messages.updateError));
            }
          }}
        />
      </div>
    </>
  );
};

export default Profile;
