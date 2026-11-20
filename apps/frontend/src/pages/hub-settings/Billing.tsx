import { FormattedMessage } from 'react-intl';
import { useQuery } from '@tanstack/react-query';

import { SALES_EMAIL } from '@constants/App';

import { getPlanMessageDescriptor } from '@helpers/plan';

import { fetchHub } from '@services/HubService';

import { useSession } from '@root/SessionContext';

import { ButtonLink } from '@ui-components/input/Button';

import settingsStyles from '@pages/Settings.module.css';

const BillingSettings = () => {
  const hubId = useSession().currentHubId();

  const { data: hub, isPending } = useQuery({
    queryKey: [`/hubs/${hubId}`],
    queryFn: () => fetchHub(hubId!),
    enabled: Boolean(hubId),
    throwOnError: true,
  });

  if (isPending) return null;

  return (
    <>
      <FormattedMessage
        id="global.currentPlan"
        defaultMessage="Current plan"
        description="Generic CTA for buttons and labels about this is the current billing plan"
        tagName="h3"
      />
      <FormattedMessage {...getPlanMessageDescriptor(hub!)} tagName="h2" />
      <FormattedMessage
        id="global.planChangeInstructions"
        defaultMessage="To make changes to your current plan visit the plans page or <salesLink>contact us</salesLink> for more information on available custom pricing."
        description="Billing and plans description of how to make adjustments to plans"
        tagName="p"
        values={{
          salesLink: chunk =>
            <strong key="salesLink">
              <a href={`mailto:${SALES_EMAIL}`} rel="noopener noreferrer" title={SALES_EMAIL}>
                {chunk}
              </a>
            </strong>
        }}
      />
      <div className={settingsStyles.buttonWrapper}>
        <ButtonLink
          label={
            <FormattedMessage
              id="global.viewPlans"
              defaultMessage="View plans"
              description="Button label linking to the pricing plans page."
            />
          }
          size="medium"
          variant="filled"
          to={{ pathname: '/plans' }}
        />
      </div>
    </>
  );
};

export default BillingSettings;
