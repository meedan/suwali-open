import { defineMessages, FormattedDate, FormattedMessage, useIntl } from 'react-intl';
import { useParams } from 'react-router';
import { useQuery } from '@tanstack/react-query';

import { isUnavailableError } from '@helpers/http';
import { datetimeFormatOptions } from '@helpers/platform-admin';

import { fetchAdminDeletedHubDetail } from '@services/AdminService';

import usePageTitle from '@hooks/usePageTitle';

import { ButtonLink } from '@ui-components/input/Button';
import Icon from '@ui-components/layout/Icon';
import { PanelLoading } from '@ui-components/layout/LoadingIndicator';

import CopyToClipboardButton from '@components/CopyToClipboardButton';

import HubActivityTimeline from './HubActivityTimeline';
import styles from './HubDetails.module.css';
import HubMilestoneProgress from './HubMilestoneProgress';
import StatusValue from './StatusValue';

const messages = defineMessages({
  backLink: {
    id: 'global.adminDashboardTitle',
    defaultMessage: 'Admin dashboard',
    description: 'Title for the admin dashboard page or link to the dashboard',
  },
  copyHubNameSuccess: {
    id: 'admin.hubDetail.copyHubNameSuccess',
    defaultMessage: 'Hub name copied to clipboard.',
    description: 'Toast shown when the hub name is successfully copied to the clipboard',
  },
});

const DeletedHubDetails = () => {
  const { hubId } = useParams<{ hubId: string }>();
  const intl = useIntl();

  const { data, isPending } = useQuery({
    queryKey: ['/admin/hubs', hubId, 'deleted'],
    queryFn: () => fetchAdminDeletedHubDetail(Number(hubId)),
    enabled: !!hubId,
    staleTime: 5 * 60 * 1000,
    throwOnError: isUnavailableError,
  });

  usePageTitle(<>{data?.hub_name ?? ''}</>);

  if (isPending) return <PanelLoading appLevel />;

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
          {data && (
            <CopyToClipboardButton
              iconLeft={<Icon id="trash" aria-hidden />}
              size="large"
              themeMode
              variant="filled"
              value={data?.hub_name}
              successMessage={intl.formatMessage(messages.copyHubNameSuccess)}
            />
          )}
          <hgroup>
            <h1>{data?.hub_name}</h1>
          </hgroup>
        </div>
      </header>

      {data && (
        <>
          <HubMilestoneProgress hub={{created_at: data.created_at}} events={data.activity} />
          <section>
            <FormattedMessage
              id="global.overview"
              defaultMessage="Overview"
              description="Title for the overview section"
              tagName="h2"
            />
            <dl>
              <div>
                <FormattedMessage
                  id="global.organization"
                  defaultMessage="Organization"
                  description="Generic label or title for an organization in the system items"
                  tagName="dt"
                />
                <dd>{data.organization_name ?? '—'}</dd>
              </div>
              <div>
                <FormattedMessage
                  id="global.planAtDeletion"
                  defaultMessage="Plan at deletion"
                  description="Label for the hub’s plan at the time it was deleted"
                  tagName="dt"
                />
                <dd>{data.plan_at_deletion}</dd>
              </div>
              <div>
                <FormattedMessage
                  id="global.deleted"
                  defaultMessage="Deleted"
                  description="Generic label or title for deleted items"
                  tagName="dt"
                />
                <dd>
                  <StatusValue status="pink">
                    <FormattedDate value={data.deleted_at} {...datetimeFormatOptions} />
                  </StatusValue>
                </dd>
              </div>
            </dl>
          </section>
          <HubActivityTimeline events={data.activity} />
        </>
      )}
    </main>
  );
};

export default DeletedHubDetails;
