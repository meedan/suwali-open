import clsx from 'clsx';
import { useEffect, useState } from 'react';
import { defineMessages, FormattedMessage, useIntl } from "react-intl";
import { useNavigate } from 'react-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';

import type { Source } from '@customTypes/source';

import { getCurrentSetupStep } from '@helpers/hub';
import { getUserFallback } from "@helpers/user";

import { updateProfile } from "@services/ProfileService";
import { fetchSources } from '@services/SourcesService';

import { useSession } from "@root/SessionContext";

import { useHubPath } from '@hooks/useHubPath';
import { useHubSetupTasks } from '@hooks/useHubSetupTasks';
import { useLogout } from "@hooks/useLogout";
import { usePhotoUploader } from "@hooks/usePhotoUploader";
import { useStartConversation } from '@hooks/useStartConversation';

import Button from '@ui-components/input/Button';
import ConversationInput from '@ui-components/input/ConversationInput';
import TextInput from '@ui-components/input/TextInput';
import FormErrorSummary from '@ui-components/layout/FormErrorSummary';
import HintBox from '@ui-components/layout/HintBox';
import Icon from '@ui-components/layout/Icon';
import { PollingLoading } from '@ui-components/layout/LoadingIndicator';
import { Modal } from '@ui-components/layout/Modal';

import { Can } from '@components/Can';
import BookDemoHelp from '@components/hub-onboarding/BookDemoHelp';
import OnboardingCardHeader from '@components/hub-onboarding/OnboardingCardHeader';
import { CurrentStep, DoneStep, FutureStep } from '@components/hub-onboarding/OnboardingSteps';

import styles from './OnboardingModal.module.css';
import ProfilePhotoUploader from './ProfilePhotoUploader';

const messages = defineMessages({
  namePlaceholder: {
    id: "global.namePlaceholder",
    defaultMessage: 'Your full name',
    description: 'Placeholder or label text for input where user adds their full name for their profile',
  },
  nameRequired: {
    id: "global.profilenameError",
    defaultMessage: "Please provide the name you would like to be identified as around the interface.",
    description: "Error text if the user fails to enter their full name",
  },
  nameFieldError: {
    id: 'global.nameFieldError',
    defaultMessage: 'Please provide your full name.',
    description: 'Error message shown when there is a problem with the name field'
  },
});

type ProfileSetupFormProps = {
  onSuccess: () => void;
};

