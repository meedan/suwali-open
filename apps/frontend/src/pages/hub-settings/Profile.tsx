import { useEffect, useRef, useState } from 'react';
import { defineMessages, FormattedMessage, useIntl } from 'react-intl';
import { useQuery, useQueryClient } from '@tanstack/react-query';

import type { Hub } from '@customTypes/hub';

import { fetchHub, updateProfile } from '@services/HubService';

import { useSession } from '@root/SessionContext';

import { useToast } from '@hooks/useToast';

import Button from '@ui-components/input/Button';
import TextInput from '@ui-components/input/TextInput';
import Avatar from "@ui-components/layout/Avatar";

import settingsStyles from '@pages/Settings.module.css';

const messages = defineMessages({
  namePlaceholder: {
    id: 'hubProfile.namePlaceholder',
    defaultMessage: 'Organization name',
    description: 'Placeholder text for input where user adds the name of this organization',
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
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const { toast } = useToast();

  const hubId = useSession().currentHubId();

  const { data, isPending } = useQuery({
    queryKey: [`/hubs/${hubId}`],
    queryFn: () => fetchHub(hubId!),
    enabled: Boolean(hubId),
    throwOnError: true,
  });

  const queryClient = useQueryClient();
  const refetch = () => queryClient.refetchQueries({ queryKey: [`/hubs/${hubId}`]});

  const hub = data || {} as Hub;

  useEffect(() => {
    if (hub?.name) setName(hub.name);
  }, [hub?.name]);

  // Generate preview when a file is selected
  useEffect(() => {
    if (!selectedFile) {
      setPreviewUrl(null);
      return;
    }
    const objectUrl = URL.createObjectURL(selectedFile);
    setPreviewUrl(objectUrl);
    return () => URL.revokeObjectURL(objectUrl);
  }, [selectedFile]);

  if (isPending) return null;

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      setSelectedFile(e.target.files[0]);
    }
  };

  const handleReplacePhotoClick = () => {
    fileInputRef.current?.click();
  };

  const onSuccess = () => {
    toast('success', intl.formatMessage(messages.updateSuccess));
    setSelectedFile(null);
    refetch();
  };
  const onError = (error: Error) => {
    toast('error', intl.formatMessage(messages.updateError));
    console.error('Error updating profile', error);
  };

  return (
    <>
      <fieldset className="form-sections">
        <TextInput
          id="hubName"
          value={name}
          error={!name &&
            <FormattedMessage
              id="global.hubProfilenameError"
              defaultMessage="Please provide the name you would like for your organization."
              description="Error text if the user fails to enter their full name"
            />
          }
          helpContent={
            <FormattedMessage
              id="global.hubProfilenameHelp"
              defaultMessage="Your organization name may appear around the interface."
              description="Context description of how the organization name will be used in the interface"
            />
          }
          label={
            <FormattedMessage
              id="global.hubProfilenameLabel"
              defaultMessage="Organization name"
              description="Input label for organization name input"
            />
          }
          placeholder={intl.formatMessage(messages.namePlaceholder)}
          required
          type="text"
          size="large"
          onChange={(e) => setName(e.target.value)}
        />
        <section className={settingsStyles.updatePhoto}>
          <FormattedMessage
            id="global.hubProfileiconTitle"
            defaultMessage="Organization icon"
            description="Title for area of setting where a user can change the avatar icon"
            tagName="h3"
          />
          <div className={settingsStyles.updatePhotoContent}>
            <Avatar
              className={settingsStyles.profilePhoto}
              picture={previewUrl || hub?.profile_picture_url}
              name={hub?.name}
              fallback={hub?.name.substring(0, 1)}
            />
            <div>
              <FormattedMessage
                id="global.hubProfileiconDescription"
                defaultMessage="An icon helps people recognize your organization, a logo is often the best choice."
                description="Descriptions of what the organization icon will be used for"
                tagName="p"
              />
              <br />
              <Button
                label={
                  <FormattedMessage
                    id="global.hubProfileiconReplace"
                    defaultMessage="Replace icon"
                    description="Button label for replacing the organization icon"
                  />
                }
                size="small"
                themeMode
                onClick={handleReplacePhotoClick}
              />
              <input
                type="file"
                accept="image/*"
                ref={fileInputRef}
                style={{ display: 'none' }}
                onChange={handleFileChange}
              />
            </div>
          </div>
        </section>
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
              await updateProfile({ hubId: hubId!, name, file: selectedFile });
              onSuccess();
            } catch (error) {
              onError(error as Error);
            }
          }}
        />
      </div>
    </>
  );
};

export default Profile;
