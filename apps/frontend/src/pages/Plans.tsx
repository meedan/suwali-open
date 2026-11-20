import React, { useMemo, useState } from 'react';
import { defineMessages, FormattedMessage, useIntl } from 'react-intl';
import { useNavigate } from 'react-router'
import { useQuery } from '@tanstack/react-query';

import { APP_NAME, SALES_EMAIL } from '@constants/App';

import { getDaysRemaining, isTrial } from '@helpers/trial';

import { fetchAbout } from '@services/AboutService';

import { useSession } from '@root/SessionContext';

import { useHubPath } from '@hooks/useHubPath';
import usePageTitle from '@hooks/usePageTitle';

import Button, { ButtonLink } from '@ui-components/input/Button';
import { ToggleGroup, ToggleGroupItem } from '@ui-components/input/ToggleGroup';
import Icon from "@ui-components/layout/Icon";
import { Modal } from '@ui-components/layout/Modal';
import Tooltip from '@ui-components/layout/Tooltip';

import Hub from '@components/Hub';

import styles from './Plans.module.css';

const messages = defineMessages({
  upTo: {
    id: 'plans.upTo',
    defaultMessage: 'up to {limit}',
    description: 'Label prefix for plan limits showing maximum allowed',
  },
});

type BillingCycle = 'monthly' | 'annual';

const PRICING = {
  standard: { monthly: '$199', annual: '$1,990', sms: '$35'},
  standardSubsidized: { monthly: '$49', annual: '$490'},
  pro: { monthly: '$499', annual: '$4,990', sms: '$100' },
} as const;

type PremiumTierType = 'trial' | 'subsidized' | 'standard' | 'pro' | 'enterprise';

const TierPrice = ({ price, billingCycle }: { price: string; billingCycle: BillingCycle }) => (
  <div className={styles.tierPrice}>
    {billingCycle === 'monthly'
      ? <FormattedMessage
          id="plans.perMonth"
          defaultMessage="{price}<s>/ month</s>"
          description="Suffix indicating a price is billed per month"
          values={{ price, s: msg => <span key="span">{msg}</span> }}
        />
      : <FormattedMessage
          id="plans.perYear"
          defaultMessage="{price}<s>/ year</s>"
          description="Suffix indicating a price is billed per year"
          values={{ price, s: msg => <span key="span">{msg}</span> }}
        />
    }
  </div>
);

const planCTA = (current: boolean, demoLink: string): React.JSX.Element => {
  return current ?
    <div className={styles.currentPlanAction}>
      <FormattedMessage
        id="global.currentPlan"
        defaultMessage="Current plan"
        description="Generic CTA for buttons and labels about this is the current billing plan"
      />
    </div>
    :
    <ButtonLink
      label={
        <FormattedMessage
          id="global.contactSales"
          defaultMessage="Contact sales"
          description="Generic cta for buttons and labels about contact sales for subscription and pricing information"
        />
      }
      size="medium"
      variant="filled"
      to={demoLink}
      target="_blank"
      rel="noopener noreferrer"
    />;
}

