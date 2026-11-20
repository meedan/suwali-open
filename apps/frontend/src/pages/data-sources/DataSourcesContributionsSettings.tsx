import clsx from 'clsx';
import { FormattedMessage } from "react-intl";
import { useSearchParams } from "react-router";
import { useQueries } from "@tanstack/react-query";

import { fetchHubTrustedEndUsers } from "@services/HubService";

import { useSession } from "@root/SessionContext";

import { useCan } from "@hooks/useCapabilities";
import { useNavigateWithRememberedParams } from "@hooks/useRememberedSearchParams";

import Button from "@ui-components/input/Button";
import Icon from "@ui-components/layout/Icon";

import ContributionAudienceSettings from './ContributionAudienceSettings';
import ContributionCodeSettings from './ContributionCodeSettings';
import ContributionReviewProcessSettings from './ContributionReviewProcessSettings';
import type { ContributionWorkflowStepName } from './ContributionWorkflowVisualization';
import ContributionWorkflowVisualization from './ContributionWorkflowVisualization';
import styles from './DataSourcesContributionsSettings.module.css';
import documentsPanelStyles from './DataSourcesDocumentsPanel.module.css';

const DataSourcesContributionsSettings = () => {
  const session = useSession();
  const hubId = session.currentHubId();
  const hub = session.currentHub();
  const navigateWithRemembered = useNavigateWithRememberedParams(hubId);
  const canUpdateHub = useCan('UPDATE_HUB').allowed;

  const [trustedEndUsersQuery] = useQueries({
    queries: [
      { queryKey: [`/hubs/${hubId}/external-users?trusted=true`], queryFn: () => fetchHubTrustedEndUsers(hubId!), enabled: Boolean(hubId) },
    ],
  });

  const trustedEndUsersCount = trustedEndUsersQuery.data?.length || 0;

  const [searchParams, setSearchParams] = useSearchParams();
  const customizing = searchParams.get('customize') as ContributionWorkflowStepName | null;
  const setCustomizing = (step: ContributionWorkflowStepName | null) => {
    setSearchParams(step ? { customize: step } : {});
  };
  const closeCustomize = () => setCustomizing(null);

  return (
    <div className={clsx('layout-main-column-scrollable-area', documentsPanelStyles.tableWrapper)}>
      <div className={styles.contributionsSettings}>
        <div className={clsx(styles.contributionCodeWrapper, styles.workflowColumn)}>
          <div className={styles.contributionWorkflowHeader}>
            <h3>
              <Icon aria-hidden id="users_source" />
              <FormattedMessage
                id="global.communityContributionWorkflow"
                defaultMessage="Community contribution workflow"
                description="Title for the community contribution workflow settings"
              />
            </h3>
          </div>
          {hub && !trustedEndUsersQuery.isPending && (
            <ContributionWorkflowVisualization
              mode={hub.contribution_workflow_mode}
              audience={hub.contribution_audience}
              contributionCode={hub.contribution_code}
              trustedEndUsersCount={trustedEndUsersCount}
              activeStep={customizing ?? undefined}
              onCustomize={canUpdateHub ? setCustomizing : undefined}
            />
          )}
        </div>
        <div className={clsx(styles.rightColumn, customizing ? styles.customizePanel : styles.contributionsIntro)}>
          {customizing === 'code' && <ContributionCodeSettings onClose={closeCustomize} />}
          {customizing === 'audience' && <ContributionAudienceSettings onClose={closeCustomize} />}
          {customizing === 'reviewProcess' && <ContributionReviewProcessSettings onClose={closeCustomize} />}
          {!customizing && (
          <>
          <FormattedMessage
            id="dataSourcesContributionsSettings.contributionsIntro"
            defaultMessage="<strong>Tips, reports, ideas, and knowledge</strong> are captured as part of the chatbot conversation, then organized so your team can understand what is happening and decide what needs attention."
            description="First paragraph describing what community contributions are"
            values={{ strong: msg => <strong key="strong">{msg}</strong> }}
            tagName="p"
          />
          <FormattedMessage
            id="dataSourcesContributionsSettings.contributionsCustomizeIntro"
            defaultMessage="You can determine <strong>who</strong> can submit contributions and <strong>what</strong> happens to them when they arrive by customizing the steps in the contribution workflow."
            description="Second paragraph describing what can be customized in the contribution workflow"
            values={{ strong: msg => <strong key="strong">{msg}</strong> }}
            tagName="p"
          />
          <Button
            iconLeft={<Icon aria-hidden id="list" />}
            label={
              <FormattedMessage
                id="global.viewContributions"
                defaultMessage="View contributions"
                description="Button label to open the list of end-user contributions"
              />
            }
            size="small"
            variant="filled"
            themeMode
            onClick={() => {
              navigateWithRemembered('/data-sources/contributions');
            }}
          />
          </>
          )}
        </div>
      </div>
    </div>
  );
};

export default DataSourcesContributionsSettings;
