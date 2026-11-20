import { FormattedMessage } from 'react-intl';
import { useNavigate } from 'react-router';

import { useHubPath } from '@hooks/useHubPath';

import Button from "@ui-components/input/Button";
import Icon from '@ui-components/layout/Icon';
import Tooltip from '@ui-components/layout/Tooltip';

import { Can } from '@components/Can';

const CreateExternalDataSourceButton = () => {
  const navigate = useNavigate();
  const hubPath = useHubPath();

  return (
    <Can action="CREATE_SOURCE">
      {(decision) => {
        // If not allowed due to missing permissions, hide the button
        if (!decision.allowed && decision.reasons?.includes('insufficient_permissions')) {
          return null;
        }

        // If not allowed due to plan limits or trial expiration, show disabled with tooltip
        const isDisabledDueToPlan = !decision.allowed && decision.reasons && (
          decision.reasons.includes('limit_reached') ||
          decision.reasons.includes('plan_restriction') ||
          decision.reasons.includes('trial_expired')
        );

        const button = (
          <Button
            disabled={isDisabledDueToPlan}
            iconLeft={<Icon id="plus" aria-hidden />}
            label={
              <FormattedMessage
                id="global.newDataSource"
                defaultMessage="New data source"
                description="Generic label or title for adding a new source of documents"
              />
            }
            orientation="vertical"
            onClick={() => {
              navigate(hubPath('/data-sources/new'));
            }}
            size="small"
            variant="menu"
            themeMode
          />
        );

        // Wrap in tooltip if disabled due to plan
        if (isDisabledDueToPlan) {
          return (
            <Tooltip content={
              <FormattedMessage
                id="global.dataSourcesSidebarPlanLimitReached"
                defaultMessage="You have reached your plan limit for data sources. Upgrade to unlock additional data sources."
                description="Tooltip message when user cannot create more data sources due to plan limit"
              />
            }>
              <span>
                {button}
              </span>
            </Tooltip>
          );
        }

        // Otherwise return the button without tooltip
        return button;
      }}
    </Can>
  );
};

export default CreateExternalDataSourceButton;
