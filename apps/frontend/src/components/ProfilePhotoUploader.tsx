import clsx from 'clsx';
import React from 'react';
import { FormattedMessage } from "react-intl";

import Button from "@ui-components/input/Button";
import Avatar from "@ui-components/layout/Avatar";
import Icon from '@ui-components/layout/Icon';
import Tooltip from '@ui-components/layout/Tooltip';

import styles from "./ProfilePhotoUploader.module.css";

type ProfilePhotoUploaderProps = {
  className?: string;
  pictureUrl: string | null | undefined;
  name: string | undefined;
  fallbackText: string | undefined;
  previewUrl: string | null;
  fileInputRef: React.RefObject<HTMLInputElement | null>;
  handleFileChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
  handleReplacePhotoClick: () => void;
  type: 'profile' | 'organization';
  variant?: 'full' | 'compact';
};

export default function ProfilePhotoUploader({
    className,
    pictureUrl,
    name,
    fallbackText,
    previewUrl,
    fileInputRef,
    handleFileChange,
    handleReplacePhotoClick,
    type = 'profile',
    variant = 'full',
}: ProfilePhotoUploaderProps) {
    
  return (
    <section
      className={clsx(
        styles.updatePhoto,
        className,
        {
          [styles.compact]: variant === 'compact'
        },
      )}
    >
      {variant === 'full' && (type === 'profile' ? (
        <FormattedMessage
          id="global.profilephotoTitle"
          defaultMessage="Profile photo"
          description="Title for area of setting where a user can change their avatar photo"
          tagName="h3"
        />
      ) : (
        <FormattedMessage
          id="hubOnboarding.organizationIconTitle"
          defaultMessage="Organization icon"
          description="Title for area of setting where a user can change the organization icon"
          tagName="h3"
        />
      ))}
      <div className={styles.updatePhotoContent}>
        <Avatar
          className={styles.profilePhoto}
          picture={previewUrl || pictureUrl}
          name={name}
          fallback={fallbackText}
        />
        <div className={styles.updatePhotoContentDetails}>
          {variant === 'full' && (type === 'profile' ? (
            <FormattedMessage
              id="global.profilephotoDescription"
              defaultMessage="An optional profile picture helps people recognize you and lets you know when you’re signed in to your account."
              description="Descriptions of what the user picture will be used for"
              tagName="p"
            />
          ) : (
            <FormattedMessage
              id="global.hubProfileiconDescription"
              defaultMessage="An icon helps people recognize your organization, a logo is often the best choice."
              description="Descriptions of what the organization icon will be used for"
              tagName="p"
            />
          ))}
          <Tooltip
            content={
              type === 'profile' ? (
                <FormattedMessage
                  id="global.profilephotoTooltipDescription"
                  defaultMessage="Update your optional profile image"
                  description="Tooltip descriptions of what the user picture will be used for"
                  tagName="p"
                />
              ) : (
                <FormattedMessage
                  id="global.hubProfileiconTooltipDescription"
                  defaultMessage="An optional icon helps people recognize your organization, a logo is often the best choice."
                  description="Tooltip descriptions of what the organization icon will be used for"
                  tagName="p"
                />
              )
            }
          >
            <Button
              label={variant === 'full' &&
                <FormattedMessage
                  id="global.profilephotoReplace"
                  defaultMessage="Replace image"
                  description="Button label for replacing the user photo"
                />
              }
              iconLeft={variant === 'compact' && <Icon id="camera" aria-hidden />}
              size={variant === 'full' ? 'small' : 'large'}
              themeMode
              onClick={handleReplacePhotoClick}
            />
          </Tooltip>
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            style={{ display: "none" }}
            onChange={handleFileChange}
          />
        </div>
      </div>
    </section>
  );
}
