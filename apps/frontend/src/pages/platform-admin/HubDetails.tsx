import type { ReactNode } from 'react';
import { useState } from 'react';
import { defineMessages, FormattedDate, FormattedMessage, useIntl } from 'react-intl';
import { useNavigate, useParams } from 'react-router';
import { useQueries, useQueryClient } from '@tanstack/react-query';

import { isUnavailableError } from '@helpers/http';
import { hubPath } from '@helpers/hubPath';
import { getStatusTooltip, getTrialStatus, utcDateFormatOptions } from '@helpers/platform-admin';

import { fetchAdminHubActivity, fetchAdminHubDetail, fetchAdminHubMemberships, updateAdminHub } from '@services/AdminService';

import { useSession } from '@root/SessionContext';

import usePageTitle from '@hooks/usePageTitle';
import { useToast } from '@hooks/useToast';

import Button, { ButtonLink } from '@ui-components/input/Button';
import Checkbox from '@ui-components/input/Checkbox';
import Icon from '@ui-components/layout/Icon';
import { PanelLoading } from '@ui-components/layout/LoadingIndicator';

import { Can } from '@components/Can';
import CopyToClipboardButton from '@components/CopyToClipboardButton';

import DeleteHubModal from './DeleteHubModal';
import HubActivityTimeline from './HubActivityTimeline';
import HubDataSources from './HubDataSources';
import styles from './HubDetails.module.css';
import HubEditorsTable from './HubEditorsTable';
import HubMessaging from './HubMessaging';
import HubMilestoneProgress from './HubMilestoneProgress';
import StatusLegend from './StatusLegend';
import StatusValue from './StatusValue';
import UpdateCustomLimitsModal, { type LimitField } from './UpdateCustomLimitsModal';
import UpdatePlanModal from './UpdatePlanModal';
import UpdateTrialEndDateModal from './UpdateTrialEndDateModal';

const messages = defineMessages({
  backLink: {
    id: 'global.adminDashboardTitle',
    defaultMessage: 'Admin dashboard',
    description: 'Title for the admin dashboard page or link to the dashboard',
  },
  editPlan: {
    id: 'admin.updatePlanModal.title',
    defaultMessage: 'Update plan?',
    description: 'Title of the modal for updating a hub plan',
  },
  editTrialEndDate: {
    id: 'admin.updateTrialEndDateModal.title',
    defaultMessage: 'Update trial end date?',
    description: 'Title of the modal for updating a hub trial end date',
  },
  copyHubIdSuccess: {
    id: 'admin.hubDetail.copyHubIdSuccess',
    defaultMessage: 'Hub ID copied to clipboard.',
    description: 'Toast shown when the hub ID is successfully copied to the clipboard',
  },
  trialEmailsError: {
    id: 'admin.hubDetailTrialEmailsError',
    defaultMessage: 'Failed to update trial emails setting. Please try again.',
    description: 'Toast shown when toggling trial emails fails',
  },
});

