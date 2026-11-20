import clsx from 'clsx';
import { FormattedDate, FormattedMessage, useIntl } from 'react-intl';
import { useNavigate } from 'react-router';

import { getPlanMessageDescriptor } from '@helpers/plan';
import { isTrial } from '@helpers/trial';

import { useSession } from '@root/SessionContext';

import { useHubPath } from '@hooks/useHubPath';

import Button from '@ui-components/input/Button';
import Icon from '@ui-components/layout/Icon';
import ProgressBar from '@ui-components/layout/ProgressBar';
import Tooltip from '@ui-components/layout/Tooltip';
import { Widget } from '@ui-components/layout/Widget';

import styles from './BillingWidget.module.css';

// Usage this close to the plan limit switches the row to its warning presentation
const WARNING_THRESHOLD_PERCENT = 90;

const upgradeTooltipItem = (
  <FormattedMessage
    id="billingWidget.tooltipUpgrade"
    defaultMessage="Upgrade your plan or contact us for support."
    description="Tooltip bullet inviting the user to upgrade their plan when close to a plan limit"
    tagName="li"
  />
);

type UsageRowProps = {
  current: number;
  // Plans without a limit for this resource render an unrestricted row instead of usage against a maximum
  max: number | null;
  label: React.ReactNode;
  limit: (max: number) => React.ReactNode;
  tooltip: (max: number, percent: number) => React.ReactNode;
};

const UsageRow = ({ current, max, label, limit, tooltip }: UsageRowProps) => {
  const percent = max !== null && max > 0 ? Math.round((current / max) * 100) : 0;
  const isWarning = max !== null && percent >= WARNING_THRESHOLD_PERCENT;

  const row = (
    <div className={clsx(styles.usageRow, { [styles.usageRowWarning]: isWarning })}>
      <div className={styles.usageMain}>
        {/* Not interactive: the design uses the button styling to frame the usage percentage */}
        <Button
          aria-hidden
          className={styles.usagePercent}
          iconLeft={max === null ? <span><Icon id="check" /></span> : undefined}
          label={max === null ? undefined : `${percent}%`}
          tabIndex={-1}
          themeMode
        />
        <div className={styles.usageDetails}>
          <div className={styles.usageLabel}>
            {label}
            {isWarning && <Icon aria-hidden className={styles.usageWarningIcon} id="error_filled" />}
          </div>
          <ProgressBar className={styles.usageProgressBar} fillPercent={Math.min(percent, 100)} />
          <div className={styles.usageCounts}>
            <span className={styles.usageCurrent}>{current.toLocaleString()}</span>
            <span>
              {max === null
                ? <FormattedMessage
                    id="global.unrestricted"
                    defaultMessage="Unrestricted"
                    description="Label shown in place of a plan limit when there is no restriction"
                  />
                : limit(max)
              }
            </span>
          </div>
        </div>
      </div>
    </div>
  );

  if (max === null) {
    return row;
  }

  return (
    <Tooltip content={<div className={styles.tooltip}>{tooltip(max, percent)}</div>}>
      {row}
    </Tooltip>
  );
};

