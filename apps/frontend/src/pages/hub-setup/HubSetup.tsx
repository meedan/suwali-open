import { FormattedMessage } from 'react-intl';
import { useNavigate } from 'react-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';

import type { Source } from '@customTypes/source';

import { getCurrentSetupStep } from '@helpers/hub';

import { fetchSources } from '@services/SourcesService';

import { useSession } from '@root/SessionContext';

import { useHubPath } from '@hooks/useHubPath';
import { useHubSetupTasks } from '@hooks/useHubSetupTasks';
import usePageTitle from '@hooks/usePageTitle';
import { useStartConversation } from '@hooks/useStartConversation';

import Button from '@ui-components/input/Button';
import ConversationInput from '@ui-components/input/ConversationInput';
import HintBox from '@ui-components/layout/HintBox';
import { PanelLoading, PollingLoading } from '@ui-components/layout/LoadingIndicator';
import Tooltip from '@ui-components/layout/Tooltip';

import { Can } from '@components/Can';
import BookDemoHelp from '@components/hub-onboarding/BookDemoHelp';
import OnboardingCardHeader from '@components/hub-onboarding/OnboardingCardHeader';
import { CurrentStep, DoneStep, FutureStep } from '@components/hub-onboarding/OnboardingSteps';

import DataSourcesCreateWizard from '@pages/data-sources/DataSourcesCreateWizard';
import HubSetupOrganizationStep from '@pages/hub-setup/HubSetupOrganizationStep';

import styles from './HubSetup.module.css';

