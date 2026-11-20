import clsx from "clsx";
import { useCallback } from "react";
import { defineMessages, FormattedMessage, useIntl } from "react-intl";
import { useNavigate } from "react-router";
import { Bar, BarChart, CartesianGrid, Tooltip, type TooltipPayloadEntry, XAxis, YAxis } from "recharts";
import type { NameType, ValueType } from "recharts/types/component/DefaultTooltipContent";
import { useQuery } from "@tanstack/react-query";

import type { Contribution } from "@customTypes/contribution";

import { CHART_VISUAL_CONSTANTS, formatDay, formatDayShort, renderTooltipRow, TOOLTIP_STYLES } from '@helpers/chart';
import { rollingWeeks } from "@helpers/dashboardWidgets";

import { fetchContributions } from "@services/ContributionsService";

import { useSession } from "@root/SessionContext";

import { useDataSourceItemActions } from "@hooks/useDataSourceItemActions";
import { useHubPath } from "@hooks/useHubPath";
import { useInfiniteScrollQuery } from "@hooks/useInfiniteScrollQuery";
import { useIsInTabletRange } from "@hooks/useLayout";

import Button from "@ui-components/input/Button";
import { ExpandedWidget } from "@ui-components/layout/ExpandedWidget";
import HintBox from "@ui-components/layout/HintBox";
import Icon from "@ui-components/layout/Icon";
import type { LegendItem } from "@ui-components/layout/Legend";

import AddToNotebookModal from "@components/AddToNotebookModal";
import ConfirmDeleteModal from "@components/ConfirmDeleteModal";
import ConfirmPauseModal from "@components/ConfirmPauseModal";
import DataSourceItemActionsMenu from "@components/DataSourceItemActionsMenu";
import DataSourceItemPreviewModal from "@components/DataSourceItemPreviewModal";
import DataSourceItemTitle from "@components/DataSourceItemTitle";

import styles from "./ContributionsChart.module.css";
import { statisticsQuery } from "./statisticsQuery";

const messages = defineMessages({
  returning: {
    id: 'contributionsChart.returningLegend',
    defaultMessage: 'Returning contributions',
    description: 'Chart legend for the bar segment counting contributions from returning end-users',
  },
  new: {
    id: 'contributionsChart.newLegend',
    defaultMessage: 'New contributors',
    description: 'Chart legend for the bar segment counting contributions from first-time contributors',
  },
});

const COLORS: Record<string, string> = {
  returning: 'var(--color-purple-67)',
  new: 'var(--color-orange-59)',
} as const;

type ContributionRowProps = {
  contrib: Contribution;
  onPreview: (c: Contribution) => void;
  onAddToNotebook: (c: Contribution) => void;
  onPause: (c: Contribution) => void;
  onDelete: (c: Contribution) => void;
  onNavigateConversation?: (id?: number) => void;
  onRetry: (c: Contribution) => void;
  onTogglePriorityTier: (c: Contribution) => void;
};

const ContributionBadge = ({ isFirst }: { isFirst: boolean }) => isFirst ? (
  <span className={clsx(styles.badge, styles.firstContribution)}>
    <FormattedMessage
      id="global.contributionFirst"
      defaultMessage="first contribution"
      description="Badge that shows this is an user´s first contribution"
    />
  </span>
 ) : (
  <span className={clsx(styles.badge, styles.returning)}>
    <FormattedMessage
      id="global.contributionReturning"
      defaultMessage="returning"
      description="Badge that shows this is an user´s follow-up contribution"
    />
  </span>
);

const Timestamp = ({ contrib }: { contrib: Contribution }) => {
  const { first_time_contributor } = contrib;

  let date = first_time_contributor ?
    contrib.message.conversation.participant.type === 'ExternalUser' ?
      contrib.message.conversation.participant.first_message_at
      : null
    : contrib.first_contribution_at;

  date = date ? new Date(date).toLocaleDateString() : '-';

  return first_time_contributor ? (
    <FormattedMessage
      id="contributionsChart.joinedDate"
      defaultMessage="<strong>Joined:</strong> {date}"
      description="Contributor´s first message date"
      values={{
        strong: (chunks: React.ReactNode) => <strong key="strong">{chunks}</strong>,
        date,
      }}
    />
    ) : (
    <FormattedMessage
      id="contributionsChart.firstContributionDate"
      defaultMessage="<strong>First contribution:</strong> {date}"
      description="Contributor´s first contribution date"
      values={{
        strong: (chunks: React.ReactNode) => <strong key="strong">{chunks}</strong>,
        date,
      }}
    />
  );
};