const BillingWidget = ({ onHide }: {
  onHide?: () => void,
}) => {
  const intl = useIntl();
  const hub = useSession().currentHub();
  const hubPath = useHubPath();
  const navigate = useNavigate();

  if (!hub) {
    return null;
  }

  const now = new Date();
  const messagesResetsAt = new Date(now.getFullYear(), now.getMonth() + 1, 1);
  const { monthly_messages_count: messages, documents_count: documents, external_data_sources_count: dataSources } = hub;
  const maxMessages = hub.max_messages_for_plan;
  const maxDocuments = hub.max_documents_for_plan;
  const maxDataSources = hub.max_sources_for_plan;

  return (
    <Widget>
      <Widget.Title
        title={
          <FormattedMessage
            id="global.billingPlan"
            defaultMessage="Billing plan"
            description="Title or caption for the subscription billing plan"
          />
        }
        onHide={onHide}
      />
      <Widget.Headline
        title={intl.formatMessage(getPlanMessageDescriptor(hub))}
        context={isTrial(hub) && hub.trial_ends_at
          ? <FormattedMessage
              id="global.trialEnds"
              defaultMessage="Ends {date}"
              description="Caption showing the date the free trial ends"
              values={{
                date: <FormattedDate key="date" value={hub.trial_ends_at} year="numeric" month="long" day="numeric" />
              }}
            />
          : <FormattedDate key="date" value={now} year="numeric" month="long" />}
      />
      <Widget.Body>
        <hgroup className={styles.subHeader}>
          <FormattedMessage
            id="global.monthlyLimits"
            defaultMessage="Monthly limits"
            description="Title or label for billing plan limits that reset each month"
            tagName="h3"
          />
          <Tooltip
            content={
              <FormattedMessage
                id="global.monthlyLimitDescription"
                defaultMessage="Resets on your billing date each month."
                description="Description for for billing plan limits that reset each month"
              />
            }
          >
            <span>
              <Icon id="arrow_clockwise" aria-hidden />
              <FormattedDate key="date" value={messagesResetsAt} year="numeric" month="short" day="numeric" />
            </span>
          </Tooltip>
        </hgroup>
        <div className={styles.usageRows}>
          <UsageRow
            current={messages}
            max={maxMessages}
            label={
              <FormattedMessage
                id="global.messages"
                defaultMessage="Messages"
                description="Reusable label for messages list or count"
              />
            }
            limit={(max) => (
              <FormattedMessage
                id="global.messagesLimit"
                defaultMessage="{max} per month"
                description="Number of messages included per month in the current plan"
                values={{ max: max.toLocaleString() }}
              />
            )}
            tooltip={(max, percent) => (
              percent >= 100
                ? <>
                    <FormattedMessage
                      id="global.messagesTooltipLimitReached"
                      defaultMessage="You have reached your monthly messages limit."
                      description="Tooltip title shown when the monthly messages limit is reached"
                      tagName="p"
                    />
                    <ul>
                      <FormattedMessage
                        id="global.messagesTooltipKeepsSending"
                        defaultMessage="Your audience will continue to receive messages from your chatbot."
                        description="Tooltip bullet explaining that exceeding the message allowance does not stop the chatbot"
                        tagName="li"
                      />
                      <FormattedMessage
                        id="global.messagesTooltipOverage"
                        defaultMessage="Additional messages are billed at $25 per 500 messages."
                        description="Tooltip bullet explaining the cost of messages beyond the plan allowance"
                        tagName="li"
                      />
                      {upgradeTooltipItem}
                    </ul>
                  </>
                : <FormattedMessage
                    id="global.messagesTooltipUsage"
                    defaultMessage="{current} messages sent out of {max} included in your plan"
                    description="Tooltip showing how many messages were sent against the plan allowance"
                    tagName="p"
                    values={{ current: messages.toLocaleString(), max: max.toLocaleString() }}
                  />
            )}
          />
        </div>
        <hgroup className={styles.subHeader}>
          <FormattedMessage
            id="global.fixedLimits"
            defaultMessage="Fixed plan limits"
            description="Title or label for billing plan limits that do not reset over time"
            tagName="h3"
          />
          <Tooltip
            content={
              <FormattedMessage
                id="global.fixedLimitDescription"
                defaultMessage="Total allowances tied to your plan, not tracked by month. Upgrade to increase plan limits."
                description="Description for billing plan limits that do not reset over time"
              />
            }
          >
            <span>
              <Icon id="info" aria-hidden />
              <FormattedMessage
                id="global.fixedLimit"
                defaultMessage="Fixed limits"
                description="Short title or label for billing plan limits that do not reset over time"
              />
            </span>
          </Tooltip>
        </hgroup>
        <div className={styles.usageRows}>
          <UsageRow
            current={documents}
            max={maxDocuments}
            label={
              <FormattedMessage
                id="global.documents"
                defaultMessage="Documents"
                description="Reusable label for documents page or list title"
              />
            }
            limit={(max) => (
              <FormattedMessage
                id="global.maxIncluded"
                defaultMessage="{max} included"
                description="Number of items included in the current plan"
                values={{ max: max.toLocaleString() }}
              />
            )}
            tooltip={(max, percent) => (
              percent >= 100
                ? <>
                    <FormattedMessage
                      id="global.documentsTooltipLimitReached"
                      defaultMessage="You have reached your documents limit."
                      description="Tooltip title shown when the documents limit is reached"
                      tagName="p"
                    />
                    <ul>
                      <FormattedMessage
                        id="global.documentsTooltipNoNewDocuments"
                        defaultMessage="No new documents will be added from your data sources."
                        description="Tooltip bullet explaining the consequence of reaching the documents limit"
                        tagName="li"
                      />
                      {upgradeTooltipItem}
                    </ul>
                  </>
                : <FormattedMessage
                    id="global.documentsTooltipUsage"
                    defaultMessage="{current} documents added out of {max} included in your plan"
                    description="Tooltip showing how many documents were added against the plan allowance"
                    tagName="p"
                    values={{ current: documents.toLocaleString(), max: max.toLocaleString() }}
                  />
            )}
          />
          <UsageRow
            current={dataSources}
            max={maxDataSources}
            label={
              <FormattedMessage
                id="global.dataSources"
                defaultMessage="Data sources"
                description="Reusable label for Data Sources page or list title"
              />
            }
            limit={(max) => (
              <FormattedMessage
                id="global.maxIncluded"
                defaultMessage="{max} included"
                description="Number of items included in the current plan"
                values={{ max: max.toLocaleString() }}
              />
            )}
            tooltip={(max, percent) => (
              percent >= 100
                ? <>
                    <FormattedMessage
                      id="global.dataSourcesTooltipLimitReached"
                      defaultMessage="You have reached your limit of connected data sources."
                      description="Tooltip title shown when the data sources limit is reached"
                      tagName="p"
                    />
                    <ul>
                      <FormattedMessage
                        id="global.dataSourcesTooltipNoNewSources"
                        defaultMessage="You will not be able to connect additional data sources."
                        description="Tooltip bullet explaining the consequence of reaching the data sources limit"
                        tagName="li"
                      />
                      {upgradeTooltipItem}
                    </ul>
                  </>
                : <FormattedMessage
                    id="global.dataSourcesTooltipUsage"
                    defaultMessage="{current} data sources connected out of {max} included in your plan"
                    description="Tooltip showing how many data sources are connected against the plan allowance"
                    tagName="p"
                    values={{ current: dataSources.toLocaleString(), max: max.toLocaleString() }}
                  />
            )}
          />
        </div>
      </Widget.Body>
      <Widget.Footer
        label={
          <FormattedMessage
            id="global.billingAndPlans"
            defaultMessage="Billing and plans"
            description="Reusable label for button or title for the user or system billing settings"
          />
        }
        onClick={() => navigate(hubPath('/plans'))}
      />
    </Widget>
  );
};

export default BillingWidget;