const HubSetupPage = () => {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const hubId = useSession().currentHubId();
  const hasHub = Boolean(hubId);
  const hubPath = useHubPath();
  // Preloaded content is ignored here, so the setup flow keeps asking for the hub's own content
  const { ownSourceCreated, ownDocumentSynced, isPending } = useHubSetupTasks({ poll: true });
  const currentStep = getCurrentSetupStep(hasHub, ownSourceCreated, ownDocumentSynced);

  const { data: sources = [] } = useQuery<Source[]>({
    queryKey: [`/hubs/${hubId}/sources`],
    queryFn: () => fetchSources(hubId!),
    enabled: Boolean(hubId) && currentStep === 3,
  });

  const { handleSubmit: handleConversationSubmit, isSubmitting } = useStartConversation({
    onSuccess: async (conversationId) => {
      navigate(hubPath(`/conversations/me/${conversationId}`));
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: [`/hubs/${hubId}`] }),
        queryClient.invalidateQueries({ queryKey: ['/me'] }),
      ]);
    },
  });

  usePageTitle(
    <FormattedMessage
      id="hubSetup.pageTitle"
      defaultMessage="Setup {step} of 3"
      description="Browser page title for the admin hub setup page, showing current step number"
      values={{ step: currentStep }}
    />
  );

  const handleSkip = () => {
    if (hubId) localStorage.setItem("hub_setup_skipped_" + hubId, "true");
    navigate(hubPath("/dashboard"));
  };

  return (
    <>
      <div className={styles.hubSetupWrapper}>
        <div className={styles.hubSetupContent}>
          <OnboardingCardHeader
            title={
              <FormattedMessage
                id="hubSetup.title"
                defaultMessage="Get your chatbot ready in 3 steps"
                description="Title for the onboarding experience needed to setup the system"
              />
            }
            subtitle={
              <FormattedMessage
                id="hubSetup.subtitle"
                defaultMessage="After step 3, you’ll have seen it in action and unlocked the full app."
                description="Subtitle for the admin hub setup card explaining the payoff of completing all 3 setup steps"
              />
            }
          >
            <BookDemoHelp />
          </OnboardingCardHeader>
          <div className={styles.hubSetupSteps}>
            {isPending && (
              <>
                <DoneStep label={<FormattedMessage id="hubSetup.step1OrgDoneLabel" defaultMessage="Organization created" description="Label for the completed organization-creation step of hub setup" />} />
                <CurrentStep step="2" label={<FormattedMessage id="global.loadingMessageloading" defaultMessage="Loading…" description="Loading message indicator that a section of the app is still loading" />}>
                  <PanelLoading />
                </CurrentStep>
                <FutureStep step="3" label={<FormattedMessage id="global.setupOnboardingAskQuestion" defaultMessage="Ask your chatbot a question" description="Title for setup and onboarding of the hub setup about starting a conversation with the chatbot" />} />
              </>
            )}
            {!isPending && currentStep === 1 && (
              <>
                <CurrentStep
                  step="1"
                  label={
                    <FormattedMessage
                      id="hubSetup.step1TitleOrg"
                      defaultMessage="Create your organization"
                      description="Right panel title for step 1 of hub setup, prompting the admin to create their organization"
                    />
                  }
                >
                  <HubSetupOrganizationStep />
                </CurrentStep>
                <FutureStep step="2" label={<FormattedMessage id="hubSetup.step1Title" defaultMessage="Add content for your chatbot" description="Right panel title for step 1 when no source exists" />} />
                <FutureStep step="3" label={<FormattedMessage id="global.setupOnboardingAskQuestion" defaultMessage="Ask your chatbot a question" description="Title for setup and onboarding of the hub setup about starting a conversation with the chatbot" />} />
              </>
            )}
            {!isPending && currentStep === 2 && (
              <>
                <DoneStep label={<FormattedMessage id="hubSetup.step1OrgDoneLabel" defaultMessage="Organization created" description="Label for the completed organization-creation step of hub setup" />} />
                <CurrentStep
                  step="2"
                  label={
                    ownSourceCreated ? (
                      <FormattedMessage
                        id="hubSetup.step1TitleSyncing"
                        defaultMessage="Processing your content…"
                        description="Right panel title for step 1 when a source has been created and is being synced"
                      />
                    ) : (
                      <FormattedMessage
                        id="hubSetup.step1Title"
                        defaultMessage="Add content for your chatbot"
                        description="Right panel title for step 1 when no source exists"
                      />
                    )
                  }
                >
                  {ownSourceCreated ? (
                    <FormattedMessage
                      id="global.setupOnboardingSyncing"
                      defaultMessage="{icon} We’re processing your data sources. This usually takes a few minutes before the first piece of content is ready and you are able to start a conversation with your chatbot."
                      description="Description shown to users in the setup and onboarding process while data sources are being synced"
                      tagName="p"
                      values={{
                        icon: <PollingLoading key="icon" />,
                      }}
                    />
                  ) : (
                    <>
                      <FormattedMessage
                        id="hubSetup.step1Description1"
                        defaultMessage="Add the first <strong>documents, articles, or content</strong> your audience might ask about. You will be able to change this and add more later. Your chatbot will only answer from what you give it — <strong>nothing else</strong>."
                        description="Right panel description for step 1 when no source exists"
                        tagName="p"
                        values={{
                          strong: msg => <strong key="strong">{msg}</strong>,
                        }}
                      />
                      <DataSourcesCreateWizard isSetup onCreate={() => queryClient.invalidateQueries({ queryKey: [`/hubs/${hubId}`] })} />
                    </>
                  )}
                </CurrentStep>
                <FutureStep step="3" label={<FormattedMessage id="global.setupOnboardingAskQuestion" defaultMessage="Ask your chatbot a question" description="Title for setup and onboarding of the hub setup about starting a conversation with the chatbot" />} />
              </>
            )}
            {!isPending && currentStep === 3 && (
              <>
                <DoneStep label={<FormattedMessage id="hubSetup.step1OrgDoneLabel" defaultMessage="Organization created" description="Label for the completed organization-creation step of hub setup" />} />
                <DoneStep label={<FormattedMessage id="hubSetup.step1Label" defaultMessage="First content for your chatbot added" description="Label for step 1 of the chat onboarding stepper" />} />
                <CurrentStep className={styles.firstInternalConversationMessage}
                  step="3"
                  label={
                    <FormattedMessage
                      id="global.setupOnboardingAskQuestion"
                      defaultMessage="Ask your chatbot a question"
                      description="Title for setup and onboarding of the hub setup about starting a conversation with the chatbot"
                    />
                  }
                >
                  <FormattedMessage
                    id="hubSetup.step2Description"
                    defaultMessage="Ask a straightforward question about the content you added that your audience might ask."
                    description="Right panel description for step 2 prompting the user to start a conversation"
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
                          tagName="p"
                          values={{
                            strong: msg => <strong key="strong">{msg}</strong>,
                          }}
                        />
                        <FormattedMessage
                          id="global.setupInternalConversationDescriptionContinued"
                          defaultMessage="Try asking: <strong>How is Suwali different from other chatbots?</strong>"
                          description="Introduces the term ‘internal conversation’ and reassures the user this is a private, safe space to test"
                          tagName="p"
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
          </div>
          {hasHub && (
            <footer>
              <Tooltip content={
                <FormattedMessage
                  id="hubSetup.skipSetupTooltip"
                  defaultMessage="Don’t worry, you can always come back and complete this setup."
                  description="Tooltip that lets the admin know they can skip hub setup and go directly to the dashboard, but return later"
                />
              }>
                <Button
                  label={
                    <FormattedMessage
                      id="hubSetup.skipSetup"
                      defaultMessage="Skip setup for now"
                      description="Button label that lets the admin skip hub setup and go directly to the dashboard"
                    />
                  }
                  onClick={handleSkip}
                  size="small"
                  themeMode
                />
              </Tooltip>
            </footer>
          )}
        </div>
      </div>
    </>
  );
};

export default HubSetupPage;