const ContributionRow = ({ contrib, onPreview, onAddToNotebook, onTogglePriorityTier, onPause, onDelete, onRetry }: ContributionRowProps) => {
  return (
    <tr>
      <td
        className={styles.rowPreview}
        onClick={() => onPreview(contrib)}
      >
        <div className={styles.rowContent}>
          <div className={styles.titleAndDate}>
            <DataSourceItemTitle
              className={styles.dataSourceItemTitle}
              title={contrib.content}
              syncStatus={contrib.sync_status}
              active={contrib.active}
              priorityTier={contrib.priority_tier}
              onTogglePriorityTier={() => onTogglePriorityTier(contrib)}
            />
          </div>
        </div>
        <div className={styles.rowDetails}>
          <Icon id="user_profile" />
          <strong>{contrib.message.conversation.participant.name}</strong>
          <ContributionBadge isFirst={contrib.first_time_contributor} /> • <Timestamp contrib={contrib} />
        </div>
      </td>
      <td className={clsx('table-date-cell', styles.rowPreview)} onClick={() => onPreview(contrib)}>
        {new Date(contrib.updated_at).toLocaleDateString()}
      </td>
      <td className="table-row-actions">
        <DataSourceItemActionsMenu
          item={contrib}
          onPause={onPause}
          onDelete={onDelete}
          onAddToNotebook={onAddToNotebook}
          onRetry={contrib.sync_status === 'error' ? onRetry : undefined}
          onPreview={onPreview}
          conversationId={contrib?.message?.conversation_id}
          onTogglePriorityTier={onTogglePriorityTier}
          priorityTier={contrib.priority_tier}
        />
      </td>
    </tr>
  );
};