const ProfileSetupForm = ({ onSuccess }: ProfileSetupFormProps) => {
  const intl = useIntl();
  const session = useSession();

  const [name, setName] = useState(session.user?.name ?? "");
  const [fieldError, setFieldError] = useState<string | null>(null);
  const [serverError, setServerError] = useState<string | null>(null);
  const [isSubmitted, setIsSubmitted] = useState(false);
  const [saving, setSaving] = useState(false);

  const {
    selectedFile,
    previewUrl,
    fileInputRef,
    handleFileChange,
    handleReplacePhotoClick
  } = usePhotoUploader();

  useEffect(() => {
    if (session.user?.name) {
      setName(session.user.name);
    }
  }, [session.user?.name]);

  const handleSubmit = () => {
    setIsSubmitted(true);
    setServerError(null);
    if (!name.trim()) {
      setFieldError(intl.formatMessage(messages.nameFieldError));
      return;
    }
    setSaving(true);
    try {
      updateProfile({
        name: name.trim(),
        file: selectedFile,
      });
      session.refreshUser();
      onSuccess();
    } catch (error) {
      console.error('Error updating profile', error);
      setServerError(error instanceof Error ? error.message : String(error));
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <fieldset className="form-sections">
        <div className={styles.formSection}>
          <TextInput
            id="fullName"
            value={name}
            error={!name && isSubmitted && intl.formatMessage(messages.nameRequired)}
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
            size="large"
            type="text"
            onChange={(e) => setName(e.target.value)}
          />
        </div>
        <ProfilePhotoUploader
          pictureUrl={session.user?.profile_picture_url}
          name={session.user?.name}
          fallbackText={getUserFallback(name, session.user?.email)}
          previewUrl={previewUrl}
          fileInputRef={fileInputRef}
          handleFileChange={handleFileChange}
          handleReplacePhotoClick={handleReplacePhotoClick}
          type="profile"
        />
        <FormErrorSummary
          errors={[fieldError, serverError].filter(Boolean) as string[]}
        />
      </fieldset>
      <div className={styles.buttonWrapper}>
        <Button
          label={
            <FormattedMessage
              id="global.continue"
              defaultMessage="Continue"
              description="Primary action button label to continue after completing form data"
            />
          }
          disabled={saving}
          onClick={handleSubmit}
        />
      </div>
    </>
  );
};

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

const OnboardingModal = ({ open, onOpenChange }: Props) => {
  const session = useSession();
  const handleLogout = useLogout();
  const queryClient = useQueryClient();
  const hubId = session.currentHubId();
  const hubPath = useHubPath();
  const [step, setStep] = useState<1 | 2>(session.user?.name ? 2 : 1);

  const navigate = useNavigate();
  const { handleSubmit: handleConversationSubmit, isSubmitting } = useStartConversation({
    onSuccess: async (conversationId) => {
      await queryClient.invalidateQueries({ queryKey: ['/me'] });
      onOpenChange(false);
      navigate(hubPath(`/conversations/me/${conversationId}`));
    },
  });

  // This modal is mounted for every logged-in user, so it only polls while it is actually visible.
  // Preloaded content is ignored here: this is a call to action for the hub's own content.
  const { ownSourceCreated, ownDocumentSynced, internalConversationMessageReceived } = useHubSetupTasks({ poll: open });
  const hubSetupComplete = ownSourceCreated && ownDocumentSynced && internalConversationMessageReceived;
  const currentStep = getCurrentSetupStep(true, ownSourceCreated, ownDocumentSynced);

  const { data: sources = [] } = useQuery<Source[]>({
    queryKey: [`/hubs/${hubId}/sources`],
    queryFn: () => fetchSources(hubId!),
    enabled: Boolean(hubId),
  });

  useEffect(() => {
    if (open) {
      setStep(session.user?.name ? 2 : 1);
    }
  }, [open, session.user?.name]);

  return (
    <>
      <Modal
        alert
        size="large"
        open={open}
        onOpenChange={onOpenChange}
        description={
          <FormattedMessage
            id="global.userOnboardingTitleDescription"
            defaultMessage="User onboarding completion steps"
            description="Accessible title for the user onboarding dialog steps"
          />
        }
        body={
          <div className={styles.onboardingModalWrapper}>
            <OnboardingCardHeader
              className={styles.onboardingModalHeader}
              title={
                <FormattedMessage
                  id="global.userOnboardingTitle"
                  defaultMessage="You are almost ready to join your team"
                  description="Title for the non-admin onboarding card shown when the user needs to set up their profile"
                />
              }
              subtitle={
                <FormattedMessage
                  id="global.setupOnboardingSubtitle"
                  defaultMessage="After step 2, you’ll have seen it in action and unlocked the full app."
                  description="Subtitle for the non-admin onboarding card explaining the payoff of completing setup"
                />
              }
            >
              <BookDemoHelp />
            </OnboardingCardHeader>
            {step === 1 ? (
              <>
                <CurrentStep className={styles.currentOnboardingStep}
                  step="1"
                  label={
                    <FormattedMessage
                      id="userOnboarding.step1Title"
                      defaultMessage="Set up your profile"
                      description="Title for step 1 of the non-admin setup wizard"
                    />
                  }
                >
                  <ProfileSetupForm onSuccess={() => setStep(2)} />
                </CurrentStep>
                <FutureStep step="2" label={<FormattedMessage id="global.setupOnboardingAskQuestion" defaultMessage="Ask your chatbot a question" description="Title for setup and onboarding of the hub setup about starting a conversation with the chatbot" />} />
              </>
            ) : !hubSetupComplete ? (
              <>
                <DoneStep label={<FormattedMessage id="userOnboarding.step1Label" defaultMessage="Your profile basics" description="Label for the completed profile step in the non-admin setup" />} />
                <CurrentStep
                  className={styles.currentOnboardingStep}
                  label={
                    <FormattedMessage
                      id="userOnboarding.pendingTitle"
                      defaultMessage="Your workspace is being set up"
                      description="Title shown to non-admin users while the admin completes hub setup"
                    />
                  }
                >
                  {currentStep === 2 ? (
                    <>
                      <FormattedMessage
                        id="userOnboarding.pendingDescription"
                        defaultMessage="An admin is adding content to your chatbot. Once it’s ready, you’ll be able to test it and get access to the full app."
                        description="Description shown to non-admin users while the admin completes hub setup"
                        tagName="p"
                      />
                      {ownSourceCreated && !ownDocumentSynced && (
                        <FormattedMessage
                          id="global.setupOnboardingSyncing"
                          defaultMessage="{icon} We’re processing your data sources. This usually takes a few minutes before the first piece of content is ready and you are able to start a conversation with your chatbot."
                          description="Description shown to users in the setup and onboarding process while data sources are being synced"
                          tagName="p"
                          values={{
                            icon: <PollingLoading key="icon" />,
                          }}
                        />
                      )}
                    </>
                  ) : (
                    <FormattedMessage
                      id="userOnboarding.pendingInternalConversationDescription"
                      defaultMessage="Your admin is almost done, they’re just testing the chatbot before it’s ready for you."
                      description="Description shown to non-admin users while the admin completes hub setup by asking a question to the bot"
                      tagName="p"
                    />
                  )}
                </CurrentStep>
                <FutureStep step="2" label={<FormattedMessage id="global.setupOnboardingAskQuestion" defaultMessage="Ask your chatbot a question" description="Title for setup and onboarding of the hub setup about starting a conversation with the chatbot" />} />
              </>
            ) : (
              <>
                <DoneStep label={<FormattedMessage id="userOnboarding.step1Label" defaultMessage="Your profile basics" description="Label for the completed profile step in the non-admin setup" />} />
                <CurrentStep
                  className={clsx(styles.currentOnboardingStep, styles.firstInternalConversationMessage)}
                  step="2"
                  label={
                    <FormattedMessage
                      id="global.setupOnboardingAskQuestion"
                      defaultMessage="Ask your chatbot a question"
                      description="Title for setup and onboarding of the hub setup about starting a conversation with the chatbot"
                    />
                  }
                >
                  <FormattedMessage
                    id="userOnboarding.step2Description"
                    defaultMessage="Ask a straightforward question about the content your team added, a question that your audience might ask. The content comes from the sources below:"
                    description="Prompt for non-admin users to start a test conversation with the chatbot"
                    tagName="p"
                  />
                  {sources.length > 0 && (
                    <ul className={styles.sourceList}>
                      {sources.map((source) => (
                        <li key={source.id}>
                          <strong>
                            { source.external_url ?
                              <a href={source.external_url} title={source.name} target="_blank" rel="noopener noreferrer">{source.name}</a>
                              :
                              source.name
                            }
                          </strong>
                        </li>
                      ))}
                    </ul>
                  )}
                  <HintBox
                    className={styles.firstInternalConversationHint}
                    type="info"
                    body={
                      <>
                        <FormattedMessage
                          id="global.setupInternalConversationDescription"
                          defaultMessage="This conversation is <strong>just for you</strong> and your team and won’t reach your audience."
                          description="Introduces the term ‘internal conversation’ and reassures the user this is a private, safe space to test"
                          tagName="span"
                          values={{
                            strong: msg => <strong key="strong">{msg}</strong>,
                          }}
                        />
                        <FormattedMessage
                          id="global.setupInternalConversationDescriptionContinued"
                          defaultMessage="Try asking: <strong>How is Suwali different from other chatbots?</strong>"
                          description="Introduces the term ‘internal conversation’ and reassures the user this is a private, safe space to test"
                          tagName="span"
                          values={{
                            strong: msg => <strong key="strong">{msg}</strong>,
                          }}
                        />
                      </>
                    }
                  />
                  <Can action="CREATE_MESSAGE">
                    <ConversationInput focusOnMount canSubmit={!isSubmitting} onSubmit={handleConversationSubmit} submitLabel={<FormattedMessage id="global.sendMessage" defaultMessage="Send message" description="Button label for sending a message to a conversation" />} />
                  </Can>
                </CurrentStep>
              </>
            )}
            <footer className={styles.modalFooter}>
              <Button
                iconLeft={<Icon id="sign_out" aria-hidden />}
                label={
                  <FormattedMessage
                    id="global.accountlogoutButton"
                    defaultMessage="Sign out"
                    description="Button label that allows the user to log out of the system"
                  />
                }
                size="small"
                onClick={handleLogout}
                themeMode
              />
            </footer>
          </div>
        }
      />
    </>
  );
}

export default OnboardingModal;
