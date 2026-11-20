import { FormattedMessage } from 'react-intl';

import type { Hub } from '@customTypes/hub';

import ContributionWorkflowStep from './ContributionWorkflowStep';
import styles from './ContributionWorkflowVisualization.module.css';

export type ContributionWorkflowStepName = 'code' | 'audience' | 'reviewProcess';

type ContributionWorkflowVisualizationProps = {
  mode: Hub['contribution_workflow_mode'];
  audience: Hub['contribution_audience'];
  contributionCode: string;
  trustedEndUsersCount: number;
  onCustomize?: (step: ContributionWorkflowStepName) => void;
  activeStep?: ContributionWorkflowStepName;
};

const strong = (chunks: React.ReactNode) => <strong key="strong">{chunks}</strong>;

const ContributionWorkflowVisualization = ({
  mode,
  audience,
  contributionCode,
  trustedEndUsersCount,
  onCustomize,
  activeStep,
}: ContributionWorkflowVisualizationProps) => (
  <div className={styles.steps}>
    <ContributionWorkflowStep
      icon="user_conversation"
      title={
        <FormattedMessage
          id="contributionWorkflow.codeInitiationTitle"
          defaultMessage="Code initiation"
          description="Title of the contribution workflow step where the end-user sends the contribution code"
        />
      }
      onCustomize={onCustomize && (() => onCustomize('code'))}
      customizeDisabled={activeStep === 'code'}
    >
      <FormattedMessage
        id="contributionWorkflow.step1"
        defaultMessage="An end-user sends <strong>{contributionCode}</strong> as a message to your chatbot."
        description="Step 1 of the contribution workflow visualization"
        values={{ contributionCode, strong }}
      />
    </ContributionWorkflowStep>
    {audience === 'all_end_users' ? (
      <ContributionWorkflowStep
        icon="users"
        title={
          <FormattedMessage
            id="global.allEndUsersTitle"
            defaultMessage="All end-users"
            description="Title for the contribution audience that accepts contributions from any end-user"
          />
        }
        onCustomize={onCustomize && (() => onCustomize('audience'))}
      customizeDisabled={activeStep === 'audience'}
      >
        <FormattedMessage
          id="contributionWorkflow.step2AllEndUsers"
          defaultMessage="<strong>Any</strong> end-user from your audience can submit a community contribution."
          description="Step 2 of the contribution workflow visualization when any end-user can contribute"
          values={{ strong }}
        />
      </ContributionWorkflowStep>
    ) : (
      <ContributionWorkflowStep
        icon={trustedEndUsersCount === 0 ? 'error_filled' : 'lightning'}
        title={
          <FormattedMessage
            id="global.endUserAllowlistTitle"
            defaultMessage="End-user allowlist"
            description="Title for the contribution audience that only accepts contributions from trusted end-users"
          />
        }
        onCustomize={onCustomize && (() => onCustomize('audience'))}
        customizeDisabled={activeStep === 'audience'}
        variant={trustedEndUsersCount === 0 ? 'error' : 'default'}
      >
        <FormattedMessage
          id="contributionWorkflow.step2"
          defaultMessage="The system checks to ensure the end-user is on the allowlist of your <strong>{count} trusted end-users</strong>."
          description="Step 2 of the contribution workflow visualization"
          values={{ count: trustedEndUsersCount, strong }}
        />
      </ContributionWorkflowStep>
    )}
    <ContributionWorkflowStep icon="bot_voice">
      <FormattedMessage
        id="contributionWorkflow.step3"
        defaultMessage="Your chatbot <strong>asks the end-user</strong> if they are ready to submit content."
        description="Step 3 of the contribution workflow visualization"
        values={{ strong }}
      />
    </ContributionWorkflowStep>
    <ContributionWorkflowStep icon="user_conversation">
      <FormattedMessage
        id="contributionWorkflow.step4"
        defaultMessage="The end-user <strong>sends</strong> their content as a message."
        description="Step 4 of the contribution workflow visualization"
        values={{ strong }}
      />
    </ContributionWorkflowStep>
    <ContributionWorkflowStep icon="bot_voice">
      <FormattedMessage
        id="contributionWorkflow.step5"
        defaultMessage="Your chatbot <strong>acknowledges</strong> the contribution, begins to <strong>process</strong>, and <strong>thanks</strong> the end-user."
        description="Step 5 of the contribution workflow visualization"
        values={{ strong }}
      />
    </ContributionWorkflowStep>
    <ContributionWorkflowStep
      icon={mode === 'direct' ? 'conversations' : 'pause'}
      title={mode === 'direct' ? (
        <FormattedMessage
          id="contributionWorkflow.directContributionTitle"
          defaultMessage="Direct contribution"
          description="Title of the last contribution workflow step when contributions are published immediately"
        />
      ) : (
        <FormattedMessage
          id="contributionWorkflow.reviewContributionTitle"
          defaultMessage="Review contribution"
          description="Title of the last contribution workflow step when contributions are paused for review"
        />
      )}
      variant={mode}
      onCustomize={onCustomize && (() => onCustomize('reviewProcess'))}
      customizeDisabled={activeStep === 'reviewProcess'}
    >
      {mode === 'direct' ? (
        <FormattedMessage
          id="contributionWorkflow.step6Direct"
          defaultMessage="The contribution is <strong>immediately available</strong> to the chatbot to use in responses."
          description="Final step of the direct contribution workflow visualization"
          values={{ strong }}
        />
      ) : (
        <FormattedMessage
          id="contributionWorkflow.step6Review"
          defaultMessage="The contribution is <strong>paused</strong> and available to review in the list of contributions."
          description="Final step of the review contribution workflow visualization"
          values={{ strong }}
        />
      )}
    </ContributionWorkflowStep>
  </div>
);

export default ContributionWorkflowVisualization;