const ContributionsChart = ({ onClose, onSendToTop }: {
  onClose?: () => void,
  onSendToTop?: () => void,
}) => {
  const hub = useSession().currentHub();
  const hubId = useSession().currentHubId();
  const intl = useIntl();
  const isInTabletRange = useIsInTabletRange();
  const navigate = useNavigate();
  const hubPath = useHubPath();

  const { data, isPending } = useQuery({
    ...statisticsQuery({ hubId, fields: ['contributions_by_contributor'], groupBy: 'day', weeks: 1 }),
    enabled: Boolean(hubId),
  });

  const contributionsQuery = useInfiniteScrollQuery<Contribution>({
    queryKey: [`/hubs/${hubId}/contributions`],
    queryFn: (page, perPage) => fetchContributions(hubId!, page, perPage),
    perPage: 20,
    enabled: Boolean(hubId),
  });

  const {
    itemToAddToNotebook,
    setItemToAddToNotebook,
    itemToPreview,
    setItemToPreview,
    itemToPause,
    setItemToPause,
    itemToDelete,
    setItemToDelete,
    handlePauseConfirm,
    handleDeleteConfirm,
    handleRetry,
    handleTogglePreviewPause,
    handleTogglePriorityTier,
  } = useDataSourceItemActions<Contribution>({
    listQueryKeys: [[`/hubs/${hubId}/contributions`]],
    invalidationKeys: [],
    entityType: 'contributions',
  });

  const navigateToConversation = useCallback((conversationId?: number) => {
    if (conversationId) {
      navigate(hubPath(`/conversations/audience/${conversationId}`));
    }
  }, [navigate, hubPath]);

  const names: Record<string, string> = {
    returning: intl.formatMessage(messages.returning),
    new: intl.formatMessage(messages.new),
  };

  const tooltipFormatter = useCallback((value: ValueType | undefined, name: NameType | undefined, entry: TooltipPayloadEntry) => {
    if (typeof value !== 'number' || typeof entry.dataKey !== 'string') return null;
    return renderTooltipRow(entry.dataKey, COLORS[entry.dataKey], `${intl.formatNumber(value)} ${name}`);
  }, [intl]);

  if (isPending || contributionsQuery.isPending) return null;

  const { contribution_audience, contribution_code, contribution_workflow_mode } = hub!;

  const contributionsFromNewContributors = data?.contributions_by_contributor?.reduce((acc, day) => acc + day.new, 0) ?? 0;
  const contributionsFromReturningContributors = data?.contributions_by_contributor?.reduce((acc, day) => acc + day.returning, 0) ?? 0;

  const legend: LegendItem[] = [
    { key: 'returning', color: COLORS.returning, label: intl.formatMessage(messages.returning) },
    { key: 'new', color: COLORS.new, label: intl.formatMessage(messages.new) },
  ];

  const { from, to } = rollingWeeks(1);
  const title = (
    <FormattedMessage
      id="contributionsChart.title"
      defaultMessage="Community contributions: {from} – {to}"
      description="Title of the expanded community contributions chart, with the period it covers"
      values={{ from: formatDay(from, intl), to: formatDay(to, intl) }}
    />
  );

  // Nothing to chart and nothing to list: the hints left over would all be about a workflow that
  // has never been used
  if (contributionsQuery.items.length === 0 && contributionsFromNewContributors + contributionsFromReturningContributors === 0) {
    return (
      <ExpandedWidget.Empty
        actions={
          <Button
            label={
              <FormattedMessage
                id="global.contributionWorkflow"
                defaultMessage="Contribution workflow"
                description="Reusable label for the settings deciding who can contribute and what happens to contributions"
              />
            }
            size="small"
            themeMode
            onClick={() => navigate(hubPath('/data-sources/contributions/settings'))}
          />
        }
        icon="user_circle_dashed"
        title={title}
        onClose={onClose}
        onSendToTop={onSendToTop}
      >
        <FormattedMessage
          id="contributionsChart.noContributions"
          defaultMessage="Your audience has not contributed anything yet."
          description="Message shown when the chart has no contributions to plot"
        />
      </ExpandedWidget.Empty>
    );
  }

  const goToSettingsButton = (
    <Button
      label={
        <FormattedMessage
          id="global.settings"
          defaultMessage="Settings"
          description="Reusable label for settings buttons and areas"
        />
      }
      size="small"
      themeMode
      onClick={() => navigate(hubPath(`/data-sources/contributions/settings`))}
    />
  );

  return (
    <ExpandedWidget title={title} onClose={onClose} onSendToTop={onSendToTop}>
      <ExpandedWidget.Columns className={styles.contributionsChartColumns}>
        <ExpandedWidget.Column className={styles.chartColumn}>
          <div className={styles.chartAndHintsWrapper}>
            <div className={styles.chartWrapper}>
              <BarChart
                responsive
                data={data?.contributions_by_contributor}
                height={150}
                margin={CHART_VISUAL_CONSTANTS.MARGINS}
              >
                <CartesianGrid vertical={false} stroke="var(--border-color-chart)" />
                <Tooltip
                  cursor={false}
                  labelFormatter={(label) => formatDay(label, intl)}
                  contentStyle={TOOLTIP_STYLES.CONTENT}
                  itemStyle={TOOLTIP_STYLES.ITEM}
                  labelStyle={TOOLTIP_STYLES.LABEL}
                  formatter={tooltipFormatter}
                />
                <Bar dataKey="returning" stackId="a" fill={COLORS.returning} name={names.returning} />
                <Bar dataKey="new" stackId="a" fill={COLORS.new} name={names.new} />
                <XAxis
                  axisLine={false}
                  dataKey="date"
                  tick={CHART_VISUAL_CONSTANTS.AXIS_TICK}
                  tickFormatter={(value: string) => formatDayShort(value, intl)}
                  tickLine={false}
                  width={CHART_VISUAL_CONSTANTS.AXIS_WIDTH}
                />
                <YAxis
                  allowDecimals={false}
                  tick={CHART_VISUAL_CONSTANTS.AXIS_TICK}
                  axisLine={false}
                  tickLine={false}
                />
              </BarChart>
              { !isInTabletRange && <ExpandedWidget.Legend items={legend} /> }
            </div>
            <div className={styles.hintsWrapper}>
              <HintBox
                type="themeMode"
                iconId="users"
                title={
                  <FormattedMessage
                    id="contributionsChart.contributionsInPastWeek"
                    defaultMessage="{count, plural, one {# contribution in the past week} other {# contributions in the past week}}"
                    description="Summary of the contributions chart, showing the total number of contributions in the past week"
                    values={{ count: contributionsFromNewContributors + contributionsFromReturningContributors }}
                  />
                }
                body={
                  <FormattedMessage
                    id="contributionsChart.returningVsNewHint"
                    defaultMessage="<strong>{returningCount}</strong> from returning end-users and <strong>{firstTimeCount}</strong> from first-time contributors."
                    description="Summary of the contributors profiles, new or returning"
                    tagName="span"
                    values={{
                      returningCount: contributionsFromReturningContributors,
                      firstTimeCount: contributionsFromNewContributors,
                      strong: msg => <strong key="strong">{msg}</strong>,
                    }}
                  />
                }
                actions={isInTabletRange ? goToSettingsButton : undefined}
              />
              { !isInTabletRange && (
                <HintBox
                  type="themeMode"
                  iconId="settings"
                  title={
                    <FormattedMessage
                      id="global.contributionWorkflow"
                      defaultMessage="Contribution workflow"
                      description="Reusable label for the settings deciding who can contribute and what happens to contributions"
                    />
                  }
                  body={
                    <span>
                      { contribution_audience === 'all_end_users' && (
                        <FormattedMessage
                          id="contributionsChart.anyMemberWorkflowHint"
                          defaultMessage="Accepting contributions from <strong>any member</strong> of your audience using the contribution code <strong>{code}</strong>."
                          description="Workflow description that states who can contribute"
                          values={{
                            code: contribution_code,
                            strong: (chunks: React.ReactNode) => <strong key="strong">{chunks}</strong>,
                          }}
                        />
                      )}
                      { contribution_audience === 'trusted_end_users' && (
                        <FormattedMessage
                          id="contributionsChart.trustedUsersWorkflowHint"
                          defaultMessage="Accepting contributions from <strong>an allowlist</strong> of trusted end-users using the contribution code <strong>{code}</strong>."
                          description="Workflow description that states who can contribute"
                          values={{
                            code: contribution_code,
                            strong: (chunks: React.ReactNode) => <strong key="strong">{chunks}</strong>,
                          }}
                        />
                      )}
                      {' '}
                      { contribution_workflow_mode === 'review' && (
                        <FormattedMessage
                          id="contributionsChart.contributionWorkflowModePaused"
                          defaultMessage="Contributions are added as <strong>paused</strong> and available to review and publish."
                          description="Workflow description that states how contributions are handled when the workflow mode is paused"
                          values={{
                            strong: (chunks: React.ReactNode) => <strong key="strong">{chunks}</strong>,
                          }}
                        />
                      )}
                      { contribution_workflow_mode === 'direct' && (
                        <FormattedMessage
                          id="contributionsChart.contributionWorkflowModeDirect"
                          defaultMessage="Contributions are added as <strong>immediately available</strong> to the chatbot to use in responses."
                          description="Workflow description that states how contributions are handled when the workflow mode is direct"
                          values={{
                            strong: (chunks: React.ReactNode) => <strong key="strong">{chunks}</strong>,
                          }}
                        />
                      )}
                    </span>
                  }
                  actions={goToSettingsButton}
                />
              )}
            </div>
          </div>
        </ExpandedWidget.Column>
        <ExpandedWidget.Column tableContainer>
          <ExpandedWidget.Table>
            <thead>
              <tr>
                <th>
                  <FormattedMessage
                    id="global.communityContributions"
                    defaultMessage="Community contributions"
                    description="Reusable label for the tips, reports and knowledge end-users send the chatbot"
                    tagName="h4"
                  />
                </th>
                <th className="table-date-cell" />
                <th className="table-row-actions" />
              </tr>
            </thead>
            <tbody>
              {contributionsQuery.items.map(contribution => (
                <ContributionRow
                  key={contribution.id}
                  contrib={contribution}
                  onPreview={setItemToPreview}
                  onAddToNotebook={setItemToAddToNotebook}
                  onTogglePriorityTier={handleTogglePriorityTier}
                  onPause={setItemToPause}
                  onDelete={setItemToDelete}
                  onNavigateConversation={navigateToConversation}
                  onRetry={handleRetry}
                />
              ))}
            </tbody>
          </ExpandedWidget.Table>
          <ConfirmPauseModal
            open={Boolean(itemToPause)}
            paused={itemToPause?.active === false}
            entityTitle={itemToPause?.content.substring(0, 60)}
            entityType="Contribution"
            onCancel={() => setItemToPause(null)}
            onConfirm={handlePauseConfirm}
          />
          <ConfirmDeleteModal
            open={Boolean(itemToDelete)}
            entityTitle={itemToDelete?.content.substring(0, 60)}
            entityType="Contribution"
            onCancel={() => setItemToDelete(null)}
            onConfirm={handleDeleteConfirm}
          />
          <AddToNotebookModal
            assetId={itemToAddToNotebook?.id}
            assetTitle={itemToAddToNotebook?.content.substring(0, 60)}
            assetType="Contribution"
            open={Boolean(itemToAddToNotebook)}
            onOpenChange={() => setItemToAddToNotebook(null)}
          />
          <DataSourceItemPreviewModal
            open={Boolean(itemToPreview)}
            type="Contribution"
            id={itemToPreview?.id}
            key={itemToPreview?.id}
            onOpenChange={() => setItemToPreview(null)}
            onTogglePause={itemToPreview ? handleTogglePreviewPause : undefined}
            onTogglePriorityTier={itemToPreview ? () => handleTogglePriorityTier(itemToPreview) : undefined}
          />
        </ExpandedWidget.Column>
      </ExpandedWidget.Columns>
    </ExpandedWidget>
  );
};

export default ContributionsChart;