const HubDetails = () => {
  const { hubId } = useParams<{ hubId: string }>();
  const session = useSession();
  const navigate = useNavigate();
  const intl = useIntl();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [planModalOpen, setPlanModalOpen] = useState(false);
  const [deleteModalOpen, setDeleteModalOpen] = useState(false);
  const [trialEndDateModalOpen, setTrialEndDateModalOpen] = useState(false);
  const [editingLimitField, setEditingLimitField] = useState<LimitField | null>(null);

  const [hubQuery, membershipsQuery, activityQuery] = useQueries({
    queries: [
      { queryKey: ['/admin/hubs', hubId], queryFn: () => fetchAdminHubDetail(Number(hubId)), enabled: !!hubId, staleTime: 5 * 60 * 1000, throwOnError: isUnavailableError },
      { queryKey: ['/admin/hubs', hubId, 'memberships'], queryFn: () => fetchAdminHubMemberships(Number(hubId)), enabled: !!hubId, staleTime: 5 * 60 * 1000 },
      { queryKey: ['/admin/hubs', hubId, 'activity'], queryFn: () => fetchAdminHubActivity(Number(hubId)), enabled: !!hubId, staleTime: 5 * 60 * 1000 },
    ],
  });

  const hub = hubQuery.data;
  const memberships = membershipsQuery.data ?? [];
  const activity = activityQuery.data ?? [];

  usePageTitle(<>{hub?.name ?? ''}</>);

  let planLabel: ReactNode = null;

  if (hub) {
    if (hub.trial_expired) {
      planLabel = hub.plan === 'free_unrestricted'
        ? (
          <FormattedMessage
            id="admin.hubDetailTrialUnrestrictedExpired"
            defaultMessage="Free trial (unrestricted) — Expired"
            description="Plan label when an unrestricted free hub trial has expired"
          />
        ) : (
          <FormattedMessage
            id="admin.hubDetailTrialExpired"
            defaultMessage="Free trial — Expired"
            description="Plan label when a hub trial has expired"
          />
        );
    } else if (hub.trial_ends_at) {
      planLabel = hub.plan === 'free_unrestricted'
        ? (
          <FormattedMessage
            id="global.freeTrialUnrestricted"
            defaultMessage="Free trial (unrestricted)"
            description="Plan label for an unrestricted free hub trial"
          />
        ) : (
          <FormattedMessage
            id="global.freeTrial"
            defaultMessage="Free trial"
            description="Label indicating the free trial pricing tier"
          />
        );
    } else {
      planLabel = hub.plan;
    }
  }

  const handleTrialEmailsToggle = async (enabled: boolean) => {
    if (!hub) return;
    try {
      await updateAdminHub(hub.id, { trial_emails_enabled: enabled });
      await queryClient.invalidateQueries({ queryKey: ['/admin/hubs', String(hub.id)] });
    } catch {
      toast('error', intl.formatMessage(messages.trialEmailsError));
    }
  };

  const trialStatus = getTrialStatus(hub?.trial_expired ?? false, hub?.trial_ends_at ?? null);

  if (hubQuery.isPending) return <PanelLoading appLevel />;

  return (
    <main className={styles.adminHubDetailContainer}>
      <header>
        <div className={styles.hubInfo}>
          <ButtonLink
            aria-label={intl.formatMessage(messages.backLink)}
            iconLeft={<Icon id="arrow_left" aria-hidden />}
            size="large"
            themeMode
            variant="filled"
            to="/platform-admin"
          />
          {hub?.id &&
            <CopyToClipboardButton
              label={`#${hub.id}`}
              size="large"
              themeMode
              variant="filled"
              value={String(hub.id)}
              successMessage={intl.formatMessage(messages.copyHubIdSuccess)}
            />
          }
          <hgroup>
            <h1>{hub?.name}</h1>
          </hgroup>
          {hub?.id &&
            <Button
              label={
                <FormattedMessage
                  id="admin.enterHub"
                  defaultMessage="Enter hub"
                  description="Button label to enter a hub as a super-admin"
                />
              }
              size="small"
              onClick={async () => {
                await session.setCurrentHubId(hub.id);
                navigate(hubPath('/dashboard', hub.id));
              }}
            />
          }
          {hub?.id &&
            <ButtonLink
              className={styles.hubInfoNavButton}
              label={<FormattedMessage id="admin.messageReportsLabel" defaultMessage="Message reports" description="Label for the button that opens the message reports page" />}
              to={`/platform-admin/message-reports?hub_id=${hub.id}`}
              size="small"
            />
          }
          {hub?.id &&
            <ButtonLink
              className={styles.hubInfoNavButton}
              label={<FormattedMessage id="admin.exportHubConversationsLabel" defaultMessage="Export hub conversations" description="Label for the button that opens the export hub conversations page, and that page’s title" />}
              to={`/platform-admin/export-hub-conversations?hub_id=${hub.id}`}
              size="small"
            />
          }
          {hub?.deletion_requested_at ? (
            <span className={styles.deletionScheduled}>
              <Icon id="trash" aria-hidden />
              <FormattedMessage
                id="admin.hubDetailDeletionScheduled"
                defaultMessage="Deletion scheduled"
                description="Indicator shown on the hub detail page when the hub is flagged for deletion"
              />
            </span>
          ) : hub?.id && (hub.plan === 'free' || hub.plan === 'free_unrestricted') && (
            <Can action="IS_WRITE_ADMIN">
              <Button
                iconLeft={<Icon id="x" aria-hidden />}
                label={
                  <FormattedMessage
                    id="admin.deleteHub"
                    defaultMessage="Delete hub"
                    description="Button label to delete a hub as a write super-admin"
                  />
                }
                size="small"
                themeMode
                onClick={() => setDeleteModalOpen(true)}
              />
            </Can>
          )}
        </div>
        <StatusLegend className={styles.legend} />
      </header>

      {hub && (
        <>
          <HubMilestoneProgress hub={hub} events={activity} pending={activityQuery.isPending} />
          <div className={styles.sections}>
            <section>
              <FormattedMessage
                id="admin.hubDetailOverviewTitle"
                defaultMessage="Overview"
                description="Title for the overview section on the hub detail page"
                tagName="h2"
              />
              <dl>
                <div>
                  <FormattedMessage
                    id="admin.hubsTablePlan"
                    defaultMessage="Plan"
                    description="Column header for hub plan in the hubs table"
                    tagName="dt"
                  />
                  <dd>{planLabel}</dd>
                  <Can action="IS_WRITE_ADMIN">
                    <Button
                      aria-label={intl.formatMessage(messages.editPlan)}
                      title={intl.formatMessage(messages.editPlan)}
                      iconLeft={<Icon aria-hidden id="pencil" />}
                      size="small"
                      themeMode
                      variant="filled"
                      onClick={() => setPlanModalOpen(true)}
                    />
                  </Can>
                </div>
                {hub.trial_ends_at && (
                  <div>
                    <FormattedMessage
                      id="admin.hubDetailTrialEndDate"
                      defaultMessage="Trial end date"
                      description="Label for the trial end date row on the hub detail page"
                      tagName="dt"
                    />
                    <dd>
                      <StatusValue
                        status={trialStatus}
                        tooltip={trialStatus
                          ? (
                            <FormattedMessage
                              {...getStatusTooltip('trial', trialStatus)}
                              values={{
                                date: (
                                  <time key="date" dateTime={hub.trial_ends_at}>
                                    <FormattedDate value={hub.trial_ends_at} {...utcDateFormatOptions} />
                                  </time>
                                )
                              }}
                            />
                          )
                          : undefined
                        }
                      >
                        <FormattedDate value={hub.trial_ends_at} {...utcDateFormatOptions} />
                      </StatusValue>
                    </dd>
                    <Can action="IS_WRITE_ADMIN">
                      <Button
                        aria-label={intl.formatMessage(messages.editTrialEndDate)}
                        title={intl.formatMessage(messages.editTrialEndDate)}
                        iconLeft={<Icon aria-hidden id="pencil" />}
                        size="small"
                        themeMode
                        variant="filled"
                        onClick={() => setTrialEndDateModalOpen(true)}
                      />
                    </Can>
                  </div>
                )}
                {hub.trial_ends_at && (
                  <div>
                    <FormattedMessage
                      id="admin.hubDetailTrialEmails"
                      defaultMessage="Trial emails"
                      description="Label for the trial drip emails toggle on the hub detail page"
                      tagName="dt"
                    />
                    <dd>
                      <Can action="IS_WRITE_ADMIN">
                        <Checkbox
                          id="trial-emails-enabled"
                          label={
                            <FormattedMessage
                              id="admin.hubDetailTrialEmailsEnabled"
                              defaultMessage="Enabled"
                              description="Checkbox label for enabling trial drip emails"
                            />
                          }
                          value="trial_emails_enabled"
                          checked={hub.trial_emails_enabled}
                          size="small"
                          onChange={(e) => void handleTrialEmailsToggle(e.target.checked)}
                        />
                      </Can>
                    </dd>
                  </div>
                )}
                <div>
                  <FormattedMessage
                    id="global.inviteCode"
                    defaultMessage="Invite code"
                    description="Reusable label for invite code"
                    tagName="dt"
                  />
                  <dd>{hub.invite_code ?? '—'}</dd>
                </div>
              </dl>
            </section>
            <HubDataSources
              hub={hub}
              onEditSources={() => setEditingLimitField('sources')}
              onEditDocuments={() => setEditingLimitField('documents')}
            />
            <HubMessaging
              hub={hub}
              onEditMessages={() => setEditingLimitField('messages')}
            />
          </div>
          <HubEditorsTable
            memberships={memberships}
            deleteUserQueryKey={['/admin/hubs', hubId ?? '', 'memberships']}
            moveSourceHub={(hub.plan === 'free' || hub.plan === 'free_unrestricted') && memberships.length === 1 ? hub : undefined}
          />
          <HubActivityTimeline events={activity} pending={activityQuery.isPending} />
          <UpdatePlanModal
            hubId={hub.id}
            currentPlan={hub.plan}
            open={planModalOpen}
            onOpenChange={setPlanModalOpen}
          />
          <UpdateTrialEndDateModal
            hubId={hub.id}
            currentTrialEndsAt={hub.trial_ends_at}
            open={trialEndDateModalOpen}
            onOpenChange={setTrialEndDateModalOpen}
          />
          <DeleteHubModal
            hubId={hub.id}
            hubName={hub.name}
            open={deleteModalOpen}
            onOpenChange={setDeleteModalOpen}
          />
          <UpdateCustomLimitsModal
            hubId={hub.id}
            currentLimits={hub.custom_limits}
            field={editingLimitField ?? 'sources'}
            open={editingLimitField !== null}
            onOpenChange={(open) => { if (!open) setEditingLimitField(null); }}
          />
        </>
      )}
    </main>
  );
};

export default HubDetails;
