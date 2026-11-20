import React from 'react';
import { defineMessages, FormattedMessage, useIntl } from 'react-intl';
import { useNavigate } from 'react-router';

import type { Contribution } from '@customTypes/contribution';
import type { Notebook } from '@customTypes/notebook';
import type { Source } from '@customTypes/source';

import { fetchContributions } from '@services/ContributionsService';
import { fetchPublishedSummaries } from '@services/SourcesService';

import { useSession } from '@root/SessionContext';

import { useHubPath } from '@hooks/useHubPath';
import { useInfiniteScrollQuery } from '@hooks/useInfiniteScrollQuery';

import Button from "@ui-components/input/Button";
import EmptyState from "@ui-components/layout/EmptyState";
import Icon from '@ui-components/layout/Icon';
import ListHeader from '@ui-components/layout/ListHeader';
import ListItem from '@ui-components/layout/ListItem';
import { ListSkeleton } from '@ui-components/layout/LoadingIndicator';
import Tooltip from '@ui-components/layout/Tooltip';

import { Can } from '@components/Can';
import SourceEntry from '@components/SourceEntry';

import ExternalDataSourcesProgress from '@trial-banners/ExternalDataSourcesProgress';

import CreateExternalDataSourceButton from './CreateExternalDataSourceButton';
import type { DataSourcesPage } from './DataSourcesMain';

const messages = defineMessages({
  systemDataSourceTitle: {
    id: "global.systemDataSources",
    defaultMessage: "System data sources",
    description: "Reusable label for page or list title for data sources that are internal to the system",
  },
  settings: {
    id: 'global.settingsSource',
    defaultMessage: 'Data source settings',
    description: 'Tooltip and label for button to open data source settings',
  },
});

interface DataSourcesSidebarProps {
  sources: Source[];
  activeSourceId: number | null;
  activeAssetType?: DataSourcesPage;
  isPending?: boolean;
  onSourceSelect: (source: Source) => void;
  onCommunityClick: () => void,
  onNotebooksClick: () => void,
};

const DataSourcesSidebar: React.FC<DataSourcesSidebarProps> = ({
  sources,
  activeSourceId,
  activeAssetType,
  isPending = false,
  onSourceSelect,
  onCommunityClick,
  onNotebooksClick,
}) => {
  const intl = useIntl();
  const hubId = useSession().currentHubId();
  const hubPath = useHubPath();
  const navigate = useNavigate();

  const summariesQuery = useInfiniteScrollQuery<Notebook>({
    queryKey: [`/hubs/${hubId}/notebooks?published=true`],
    queryFn: (page, perPage) => fetchPublishedSummaries(hubId, page, perPage),
    perPage: 20,
    enabled: Boolean(hubId),
  });

  const contributionsQuery = useInfiniteScrollQuery<Contribution>({
    queryKey: [`/hubs/${hubId}/contributions`],
    queryFn: (page, perPage) => fetchContributions(hubId!, page, perPage),
    perPage: 20,
    enabled: Boolean(hubId),
  });

  const summariesTotalCount = summariesQuery.pagination?.total_count || 0;
  const contributionsTotalCount = contributionsQuery.pagination?.total_count || 0;

  return (
    <>
      <div className="layout-left-column-scrollable-area">
        <ListHeader
          count={2} // 2 for hardcoded entries (contributions, notebooks)
          sticky
          title={intl.formatMessage(messages.systemDataSourceTitle)}
        />
        <ListItem
          caption={
            <FormattedMessage
              id="global.dataSourcesSidebareditorNotebookCount"
              defaultMessage="{count, plural, =0 {0 Summaries} one {1 Summary} other {# Summaries}}"
              description="Caption with count of notebook summaries"
              values={{ count: summariesTotalCount }}
            />
          }
          isActive={activeAssetType === 'summary'}
          icon={<Icon aria-hidden id="notebook_source" />}
          title={
            <FormattedMessage
              id="global.dataSourcesSidebareditorNotebooks"
              defaultMessage="Notebook summaries"
              description="Title for source of notebooks in the system"
            />
          }
          onClick={onNotebooksClick}
        />
        <ListItem
          caption={
            <FormattedMessage
              id="global.dataSourcesSidebarcontributionsCount"
              defaultMessage="{count, plural, =0 {0 Contributions} one {1 Contribution} other {# Contributions}}"
              description="Caption with count of notebooks"
              values={{ count: contributionsTotalCount }}
            />
          }
          isActive={activeAssetType === 'contribution'}
          icon={<Icon aria-hidden id="users_source" />}
          title={
            <FormattedMessage
              id="global.communityContributions"
              defaultMessage="Community contributions"
              description="Reusable label for the tips, reports and knowledge end-users send the chatbot"
            />
          }
          onClick={onCommunityClick}
          hoverAction={
            <Tooltip content={intl.formatMessage(messages.settings)}>
              <Button
                aria-label={intl.formatMessage(messages.settings)}
                className="no-mobile-access"
                iconLeft={<Icon aria-hidden id="settings" />}
                size="small"
                themeMode
                onClick={(e) => {
                  e.stopPropagation();
                  navigate(hubPath('/data-sources/contributions/settings'));
                }}
              />
            </Tooltip>
          }
        />
        <ExternalDataSourcesProgress />
        {isPending && <ListSkeleton count={10} skipHeader />}
        {!isPending && sources.map((source) => (
          <SourceEntry
            key={source.id}
            isActive={source.id === activeSourceId && activeAssetType !== 'settings'}
            source={source}
            onClick={() => onSourceSelect(source)}
            onSettings={() => {
              navigate(hubPath(`/data-sources/${source.id}/settings`));
            }}
          />
        ))}
        {!isPending && !sources.length &&
          <Can action="CREATE_SOURCE">
            <EmptyState
              icon="document_dashed"
              layout="list"
              message={
                <FormattedMessage
                  id="global.dataSourcesSidebarEmptySources"
                  defaultMessage="Create a new data source to import content into the system."
                  description="Empty state message"
                />
              }
              size="small"
            />
          </Can>
        }
      </div>
      <footer className="no-mobile-access">
        <CreateExternalDataSourceButton />
      </footer>
    </>
  );
}

export default DataSourcesSidebar;
