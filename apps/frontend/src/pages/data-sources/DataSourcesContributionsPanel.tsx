import clsx from 'clsx';
import { VisuallyHidden } from 'radix-ui'
import React, { useCallback, useState } from 'react';
import { defineMessages, FormattedMessage, useIntl } from 'react-intl';
import { useNavigate } from 'react-router';

import type { Contribution } from '@customTypes/contribution';

import { getPlatformIcon, getPlatformName, platformIconNeedsInlineSvg } from "@helpers/conversation";

import { fetchContributions } from '@services/ContributionsService';

import { useSession } from '@root/SessionContext';

import { useDataSourceItemActions } from '@hooks/useDataSourceItemActions';
import { useFilterAndSort } from '@hooks/useFilterAndSort';
import { useHubPath } from '@hooks/useHubPath';
import { useInfiniteScrollQuery } from '@hooks/useInfiniteScrollQuery';
import { useRememberedSearchParams } from '@hooks/useRememberedSearchParams';
import { useSignalEnabled } from '@hooks/useSignalEnabled';
import { type Density, useTableDensity } from '@hooks/useTableDensity';

import Button from '@ui-components/input/Button';
import EmptyState from "@ui-components/layout/EmptyState";
import Icon from '@ui-components/layout/Icon';
import { TableSkeleton } from '@ui-components/layout/LoadingIndicator';
import MetaList from '@ui-components/layout/MetaList';
import Tooltip from '@ui-components/layout/Tooltip';

import AddToNotebookModal from '@components/AddToNotebookModal';
import ConfirmDeleteModal from '@components/ConfirmDeleteModal';
import ConfirmPauseModal from '@components/ConfirmPauseModal';
import CopyToClipboardButton from '@components/CopyToClipboardButton';
import DataSourceItemPreviewModal from '@components/DataSourceItemPreviewModal';
import EditableTitle from '@components/EditableTitle';
import SortableHeader from '@components/SortableHeader';
import { SortModal } from '@components/SortModal';

import ActiveFilters from './ActiveFilters';
import DataSourceItemRow, { DataSourceItemTopicsHeader } from './DataSourceItemRow';
import { DataSourcesDocumentsFilter } from './DataSourcesDocumentsFilter';
import styles from './DataSourcesDocumentsPanel.module.css';
import { withTopicsColumn } from './tableColumns';

const messages = defineMessages({
  contributionCodeCopied: {
    id: 'dataSourcesContributionsPanel.contributionCodeCopied',
    defaultMessage: 'Contribution code copied to clipboard',
    description: 'Toast shown when the contribution code is copied to the clipboard',
  },
});

// Priority, contribution, end-user, date modified, actions
const COLUMN_COUNT = 5;

type ContributionPlatform ='whatsapp' | 'telegram' | 'sms' | 'signal' | 'internal';

type ContributionRowProps = {
  contrib: Contribution;
  onPreview: (c: Contribution) => void;
  onAddToNotebook: (c: Contribution) => void;
  onPause: (c: Contribution) => void;
  onDelete: (c: Contribution) => void;
  onNavigateConversation: (id?: number) => void;
  onRetry: (c: Contribution) => void;
  onTogglePriorityTier: (c: Contribution) => void;
  onCopyPermalink: (c: Contribution) => void;
  density: Density;
};

const ContributionRow: React.FC<ContributionRowProps> = React.memo(({
  contrib,
  density,
  onPreview,
  onAddToNotebook,
  onPause,
  onDelete,
  onNavigateConversation,
  onRetry,
  onTogglePriorityTier,
  onCopyPermalink,
}) => (
  <DataSourceItemRow
    item={contrib}
    title={contrib.content}
    density={density}
    topics={contrib.topics}
    columnCount={withTopicsColumn(COLUMN_COUNT, density)}
    onPreview={onPreview}
    onAddToNotebook={onAddToNotebook}
    onPause={onPause}
    onRetry={onRetry}
    onTogglePriorityTier={onTogglePriorityTier}
    onCopyPermalink={onCopyPermalink}
    menuProps={{ onDelete, conversationId: contrib?.message?.conversation_id }}
  >
    <td
      className={clsx(styles.rowPreview, styles.rowUsername)}
      title={contrib?.message?.conversation?.participant?.name}
      onClick={() => onNavigateConversation(contrib?.message?.conversation_id)}
    >
      <span>
        <Icon id={getPlatformIcon(contrib?.message?.conversation?.platform)} inlineSvg={platformIconNeedsInlineSvg(contrib?.message?.conversation?.platform)} aria-label={getPlatformName(contrib?.message?.conversation?.platform)} />
        <span>{contrib?.message?.conversation?.participant?.name}</span>
      </span>
    </td>
  </DataSourceItemRow>
));
ContributionRow.displayName = 'ContributionRow';

