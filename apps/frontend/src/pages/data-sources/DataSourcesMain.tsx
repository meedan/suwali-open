import { useEffect, useMemo, useRef, useState } from "react";
import { defineMessages, FormattedMessage } from 'react-intl';
import { useLocation, useNavigate, useParams } from "react-router";
import { useQuery, useQueryClient } from '@tanstack/react-query';

import type  { Source } from "@customTypes/source";

import { getLastPath, removeLastPath, setLastPath } from "@helpers/lastPath";

import { fetchSources } from "@services/SourcesService";

import { useSession } from "@root/SessionContext";
import SuwaliErrorBoundary from "@root/SuwaliErrorBoundary";

import { useHubPath } from '@hooks/useHubPath';
import usePageTitle from '@hooks/usePageTitle';
import { useNavigateWithRememberedParams } from "@hooks/useRememberedSearchParams";

import EmptyState from "@ui-components/layout/EmptyState";
import { Layout } from '@ui-components/layout/Layout';

import Fallback from "@layouts/error/Fallback";

import DataSourcesContributionsPanel from "./DataSourcesContributionsPanel";
import DataSourcesContributionsSettings from "./DataSourcesContributionsSettings";
import DataSourcesCreateWizard from "./DataSourcesCreateWizard";
import DataSourcesDocumentsPanel from "./DataSourcesDocumentsPanel";
import DataSourcesSettings from "./DataSourcesSettings";
import DataSourcesSidebar from "./DataSourcesSidebar";
import DataSourcesSummariesPanel from "./DataSourcesSummariesPanel";

const newSourceTitles = defineMessages({
  wordpress_api: {
    id: 'dataSources.newWordpressTitle',
    defaultMessage: 'New WordPress site',
    description: 'Browser page title while adding a WordPress site data source',
  },
  rss_feed: {
    id: 'dataSources.newRssFeedTitle',
    defaultMessage: 'New RSS feed',
    description: 'Browser page title while adding an RSS feed data source',
  },
  uploaded_files: {
    id: 'dataSources.newUploadedFilesTitle',
    defaultMessage: 'Upload files',
    description: 'Browser page title while adding a data source made of uploaded files',
  },
  google_drive_folder: {
    id: 'dataSources.newGoogleDriveTitle',
    defaultMessage: 'New Google Drive folder',
    description: 'Browser page title while adding a Google Drive folder data source',
  },
  website: {
    id: 'dataSources.newWebsiteTitle',
    defaultMessage: 'New blog or website',
    description: 'Browser page title while adding a blog or website data source',
  },
});

export type DataSourcesPage = 'summary' | 'contribution' | 'new' | 'settings'| 'contributions_settings';

type DataSourcesMainprops = {
  // FIXME: Improve naming. Maybe activeAssetType -> activePanel, activeTab, activePage??
  activeAssetType?: DataSourcesPage;
};