const Plans = () => {
  const intl = useIntl();
  const navigate = useNavigate();
  const session = useSession();
  const hubPath = useHubPath();
  const hub = session.currentHub();
  const [billingCycle, setBillingCycle] = useState<BillingCycle>('monthly');
  const [trialDetailsOpen, setTrialDetailsOpen] = useState(false);
  const daysRemaining = hub ? getDaysRemaining(hub.trial_ends_at) : null;

  const { data: about, isLoading, isError } = useQuery({
    queryKey: ['/about'],
    queryFn: fetchAbout,
  });

  const activePremiumTier = useMemo(() => {
    if (!hub) return null;
    if (isTrial(hub)) return 'trial';
    return hub.plan as PremiumTierType;
  }, [hub]);

  usePageTitle(
    <FormattedMessage
      id="global.plansPageTitle"
      defaultMessage="Plans"
      description="Browser Page title for the pricing page plans page"
    />
  );

  // Format limit display helper
  const formatLimit = (limit: number | null | undefined, showUpTo: boolean = true): React.ReactNode => {
    if (limit === null || limit === undefined) {
      if (activePremiumTier === 'enterprise') {
        return (
          <FormattedMessage
            id="global.unrestricted"
            defaultMessage="Unrestricted"
            description="Label shown in place of a plan limit when there is no restriction"
          />
        );
      }
      return (
        <FormattedMessage
          id="global.custom"
          defaultMessage="Custom"
          description="Generic label for custom option in a selection input or choice"
        />
      );
    }

    const formattedNumber = limit.toLocaleString();

    if (showUpTo) {
      return intl.formatMessage(messages.upTo, { limit: formattedNumber });
    }

    return formattedNumber;
  };

  if (isLoading || isError || !about || !about.plans) {
    return null;
  }

  const plans = about.plans;
  const isEnterprise = activePremiumTier === 'enterprise';
  // The pricing table only says "Custom"; an enterprise hub sees its own contracted limits
  const enterpriseLimits = isEnterprise && hub
    ? { messages: hub.max_messages_for_plan, sources: hub.max_sources_for_plan, documents: hub.max_documents_for_plan }
    : plans.enterprise;

  return (
    <div className={styles.plansWrapper}>
      <header>
        <div>
          <Button
            iconLeft={<Icon id="chevron_left" aria-hidden />}
            size="small"
            themeMode
            variant="filled"
            onClick={() => navigate(hubPath('/dashboard'))}
          />
          <Hub avatar name />
        </div>
        <Button
          iconLeft={<Icon id="x" aria-hidden />}
          size="medium"
          themeMode
          variant="filled"
          onClick={() => navigate(hubPath('/dashboard'))}
        />
      </header>
      <div className={styles.plansContainer}>
        <div className={styles.plansIntro}>
          <hgroup>
            <h1><Icon id="suwali_logo_theme" aria-label="Suwali" /></h1>
            <FormattedMessage
              id="plans.systemTagline"
              defaultMessage="Inform, listen, and learn — scale with Suwali"
              description="Marketing style tagline for the system"
              tagName="h2"
            />
          </hgroup>
        </div>
        { Boolean(hub && isTrial(hub)) &&
          <div className={styles.freeTrial}>
            <div className={styles.freeTrialContent}>
              <FormattedMessage
                id="global.daysRemaining"
                defaultMessage="{days} {days, plural, one {Day} other {Days}} remaining on your {appName} free trial."
                description="Message showing how many days are left in the free trial"
                values={{ days: daysRemaining, appName: APP_NAME }}
                tagName="h3"
              />
              <FormattedMessage
                id="plans.trialTierDescription"
                defaultMessage="Learn about how Suwali can engage with your audience using your knowledge."
                description="Description of the free trial pricing tier"
                tagName="p"
              />
              <Modal
                size="medium"
                title={
                  <FormattedMessage
                  id="plans.trialDetailsTitle"
                  defaultMessage="Free trial details"
                  description="Title of the modal and action showing the full details of the free trial pricing tier"
                  />
                }
                open={trialDetailsOpen}
                onOpenChange={setTrialDetailsOpen}
                trigger={
                  <Button
                    label={
                      <FormattedMessage
                        id="plans.trialDetailsTitle"
                        defaultMessage="Free trial details"
                        description="Title of the modal and action showing the full details of the free trial pricing tier"
                      />
                    }
                    size="small"
                    themeMode
                  />
                }
                body={
                  <dl className={styles.trialDetailsList}>
                    <FormattedMessage
                      id="plans.monthlyMessages"
                      defaultMessage="Monthly messages"
                      description="Generic label representing allowed message sends per month"
                      tagName="dt"
                    />
                    <dd>{formatLimit(plans.trial.messages, false)}</dd>
                    <FormattedMessage
                      id="global.dataSources"
                      defaultMessage="Data sources"
                      description="Reusable label for Data Sources page or list title"
                      tagName="dt"
                    />
                    <dd>{formatLimit(plans.trial.sources, false)}</dd>
                    <FormattedMessage
                      id="global.documents"
                      defaultMessage="Documents"
                      description="Reusable label for documents page or list title"
                      tagName="dt"
                    />
                    <dd>{formatLimit(plans.trial.documents, false)}</dd>
                    <FormattedMessage
                      id="global.platforms"
                      defaultMessage="Platforms"
                      description="Reusable label for third party messaging platforms page or list title"
                      tagName="dt"
                    />
                    <dd><Icon id="whatsapp" />WhatsApp</dd>
                    <dd className={styles.tierPlatform}><Icon inlineSvg id="telegram" />Telegram</dd>
                  </dl>
                }
              />
            </div>
          </div>
        }
        <div className={styles.plansBillingCycle}>
          <ToggleGroup
            size="small"
            type="single"
            value={billingCycle}
            onValueChange={(value) => { if (value) setBillingCycle(value as BillingCycle); }}
          >
            <ToggleGroupItem value="monthly">
              <FormattedMessage
                id="global.monthly"
                defaultMessage="Monthly"
                description="Label for the monthly billing cycle toggle option"
              />
            </ToggleGroupItem>
            <ToggleGroupItem value="annual">
              <FormattedMessage
                id="global.annually"
                defaultMessage="Annually"
                description="Label for the annual billing cycle toggle option"
              />
            </ToggleGroupItem>
          </ToggleGroup>
        </div>
        <div className={styles.tiersContainer}>
          <div className={styles.tierWrapper}>
            <div className={styles.tierHeader}>
              <FormattedMessage
                id="global.subsidizedTier"
                defaultMessage="Subsidized"
                description="Generic label for the subsidized pricing tier"
                tagName="h3"
              />
              <div className={styles.subsidizedTierDescription}>
                <FormattedMessage
                  id="plans.subsidizedTierDescription"
                  defaultMessage="For qualifying organizations in the <strong>Larger World</strong>, <salesLink>contact us</salesLink> to learn more."
                  description="Description of the subsidized pricing tier"
                  tagName="p"
                  values={{
                    strong: msg => <strong key="strong">{msg}</strong>,
                    salesLink: chunk =>
                      <a key="salesLink" href={`mailto:${SALES_EMAIL}`} rel="noopener noreferrer" title={SALES_EMAIL}>
                        {chunk}
                      </a>
                  }}
                />
              </div>
            </div>
            { planCTA(activePremiumTier === 'subsidized', about.schedule_demo_link) }
            <dl>
              <FormattedMessage
                id="plans.monthlyMessages"
                defaultMessage="Monthly messages"
                description="Generic label representing allowed message sends per month"
                tagName="dt"
              />
              <Tooltip
                content={
                  <FormattedMessage
                    id="plans.messagesOverageTooltip"
                    defaultMessage="Additional messages are billed at $25 per 500 messages."
                    description="Tooltip text for telling the user how much it costs if they go over their messaging limits"
                  />
                }
              >
                <dd>
                  {formatLimit(plans.subsidized.messages)}
                  <Icon id="info_filled" aria-hidden />
                </dd>
              </Tooltip>
              <FormattedMessage
                id="global.dataSources"
                defaultMessage="Data sources"
                description="Reusable label for Data Sources page or list title"
                tagName="dt"
              />
              <dd>{formatLimit(plans.subsidized.sources)}</dd>
              <FormattedMessage
                id="global.documents"
                defaultMessage="Documents"
                description="Reusable label for documents page or list title"
                tagName="dt"
              />
              <dd>{formatLimit(plans.subsidized.documents)}</dd>
              <FormattedMessage
                id="global.platforms"
                defaultMessage="Platforms"
                description="Reusable label for third party messaging platforms page or list title"
                tagName="dt"
              />
              <dd><Icon id="whatsapp" />WhatsApp</dd>
              <dd className={styles.tierPlatform}><Icon inlineSvg id="telegram" />Telegram</dd>
            </dl>
          </div>
          <div className={styles.tierWrapper}>
            <div className={styles.tierHeader}>
              <FormattedMessage
                id="global.standardTier"
                defaultMessage="Standard"
                description="Generic label for the standard pricing tier"
                tagName="h3"
              />
              <TierPrice price={PRICING.standard[billingCycle]} billingCycle={billingCycle} />
              <FormattedMessage
                id="plans.standardTierDescription"
                defaultMessage="Best for mid-size teams ready to build direct relationships with their audience."
                description="Description of the standard pricing tier"
                tagName="p"
              />
            </div>
            { planCTA(activePremiumTier === 'standard', about.schedule_demo_link) }
            <dl>
              <FormattedMessage
                id="plans.monthlyMessages"
                defaultMessage="Monthly messages"
                description="Generic label representing allowed message sends per month"
                tagName="dt"
              />
              <Tooltip
                content={
                  <FormattedMessage
                    id="plans.messagesOverageTooltip"
                    defaultMessage="Additional messages are billed at $25 per 500 messages."
                    description="Tooltip text for telling the user how much it costs if they go over their messaging limits"
                  />
                }
              >
                <dd>
                  {formatLimit(plans.standard.messages)}
                  <Icon id="info_filled" aria-hidden />
                </dd>
              </Tooltip>
              <FormattedMessage
                id="global.dataSources"
                defaultMessage="Data sources"
                description="Reusable label for Data Sources page or list title"
                tagName="dt"
              />
              <dd>{formatLimit(plans.standard.sources)}</dd>
              <FormattedMessage
                id="global.documents"
                defaultMessage="Documents"
                description="Reusable label for documents page or list title"
                tagName="dt"
              />
              <dd>{formatLimit(plans.standard.documents)}</dd>
              <FormattedMessage
                id="global.platforms"
                defaultMessage="Platforms"
                description="Reusable label for third party messaging platforms page or list title"
                tagName="dt"
              />
              <dd><Icon id="whatsapp" />WhatsApp</dd>
              <dd className={styles.tierPlatform}><Icon inlineSvg id="telegram" />Telegram</dd>
              <dd className={styles.tierPlatform}>
                <Icon id="sms" />
                <FormattedMessage
                  id="plans.addSmsFor"
                  defaultMessage="Add SMS for {price}"
                  description="Option to add SMS messaging to a plan for an extra monthly price. {price} is the price with its billing period"
                  values={{
                    price: <TierPrice price={PRICING.standard['sms']} billingCycle="monthly" />
                  }}
                />
              </dd>
            </dl>
          </div>
          <div className={styles.tierWrapper}>
            <div className={styles.tierHeader}>
              <FormattedMessage
                id="global.ProTier"
                defaultMessage="Pro"
                description="Generic label for the pro pricing tier"
                tagName="h3"
              />
              <TierPrice price={PRICING.pro[billingCycle]} billingCycle={billingCycle} />
              <FormattedMessage
                id="plans.proTierDescription"
                defaultMessage="Best for established teams ready to expand and enhance relationships with their audience."
                description="Description of the pro pricing tier"
                tagName="p"
              />
            </div>
            { planCTA(activePremiumTier === 'pro', about.schedule_demo_link) }
            <dl>
              <FormattedMessage
                id="plans.monthlyMessages"
                defaultMessage="Monthly messages"
                description="Generic label representing allowed message sends per month"
                tagName="dt"
              />
              <Tooltip
                content={
                  <FormattedMessage
                    id="plans.messagesOverageTooltip"
                    defaultMessage="Additional messages are billed at $25 per 500 messages."
                    description="Tooltip text for telling the user how much it costs if they go over their messaging limits"
                  />
                }
              >
                <dd>
                  {formatLimit(plans.pro.messages)}
                  <Icon id="info_filled" aria-hidden />
                </dd>
              </Tooltip>
              <FormattedMessage
                id="global.dataSources"
                defaultMessage="Data sources"
                description="Reusable label for Data Sources page or list title"
                tagName="dt"
              />
              <dd>{formatLimit(plans.pro.sources)}</dd>
              <FormattedMessage
                id="global.documents"
                defaultMessage="Documents"
                description="Reusable label for documents page or list title"
                tagName="dt"
              />
              <dd>{formatLimit(plans.pro.documents)}</dd>
              <FormattedMessage
                id="global.platforms"
                defaultMessage="Platforms"
                description="Reusable label for third party messaging platforms page or list title"
                tagName="dt"
              />
              <dd><Icon id="whatsapp" />WhatsApp</dd>
              <dd className={styles.tierPlatform}><Icon inlineSvg id="telegram" />Telegram</dd>
              <dd className={styles.tierPlatform}><Icon id="sms" /><FormattedMessage id="plans.addSmsFor" defaultMessage="Add SMS for {price}" description="Option to add SMS messaging to a plan for an extra monthly price. {price} is the price with its billing period" values={{ price: <TierPrice price={PRICING.pro['sms']} billingCycle="monthly" /> }} /></dd>
            </dl>
          </div>
          <div className={styles.tierWrapper}>
            <div className={styles.tierHeader}>
              <FormattedMessage
                id="global.enterpriseTier"
                defaultMessage="Enterprise"
                description="Generic label for the top pricing tier"
                tagName="h3"
              />
              <div className={styles.tierPrice}>
                {billingCycle === 'monthly'
                  ? <FormattedMessage
                      id="plans.customPerMonth"
                      defaultMessage="Custom<s>/ month</s>"
                      description="Suffix indicating a price is billed per month"
                      values={{
                        s: msg => <span key="span">{msg}</span>,
                      }}
                    />
                  : <FormattedMessage
                      id="plans.customPerYear"
                      defaultMessage="Custom<s>/ year</s>"
                      description="Suffix indicating a price is billed per year"
                      values={{
                        s: msg => <span key="span">{msg}</span>,
                      }}
                    />
                }
              </div>
              <FormattedMessage
                id="plans.enterpriseTierDescription"
                defaultMessage="Best for large organizations operating at scale with complex content ecosystems."
                description="Description of the enterprise pricing tier"
                tagName="p"
              />
            </div>
            { planCTA(activePremiumTier === 'enterprise', about.schedule_demo_link) }
            <dl>
              <FormattedMessage
                id="plans.monthlyMessages"
                defaultMessage="Monthly messages"
                description="Generic label representing allowed message sends per month"
                tagName="dt"
              />
              <dd>{formatLimit(enterpriseLimits.messages, isEnterprise)}</dd>
              <FormattedMessage
                id="global.dataSources"
                defaultMessage="Data sources"
                description="Reusable label for Data Sources page or list title"
                tagName="dt"
              />
              <dd>{formatLimit(enterpriseLimits.sources, isEnterprise)}</dd>
              <FormattedMessage
                id="global.documents"
                defaultMessage="Documents"
                description="Reusable label for documents page or list title"
                tagName="dt"
              />
              <dd>{formatLimit(enterpriseLimits.documents, isEnterprise)}</dd>
              <FormattedMessage
                id="global.platforms"
                defaultMessage="Platforms"
                description="Reusable label for third party messaging platforms page or list title"
                tagName="dt"
              />
              <dd><Icon id="whatsapp" />WhatsApp</dd>
              <dd className={styles.tierPlatform}><Icon inlineSvg id="telegram" />Telegram</dd>
              <dd className={styles.tierPlatform}><Icon id="sms" />SMS</dd>
            </dl>
          </div>
        </div>
      </div>
    </div>
  );
};

export default Plans;
