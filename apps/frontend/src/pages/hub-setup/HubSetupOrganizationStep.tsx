import { useState } from 'react';
import { defineMessages, FormattedDate, FormattedMessage, useIntl } from 'react-intl';
import { useLocation, useNavigate } from 'react-router';
import { useQuery } from '@tanstack/react-query';

import { fetchAbout } from '@services/AboutService';
import { createHub } from '@services/HubService';

import { useSession } from '@root/SessionContext';

import { usePhotoUploader } from '@hooks/usePhotoUploader';
import { useToast } from '@hooks/useToast';

import Button from '@ui-components/input/Button';
import TextInput from '@ui-components/input/TextInput';
import HintBox from '@ui-components/layout/HintBox';
import Icon from '@ui-components/layout/Icon';

import ProfilePhotoUploader from '@components/ProfilePhotoUploader';

import styles from './HubSetup.module.css';

const messages = defineMessages({
  orgNamePlaceholder: {
    id: 'hubOnboarding.orgNamePlaceholder',
    defaultMessage: 'Organization name',
    description: 'Placeholder text for input where user adds their organization name during onboarding flow',
  },
  somethingWentWrong: {
    id: 'global.somethingWentWrong',
    defaultMessage: 'Something went wrong. Please try again.',
    description: 'Error toast message shown when the request fails',
  },
});

const HubSetupOrganizationStep = () => {
  const intl = useIntl();
  const session = useSession();
  const navigate = useNavigate();
  const canGoBack = useLocation().state?.canGoBack || false;
  const { toast } = useToast();

  const [orgName, setOrgName] = useState('');
  const [isSubmitted, setIsSubmitted] = useState(false);
  const [saving, setSaving] = useState(false);

  const {
    selectedFile: orgIconFile,
    previewUrl: orgPreviewUrl,
    fileInputRef: orgFileInputRef,
    handleFileChange: handleOrgFileChange,
    handleReplacePhotoClick: handleReplaceOrgPhotoClick,
  } = usePhotoUploader(null);

  const { data: about } = useQuery({
    queryKey: ['/about'],
    queryFn: fetchAbout,
  });

  const userEmail = session.user?.email;
  const domain = userEmail?.split('@')[1] || '';
  const isCorporate = !session.user?.is_public_email_domain;
  const orgInitialFallback = domain.charAt(0).toUpperCase();

  const trialLength = about?.hub_trial_length_days;
  const trialEndDate = new Date();
  if (trialLength) trialEndDate.setDate(trialEndDate.getDate() + trialLength);

  const handleComplete = async () => {
    setIsSubmitted(true);
    if (!orgName.trim()) return;

    try {
      setSaving(true);
      await createHub({ name: orgName.trim(), file: orgIconFile });
      await session.refreshUser();
    } catch {
      toast('error', intl.formatMessage(messages.somethingWentWrong));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className={styles.organizationStep}>
      <FormattedMessage
        id="hubOnboarding.orgNameHelp"
        defaultMessage="Set your organization’s name and optional icon, so it’s easily recognized by team members."
        description="Context description of how the organization name will be used in the interface"
        tagName="p"
      />
      <div className={styles.orgFields}>
        <TextInput
          id="org-name"
          label={
            <FormattedMessage
              id="hubOnboarding.organizationLabel"
              defaultMessage="Your organization’s name"
              description="Label for the organization name input field in the hub onboarding flow"
            />
          }
          placeholder={intl.formatMessage(messages.orgNamePlaceholder)}
          value={orgName}
          required
          size="large"
          error={
            !orgName.trim() && isSubmitted && (
              <FormattedMessage
                id="hubOnboarding.orgNameError"
                defaultMessage="Please provide an organization name."
                description="Error message shown when user tries to proceed in onboarding flow without entering an organization name"
              />
            )
          }
          onChange={(e) => setOrgName(e.target.value)}
        />
        <ProfilePhotoUploader
          variant="compact"
          type="organization"
          pictureUrl={undefined}
          name={orgName}
          fallbackText={orgName.trim() ? orgName.trim().charAt(0).toUpperCase() : orgInitialFallback}
          previewUrl={orgPreviewUrl}
          fileInputRef={orgFileInputRef}
          handleFileChange={handleOrgFileChange}
          handleReplacePhotoClick={handleReplaceOrgPhotoClick}
        />
      </div>
      {trialLength != null && (
        <HintBox
          type={orgName.trim() ? 'success' : 'info' }
          body={
            <>
              <FormattedMessage
                id="hubSetup.trialInfo"
                defaultMessage="Your {days}-day free trial ends {date}."
                description="Hint shown during organization creation summarizing the free trial length and end date"
                tagName="p"
                values={{
                  days: trialLength,
                  date: (
                    <time key="date" dateTime={trialEndDate.toISOString()}>
                      <strong><FormattedDate value={trialEndDate} month="long" day="numeric" year="numeric" /></strong>
                    </time>
                  ),
                }}
              />
              {isCorporate && orgName.trim() && (
                <FormattedMessage
                  id="hubOnboarding.corporateTip"
                  defaultMessage="Tip: You can invite team members to join you on Suwali by having them create an account with their {domain} email address and choose to join {name}."
                  description="Tip for corporate users explaining how teammates can join using the same domain"
                  tagName="p"
                  values={{
                    domain: <strong key="domain" className={styles.domainReference}>…@{domain}</strong>,
                    name: <strong key="strong">{orgName.trim()}</strong>,
                  }}
                />
              )}
            </>
          }
        />
      )}
      <footer className={styles.organizationStepFooter}>
        {canGoBack && (
          <Button
            iconLeft={<Icon id="chevron_left" />}
            label={
              <FormattedMessage
                id="onboarding.back"
                defaultMessage="Back to list of organizations"
                description="Button label for going back to the previous step in a wizard"
              />
            }
            size="small"
            themeMode
            variant="text"
            onClick={() => navigate('/hub/join')}
          />
        )}
        <div className={styles.organizationStepFooterActions}>
          <Button
            iconRight={<Icon id="chevron_right" />}
            variant="filled"
            label={
              <FormattedMessage
                id="hubSetup.createOrganizationCta"
                defaultMessage="Create organization"
                description="Button label for creating the organization on the organization-creation step of hub setup"
              />
            }
            size="small"
            onClick={handleComplete}
            disabled={saving}
          />
        </div>
      </footer>
    </div>
  );
};

export default HubSetupOrganizationStep;