const DataSourcesMain = ({ activeAssetType }: DataSourcesMainprops) => {
  const [selectedSource, setSelectedSource] = useState<Source | null>(null);
  const [mobileTab, setMobileTab] = useState('mobile-main');
  const session = useSession();
  const mainColumnRef = useRef<HTMLElement>(null);

  const [newSourceType, setNewSourceType] = useState<string | null>(null);

  if (activeAssetType !== 'new' && newSourceType !== null) setNewSourceType(null);

  const pageTitle = (() => {
    if (activeAssetType === 'new') {
      const typeTitle = newSourceType && newSourceTitles[newSourceType as keyof typeof newSourceTitles];
      return typeTitle ? <FormattedMessage {...typeTitle} /> : (
        <FormattedMessage
          id="global.newDataSource"
          defaultMessage="New data source"
          description="Generic label or title for adding a new source of documents"
        />
      );
    }
    if (activeAssetType === 'summary') {
      return (
        <FormattedMessage
          id="global.notebooksPageTitle"
          defaultMessage="Notebooks"
          description="Browser Page title for the notebooks page"
        />
      );
    }
    if (activeAssetType === 'contribution') {
      return (
        <FormattedMessage
          id="global.communityContributions"
          defaultMessage="Community contributions"
          description="Reusable label for the tips, reports and knowledge end-users send the chatbot"
        />
      );
    }
    if (activeAssetType === 'contributions_settings') {
      return (
        <FormattedMessage
          id="global.communityContributions"
          defaultMessage="Community contributions"
          description="Reusable label for the tips, reports and knowledge end-users send the chatbot"
        />
      );
    }
    if (selectedSource) return <>{selectedSource.name}</>;
    return (
      <FormattedMessage
        id="global.dataSources"
        defaultMessage="Data sources"
        description="Reusable label for Data Sources page or list title"
      />
    );
  })();

  usePageTitle(pageTitle);

  const hubId = session.currentHubId();
  const hubPath = useHubPath();
  const params = useParams();
  const location = useLocation();
  const navigate = useNavigate();
  const navigateWithRemembered = useNavigateWithRememberedParams(hubId);

  const { isPending, data } = useQuery({
    queryKey: [`/hubs/${hubId}/sources`],
    queryFn: () => fetchSources(hubId!),
    enabled: Boolean(hubId),
    throwOnError: true,
  });

  const sources = useMemo(() => data || [], [data]);
  const queryClient = useQueryClient();

  const refetchSources = async () => {
    // Await refetch to ensure the sources list is updated before navigating to a new source
    await queryClient.invalidateQueries({ queryKey: [`/hubs/${hubId}/sources`] });
    // Refresh hub data to update capabilities (e.g., external_data_sources_count)
    await queryClient.invalidateQueries({ queryKey: [`/hubs/${hubId}`]});
  };

  const handleSourceSaved = async (sourceId: number) => {
    await refetchSources();
    navigate(hubPath(`/data-sources/${sourceId}`));
  };

  useEffect(() => {
    if (isPending) return;

    const setupSelectedAsset = (sourceId: string) => {
      let selected = null;
      let lastPath = null;

      if (sourceId) {
        selected = sources.find((s: Source) => s.id === parseInt(sourceId, 10));
      } else {
        lastPath = getLastPath('dataSourcesLastPath', hubId);
      }

      const lastPathIsAssetType =
        lastPath?.startsWith('/data-sources/contributions') ||
        lastPath?.startsWith('/data-sources/summaries') ||
        lastPath?.startsWith('/data-sources/new');

      // A permalink would reopen its item's preview on every later visit, so remember the list it belongs to instead
      const pathname = params.itemId
        ? window.location.pathname.replace(/(\/documents)?\/[^/]+$/, '')
        : window.location.pathname;
      const pathWithParams = location.search ? `${pathname}${location.search}` : pathname;

      if (activeAssetType && activeAssetType !== 'settings' && activeAssetType !== 'contributions_settings') {
        setSelectedSource(null);
        if (activeAssetType !== 'new') {
          setLastPath('dataSourcesLastPath', hubId, pathWithParams);
        }
      } else if (activeAssetType === 'settings' || activeAssetType === 'contributions_settings') {
        // Don't update lastPath for settings pages, just set the source
        if (activeAssetType === 'settings' && sourceId) {
          const selected = sources.find((s: Source) => s.id === parseInt(sourceId, 10));
          setSelectedSource(selected || null);
        } else {
          setSelectedSource(null);
        }
      } else if (sources.length === 0 && !lastPathIsAssetType) {
        navigate(hubPath('/data-sources'), { replace: true });
        removeLastPath('dataSourcesLastPath', hubId);
        setSelectedSource(null);
      } else if (selected) {
        setSelectedSource(selected);
        setMobileTab('mobile-main');
        // Only save lastPath if not on a settings page
        if (activeAssetType !== 'settings' && activeAssetType !== 'contributions_settings') {
          setLastPath('dataSourcesLastPath', hubId, pathWithParams);
        }
      } else if (lastPath) {
        navigate(hubPath(lastPath), { replace: true });
      } else {
        navigate(hubPath(`/data-sources/${sources[0].id}`), { replace: true });
        setMobileTab('mobile-main');
      }
    };

    setupSelectedAsset(params.sourceId || '');
  }, [params.sourceId, params.itemId, sources, isPending, navigate, activeAssetType, location.search, hubId, hubPath]);

  // Reset scroll position when switching between sources or asset types
  useEffect(() => {
    if (mainColumnRef.current) {
      mainColumnRef.current.scrollTop = 0;
    }
  }, [selectedSource?.id, activeAssetType]);

  return (
    <Layout mobileTab={mobileTab} onMobileTabChange={setMobileTab}>
      <Layout.Left
        name={
          <FormattedMessage
            id="global.sources"
            defaultMessage="Sources"
            description="Generic title or label shortened version of data sources"
          />
        }
      >
        <div className="layout-left-column-content">
          <SuwaliErrorBoundary fallback={<Fallback actions={['tryAgain']} />}>
            <DataSourcesSidebar
              activeSourceId={selectedSource?.id || null}
              activeAssetType={activeAssetType}
              isPending={isPending}
              sources={sources}
              onSourceSelect={(source) => {
                navigateWithRemembered(`/data-sources/${source.id}`);
              }}
              onNotebooksClick={() => {
                setSelectedSource(null);
                setMobileTab('mobile-main');
                navigateWithRemembered(`/data-sources/summaries`);
              }}
              onCommunityClick={() => {
                setSelectedSource(null);
                setMobileTab('mobile-main');
                navigateWithRemembered(`/data-sources/contributions`);
              }}
            />
          </SuwaliErrorBoundary>
        </div>
      </Layout.Left>
      <Layout.Main
        className="layout-main-column-table"
        ref={mainColumnRef}
        name={
          <FormattedMessage
            id="global.details"
            defaultMessage="Details"
            description="Label for interaction when the user selects this item it will show the details of the associated area"
          />
        }
      >
        <SuwaliErrorBoundary fallback={<Fallback actions={['contactSupport', 'backHome', 'tryAgain']} />}>
          {!isPending && !selectedSource && !activeAssetType && <EmptyState icon="graph" />}
          {!activeAssetType && selectedSource &&
            <DataSourcesDocumentsPanel
              key={selectedSource.id}
              source={selectedSource}
            />
          }
          { activeAssetType === 'summary' && <DataSourcesSummariesPanel /> }
          { activeAssetType === 'contribution' && <DataSourcesContributionsPanel /> }
          { activeAssetType === 'new' && (
            <div className="layout-main-column-scrollable-area">
              <DataSourcesCreateWizard
                title={
                  <FormattedMessage
                    id="dataSourcesCreateWizard.title"
                    defaultMessage="Add a new data source"
                    description="Title for the data sources create wizard"
                  />
                }
                onCreate={handleSourceSaved}
                onTypeChange={setNewSourceType}
              />
            </div>
          )}
          { activeAssetType === 'settings' && selectedSource && (
            <DataSourcesSettings
              key={selectedSource.id}
              source={selectedSource}
              onCreate={handleSourceSaved}
            />
          )}
          { activeAssetType === 'contributions_settings' && <DataSourcesContributionsSettings /> }
        </SuwaliErrorBoundary>
      </Layout.Main>
    </Layout>
  );
};

export default DataSourcesMain;