const DataSourcesContributionsPanel = ( ) => {
  const intl = useIntl();
  const navigate = useNavigate();
  const session = useSession();
  const signalEnabled = useSignalEnabled();
  // Without internal: contributions only come from end-users, and the filter has no option for it to choose
  const hubPlatforms: ContributionPlatform[] = ['whatsapp', 'telegram', 'sms', ...(signalEnabled ? ['signal' as const] : [])];
  const hubId = session.currentHubId();
  const hub = session.currentHub();
  const hubPath = useHubPath();

  useRememberedSearchParams({
    routeId: '/data-sources/contributions',
    hubId,
    enabled: Boolean(hubId),
  });

  const [filterOpen, setFilterOpen] = useState(false);
  const { currentQuery: filter } = useFilterAndSort({});
  const [density, setDensity] = useTableDensity();
  const columnCount = withTopicsColumn(COLUMN_COUNT, density);

  const {
    itemToAddToNotebook,
    setItemToAddToNotebook,
    previewId,
    closePreview,
    handleTogglePreviewPause,
    handleTogglePreviewPriorityTier,
    handleCopyPermalink,
    openPreview,
    itemToPause,
    setItemToPause,
    itemToDelete,
    setItemToDelete,
    handlePauseConfirm,
    handleDeleteConfirm,
    handleRetry,
    handleTogglePriorityTier,
  } = useDataSourceItemActions<Contribution>({
    listQueryKeys: [[`/hubs/${hubId}/contributions`]],
    invalidationKeys: [],
    entityType: 'contributions',
    permalink: {
      listPath: '/data-sources/contributions',
      itemPath: id => `/data-sources/contributions/${id}`,
    },
  });

  const contributionsQuery = useInfiniteScrollQuery<Contribution>({
    queryKey: [`/hubs/${hubId}/contributions`, `filter:${JSON.stringify(filter)}`],
    queryFn: (page, perPage) => fetchContributions(hubId!, page, perPage, filter),
    perPage: 20,
    enabled: Boolean(hubId),
    keepPreviousData: true,
  });

  const {
    items: contributions,
    observerTarget,
    error,
    isFetchingNextPage,
    isPending,
    pagination,
  } = contributionsQuery;

  const contributionsTotalCount = pagination?.unfiltered_count ?? 0;

  const navigateToConversation = useCallback((conversationId?: number) => {
    if (conversationId) {
      navigate(hubPath(`/conversations/audience/${conversationId}`));
    }
  }, [navigate, hubPath]);

  if (isPending) return <TableSkeleton className="layout-main-column-scrollable-area" rows={20} />;

  // The error is thrown to be caught by the SuwaliErrorBoundary, which will show a fallback UI and report the error to Sentry.
  if (error) throw error;

  return (
    <>
    <div className={clsx('layout-main-column-scrollable-area', styles.tableWrapper)}>
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
        open={Boolean(previewId)}
        type="Contribution"
        id={previewId}
        onOpenChange={closePreview}
        onTogglePause={previewId ? handleTogglePreviewPause : undefined}
        onTogglePriorityTier={previewId ? handleTogglePreviewPriorityTier : undefined}
      />
      <div className={styles.tableHeader}>
        <EditableTitle
          canEdit={false}
          className={styles.tableHeaderTitle}
          displayValue={
            <FormattedMessage
              id="global.dataSourcesSidebarendUserContributions"
              defaultMessage="End-user contributions"
              description="Title for source of documents coming from end-users"
            />
          }
          icon={<Icon key="icon" aria-hidden className="no-mobile-access" id="users_source" />}
          renderMeta={
            <MetaList>
              <FormattedMessage
                id="global.entriesCount"
                defaultMessage="<strong>Entries:</strong> {count}"
                description="Text for the count of entries in the table below"
                values={{
                  count: contributionsTotalCount,
                  strong: msg => <strong key="strong">{msg}</strong>,
                }}
                tagName={MetaList.Item}
              />
              <MetaList.Item>
                <FormattedMessage
                  id="global.contributionCodeMeta"
                  defaultMessage="Contribution code"
                  description="Reusable label for contribution code with a colon"
                  tagName="strong"
                />
                {hub?.contribution_code}
                <CopyToClipboardButton
                  iconLeft={<Icon id="clipboard" aria-hidden />}
                  size="small"
                  variant="filled"
                  themeMode
                  value={hub?.contribution_code}
                  successMessage={intl.formatMessage(messages.contributionCodeCopied)}
                />
              </MetaList.Item>
            </MetaList>
          }
        />
        <div className={styles.tableHeaderButtons}>
          <DataSourcesDocumentsFilter type="contribution" connectedPlatforms={hubPlatforms} open={filterOpen} onOpenChange={setFilterOpen} />
          <SortModal type="contribution" />
          <Tooltip
            content={
              <FormattedMessage
                id="global.settingsSource"
                defaultMessage="Data source settings"
                description="Tooltip and label for button to open data source settings"
              />
            }
          >
            <Button
              label={
                <FormattedMessage
                  id="global.settings"
                  defaultMessage="Settings"
                  description="Reusable label for settings buttons and areas"
                />
              }
              className="no-mobile-access"
              themeMode
              variant="filled"
              size="small"
              iconLeft={<Icon id="settings" aria-hidden />}
              onClick={() => navigate(hubPath('/data-sources/contributions/settings'))}
            />
          </Tooltip>
        </div>
      </div>
      <ActiveFilters type="contribution" connectedPlatforms={hubPlatforms} density={density} onDensityChange={setDensity} resultCount={pagination?.total_count} totalCount={pagination?.unfiltered_count} onEdit={() => setFilterOpen(true)} />
      <table aria-labelledby="tableCaption">
        <VisuallyHidden.Root asChild>
          <caption id="tableCaption">
            <FormattedMessage
              id="dataSourcesContributionsPanel.tableCaption"
              defaultMessage="Table with End-user contributions"
              description="Accessibility caption for the table that shows end-user contributions"
            />
          </caption>
        </VisuallyHidden.Root>
        <thead>
          <tr>
            <SortableHeader type="contribution" sortKey="priority_tier" className="table-priority-cell">
              <Icon id="important_filled" aria-hidden />
              <VisuallyHidden.Root>
                <FormattedMessage
                  id="global.priorityTier"
                  defaultMessage="Priority tier"
                  description="Label for the priority tier"
                />
              </VisuallyHidden.Root>
            </SortableHeader>
            <SortableHeader type="contribution" sortKey="content">
              <FormattedMessage
                id="dataSourcesContributionsPanel.contribution"
                defaultMessage="Contribution"
                description="Column label for the snippet of text that represents that community contribution"
              />
            </SortableHeader>
            <SortableHeader type="contribution" sortKey="user" className={styles.tableHeaderUsernameColumn}>
              <FormattedMessage
                id="global.endUser"
                defaultMessage="End-user"
                description="End-users are members of the audience who interact with the chatbot"
              />
            </SortableHeader>
            <DataSourceItemTopicsHeader density={density} />
            <SortableHeader type="contribution" sortKey="updated_at" className="table-date-cell">
              <FormattedMessage
                id="global.dateModified"
                defaultMessage="Date modified"
                description="Reusable label for the date the item was last modified"
              />
            </SortableHeader>
            <th scope="col" className="table-row-actions">
              <FormattedMessage
                id="global.actions"
                defaultMessage="Actions"
                description="Reusable label for actions list"
              />
            </th>
          </tr>
        </thead>
        <tbody>
        {contributions.length > 0 ? (
          contributions.map((contrib: Contribution) => (
            <ContributionRow
              key={contrib.id}
              contrib={contrib}
              density={density}
              onPreview={openPreview}
              onAddToNotebook={setItemToAddToNotebook}
              onPause={setItemToPause}
              onDelete={setItemToDelete}
              onNavigateConversation={navigateToConversation}
              onRetry={handleRetry}
              onTogglePriorityTier={handleTogglePriorityTier}
              onCopyPermalink={handleCopyPermalink}
            />
          ))
        ) : (
          <tr className={styles.noDocuments}>
            <td colSpan={columnCount}>
              <EmptyState
                actions={<DataSourcesDocumentsFilter type="contribution" connectedPlatforms={hubPlatforms} />}
                icon="user_circle_dashed"
                message={
                  <>
                    <FormattedMessage
                      id="global.dataSourcesContributionsPaneltableEmpty"
                      defaultMessage="There are no end-user contributions."
                      description="Empty message for table with no rows"
                    />
                    <br />
                    <br />
                    <FormattedMessage
                      id="global.dataSourcesContributionsFiltersAttention"
                      defaultMessage="Try a different set of filters to show end-user contributions."
                      description="Empty message to let users know they can change filters"
                    />
                  </>
                }
              />
            </td>
          </tr>
        )}
        </tbody>
        {contributions.length > 0 && (
          <tfoot className={styles.scrollObserver}>
            <tr>
              <td colSpan={columnCount}>
                <span ref={observerTarget} className="scroll-observer-large" />
                {isFetchingNextPage && (
                  <FormattedMessage
                    id="global.loadingMore"
                    defaultMessage="Loading more…"
                    description="Message shown when loading more items"
                    tagName="p"
                  />
                )}
              </td>
            </tr>
          </tfoot>
        )}
      </table>
    </div>
    </>
  );
};

export default DataSourcesContributionsPanel;
