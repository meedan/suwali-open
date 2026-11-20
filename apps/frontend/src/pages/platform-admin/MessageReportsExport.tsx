import { useMemo } from 'react';
import { defineMessages, FormattedMessage, useIntl } from 'react-intl';
import { useSearchParams } from 'react-router';
import { keepPreviousData, useQuery } from '@tanstack/react-query';

import { fetchAdminHubs, fetchAdminMessageReports } from '@services/AdminService';

import usePageTitle from '@hooks/usePageTitle';

import Button, { ButtonLink } from '@ui-components/input/Button';
import Icon from '@ui-components/layout/Icon';

import styles from './Dashboard.module.css';
import HubSelect from './HubSelect';
import pageStyles from './MessageReportsExport.module.css';
import MessageReportsTable from './MessageReportsTable';
import tableStyles from './MessageReportsTable.module.css';
import useAdminExport from './useAdminExport';

const ALL_HUBS = '0';

const positiveInteger = (value: string | null) => (value && /^[1-9]\d*$/.test(value) ? value : null);

const messages = defineMessages({
  backLink: {
    id: 'global.adminDashboardTitle',
    defaultMessage: 'Admin dashboard',
    description: 'Title for the admin dashboard page or link to the dashboard',
  },
  hubLabel: {
    id: 'admin.messageReportsExport.hubLabel',
    defaultMessage: 'Hub',
    description: 'Accessible name of the hub selector on the message reports export page',
  },
  allHubs: {
    id: 'admin.messageReportsExport.allHubs',
    defaultMessage: 'All hubs',
    description: 'Option in the hub selector that exports message reports from every hub',
  },
});

const MessageReportsExport = () => {
  const intl = useIntl();
  const [searchParams, setSearchParams] = useSearchParams();
  const hubId = positiveInteger(searchParams.get('hub_id')) ?? ALL_HUBS;
  const page = Number(positiveInteger(searchParams.get('page')) ?? 1);
  const { exportingPath, error, handleExport } = useAdminExport();

  usePageTitle(
    <FormattedMessage
      id="admin.messageReportsExport.pageTitle"
      defaultMessage="Message reports"
      description="Browser page title and heading for the page that lists and exports message reports"
    />
  );

  const { data: hubs } = useQuery({
    queryKey: ['/admin/hubs'],
    queryFn: fetchAdminHubs,
    staleTime: 5 * 60 * 1000,
  });

  const forHub = hubId !== ALL_HUBS;

  const { data: reports, isError } = useQuery({
    queryKey: ['/admin/message-reports', hubId, page],
    queryFn: () => fetchAdminMessageReports({ hubId: forHub ? Number(hubId) : undefined, page }),
    placeholderData: keepPreviousData,
  });

  // The hub and page live in the URL so they survive a refresh and can be shared
  const onPickHub = (id: string) => {
    setSearchParams(id === ALL_HUBS ? {} : { hub_id: id }, { replace: true });
  };

  const setPage = (next: number) => {
    setSearchParams(params => {
      if (next > 1) params.set('page', String(next));
      else params.delete('page');
      return params;
    });
  };

  const hubOptions = useMemo(
    () => [{ id: Number(ALL_HUBS), name: intl.formatMessage(messages.allHubs) }, ...(hubs ?? [])],
    [hubs, intl],
  );

  const onExport = () => {
    handleExport(
      forHub ? `/admin/export/message-reports?hub_id=${hubId}` : '/admin/export/message-reports',
      forHub ? `suwali-message-reports-export-hub-${hubId}` : 'suwali-message-reports-export',
    );
  };

  const exporting = exportingPath !== null;

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
            id="admin.messageReportsExport.pageTitle"
            defaultMessage="Message reports"
            description="Browser page title and heading for the page that lists and exports message reports"
            tagName="h1"
          />
        </div>
      </header>
      <section>
        <fieldset className="form-sections">
          <HubSelect
            disabled={exporting}
            hubs={hubOptions}
            onPick={onPickHub}
            triggerLabel={intl.formatMessage(messages.hubLabel)}
            value={hubId}
          />
        </fieldset>
        <div className={pageStyles.buttonWrapper}>
          <Button
            label={exporting
              ? <FormattedMessage id="admin.exportingLabel" defaultMessage="Exporting…" description="Label for an export button while export is in progress" />
              : <FormattedMessage id="admin.messageReportsExport.download" defaultMessage="Download CSV" description="Label for the button that downloads the message reports CSV" />
            }
            onClick={onExport}
            disabled={exporting}
            size="medium"
          />
        </div>
        {error && <p className={styles.error}>{error}</p>}
      </section>
      <section>
        {isError && (
          <FormattedMessage
            id="admin.messageReportsExport.loadFailed"
            defaultMessage="Could not load message reports."
            description="Error shown when the message reports table fails to load"
            tagName="p"
          />
        )}
        {reports && (
          <>
            <MessageReportsTable reports={reports.data} />
            {reports.pagination.total_pages > 1 && (
              <div className={tableStyles.pager}>
                <Button
                  label={<FormattedMessage id="global.previous" defaultMessage="Previous" description="Generic button or label text for navigating back" />}
                  onClick={() => setPage(page - 1)}
                  disabled={page <= 1}
                  size="small"
                  themeMode={page <= 1}
                />
                <FormattedMessage
                  id="admin.messageReportsExport.pageOf"
                  defaultMessage="Page {page} of {total}"
                  description="Pagination status on the message reports table, where {page} is the current page and {total} the number of pages"
                  values={{ page: reports.pagination.current_page, total: reports.pagination.total_pages }}
                />
                <Button
                  label={<FormattedMessage id="global.next" defaultMessage="Next" description="Generic button or label text for navigating forwards" />}
                  onClick={() => setPage(page + 1)}
                  disabled={page >= reports.pagination.total_pages}
                  size="small"
                  themeMode={page >= reports.pagination.total_pages}
                />
              </div>
            )}
          </>
        )}
      </section>
    </main>
  );
};

export default MessageReportsExport;
