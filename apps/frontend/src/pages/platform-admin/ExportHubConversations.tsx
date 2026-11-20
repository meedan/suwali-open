import { useState } from 'react';
import { defineMessages, FormattedMessage, useIntl } from 'react-intl';
import { useSearchParams } from 'react-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';

import { fetchAdminHubs } from '@services/AdminService';
import { fetchLatestBulkConversationExport, requestBulkConversationExport } from '@services/ConversationsService';

import usePageTitle from '@hooks/usePageTitle';
import { useToast } from '@hooks/useToast';

import Button, { ButtonLink } from '@ui-components/input/Button';
import Icon from '@ui-components/layout/Icon';
import { PanelLoading } from '@ui-components/layout/LoadingIndicator';

import styles from './Dashboard.module.css';
import HubConversationsExportTable from './HubConversationsExportTable';
import HubSelect from './HubSelect';
import pageStyles from './MessageReportsExport.module.css';

const POLLING_INTERVAL = 3000;

const positiveInteger = (value: string | null) => (value && /^[1-9]\d*$/.test(value) ? value : null);

const messages = defineMessages({
  backLink: {
    id: 'global.adminDashboardTitle',
    defaultMessage: 'Admin dashboard',
    description: 'Title for the admin dashboard page or link to the dashboard',
  },
  hubLabel: {
    id: 'admin.exportHubConversations.hubLabel',
    defaultMessage: 'Hub',
    description: 'Accessible name of the hub selector on the export hub conversations page',
  },
  requestError: {
    id: 'admin.exportHubConversations.requestError',
    defaultMessage: 'Could not start the export. Please try again.',
    description: 'Toast shown when requesting an export of a hub’s conversations fails',
  },
  downloadError: {
    id: 'admin.exportHubConversations.downloadError',
    defaultMessage: 'Could not download the export. Please try again.',
    description: 'Toast shown when a hub’s conversations export cannot be downloaded',
  },
});

const ExportHubConversations = () => {
  const intl = useIntl();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [searchParams, setSearchParams] = useSearchParams();
  const hubId = positiveInteger(searchParams.get('hub_id'));
  const [requesting, setRequesting] = useState(false);
  const [downloading, setDownloading] = useState(false);

  usePageTitle(
    <FormattedMessage
      id="admin.exportHubConversationsLabel"
      defaultMessage="Export hub conversations"
      description="Label for the button that opens the export hub conversations page, and that page’s title"
    />
  );

  const { data: hubs } = useQuery({
    queryKey: ['/admin/hubs'],
    queryFn: fetchAdminHubs,
    staleTime: 5 * 60 * 1000,
  });

  const latestExportKey = [`/hubs/${hubId}/conversations/bulk-export/latest`];
  const { data: latestExport, isError, isPending, refetch } = useQuery({
    queryKey: latestExportKey,
    queryFn: () => fetchLatestBulkConversationExport(Number(hubId)),
    enabled: hubId !== null,
    refetchInterval: (query) => (query.state.data?.status === 'pending' ? POLLING_INTERVAL : false),
  });

  // A ready export past its TTL has no URL until the hourly cleanup marks it expired
  const downloadable = latestExport?.status === 'ready' && Boolean(latestExport.download_url);

  // The hub lives in the URL so it survives a refresh and can be linked to from the hub page
  const onPickHub = (id: string) => {
    setSearchParams({ hub_id: id }, { replace: true });
  };

  const onExport = async () => {
    setRequesting(true);
    try {
      queryClient.setQueryData(latestExportKey, await requestBulkConversationExport(Number(hubId)));
    } catch {
      toast('error', intl.formatMessage(messages.requestError));
    } finally {
      setRequesting(false);
    }
  };

  // Presigned URLs can die before their expiry, so one is fetched fresh for every download
  const onDownload = async () => {
    setDownloading(true);
    try {
      const { data: freshExport, isError: refetchFailed } = await refetch();
      if (refetchFailed) {
        toast('error', intl.formatMessage(messages.downloadError));
      } else if (freshExport?.download_url) {
        window.location.assign(freshExport.download_url);
      }
    } finally {
      setDownloading(false);
    }
  };

  return (
    <main className={styles.adminDashboardContainer}>
      <header>
        <div className={pageStyles.titleRow}>
          <ButtonLink
            aria-label={intl.formatMessage(messages.backLink)}
            className={pageStyles.backButton}
            iconLeft={<Icon id="arrow_left" aria-hidden />}
            size="large"
            themeMode
            variant="filled"
            to="/platform-admin"
          />
          <FormattedMessage
            id="admin.exportHubConversationsLabel"
            defaultMessage="Export hub conversations"
            description="Label for the button that opens the export hub conversations page, and that page’s title"
            tagName="h1"
          />
        </div>
      </header>
      <section>
        <fieldset className="form-sections">
          <HubSelect
            hubs={hubs ?? []}
            onPick={onPickHub}
            triggerLabel={intl.formatMessage(messages.hubLabel)}
            value={hubId ?? ''}
          />
        </fieldset>
        <div className={pageStyles.buttonWrapper}>
          <Button
            label={
              <FormattedMessage
                id="admin.exportHubConversations.export"
                defaultMessage="Export conversations"
                description="Label for the button that starts an export of all of the selected hub’s conversations"
              />
            }
            onClick={onExport}
            disabled={hubId === null || latestExport?.status === 'pending' || requesting}
            size="medium"
          />
          {downloadable && (
            <Button
              label={
                <FormattedMessage
                  id="admin.exportHubConversations.download"
                  defaultMessage="Download CSV"
                  description="Label for the button that downloads the selected hub’s latest conversations export"
                />
              }
              onClick={onDownload}
              disabled={downloading}
              size="medium"
            />
          )}
        </div>
      </section>
      <section>
        {hubId === null && (
          <FormattedMessage
            id="admin.exportHubConversations.pickHub"
            defaultMessage="Select a hub to export its conversations."
            description="Shown on the export hub conversations page until a hub is selected"
            tagName="p"
          />
        )}
        {hubId !== null && isPending && <PanelLoading />}
        {/* A failed download refetch keeps the cached export; its toast reports the failure */}
        {hubId !== null && isError && latestExport === undefined && (
          <FormattedMessage
            id="admin.exportHubConversations.loadFailed"
            defaultMessage="Could not load the latest export."
            description="Error shown when the latest export of the selected hub’s conversations fails to load"
            tagName="p"
          />
        )}
        {hubId !== null && latestExport !== undefined && (
          <HubConversationsExportTable latestExport={latestExport} downloadable={downloadable} />
        )}
      </section>
    </main>
  );
};

export default ExportHubConversations;
