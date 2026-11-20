import clsx from 'clsx';
import { VisuallyHidden } from 'radix-ui'
import React, { useState } from 'react';
import { defineMessages, FormattedMessage, useIntl } from 'react-intl';
import { useQueryClient } from '@tanstack/react-query';

import type { Notebook } from '@customTypes/notebook';

import { getUserFallback } from '@helpers/user';

import { unpublishNotebook } from '@services/NotebooksService';
import { fetchPublishedSummaries } from '@services/SourcesService';

import { useSession } from '@root/SessionContext';

import { useDataSourceItemActions } from '@hooks/useDataSourceItemActions';
import { useFilterAndSort } from '@hooks/useFilterAndSort';
import { useInfiniteScrollQuery } from '@hooks/useInfiniteScrollQuery';
import { useRememberedSearchParams } from '@hooks/useRememberedSearchParams';
import { type Density, useTableDensity } from '@hooks/useTableDensity';
import { useToast } from '@hooks/useToast';

import Avatar from '@ui-components/layout/Avatar';
import EmptyState from "@ui-components/layout/EmptyState";
import Icon from '@ui-components/layout/Icon';
import { TableSkeleton } from '@ui-components/layout/LoadingIndicator';
import MetaList from '@ui-components/layout/MetaList';

import AddToNotebookModal from '@components/AddToNotebookModal';
import ConfirmPauseModal from '@components/ConfirmPauseModal';
import ConfirmPublishModal from '@components/ConfirmPublishModal';
import DataSourceItemPreviewModal from '@components/DataSourceItemPreviewModal';
import EditableTitle from '@components/EditableTitle';
import SortableHeader from '@components/SortableHeader';
import { SortModal } from '@components/SortModal';

import ActiveFilters from './ActiveFilters';
import CollapsibleItemsSection from './CollapsibleItemsSection';
import DataSourceItemRow, { DataSourceItemTopicsHeader } from './DataSourceItemRow';
import { DataSourcesDocumentsFilter } from './DataSourcesDocumentsFilter';
import styles from './DataSourcesDocumentsPanel.module.css';
import { hasTopicsColumn, withTopicsColumn } from './tableColumns';

const messages = defineMessages({
  unpublished: {
    id: 'notebookSummaryPanel.unpublished',
    defaultMessage: 'Unpublished',
    description: 'Confirmation title that appears when the notebook was unpublished',
  },
  unpublishSuccess: {
    id: 'global.notebookUnpublishSuccess',
    defaultMessage: 'Notebook summary unpublished successfully.',
    description: 'Message for successful notebook unpublish action',
  },
  unpublishError: {
    id: 'global.notebookUnpublishError',
    defaultMessage: 'Failed to unpublish notebook summary.',
    description: 'Message for failed notebook unpublish action',
  },
});

// Priority, name, last editor, date modified, actions
const COLUMN_COUNT = 5;

type NotebookRowProps = {
  nb: Notebook;
  onPreview: (n: Notebook) => void;
  onAddToNotebook?: (n: Notebook) => void;
  onPause?: (n: Notebook) => void;
  onUnpublish: (n: Notebook) => void;
  onRetry?: (n: Notebook) => void;
  onTogglePriorityTier?: (n: Notebook) => void;
  onCopyPermalink: (n: Notebook) => void;
  density: Density;
};

const NotebookRow: React.FC<NotebookRowProps> = React.memo(({ nb, density, onPreview, onAddToNotebook, onPause, onUnpublish, onRetry, onTogglePriorityTier, onCopyPermalink }) => (
  <DataSourceItemRow
    item={nb}
    title={nb.name}
    density={density}
    topics={nb.topics}
    columnCount={withTopicsColumn(COLUMN_COUNT, density)}
    onPreview={onPreview}
    onAddToNotebook={onAddToNotebook}
    onPause={onPause}
    onRetry={nb.retryable === false ? undefined : onRetry}
    onTogglePriorityTier={onTogglePriorityTier}
    onCopyPermalink={onCopyPermalink}
    menuProps={{ onUnpublish }}
  >
    <td
      className={clsx(styles.rowPreview, styles.rowUsername)}
      title={nb.summary_updated_by ? (nb.summary_updated_by.name || nb.summary_updated_by.email) : undefined}
      onClick={() => onPreview(nb)}
    >
      {nb.summary_updated_by ? (
        <span>
          <Avatar
            editor
            picture={nb.summary_updated_by?.profile_picture_url}
            name={nb.summary_updated_by?.name}
            fallback={getUserFallback(nb.summary_updated_by?.name, nb.summary_updated_by?.email)}
          />
          <span>{nb.summary_updated_by?.name || nb.summary_updated_by?.email}</span>
        </span>
      ) : <span>—</span>}
    </td>
  </DataSourceItemRow>
));
NotebookRow.displayName = 'NotebookRow';

const DataSourcesSummariesPanel = () => {
  const intl = useIntl();
  const hubId = useSession().currentHubId();
  const queryClient = useQueryClient();
  const { toast } = useToast();

  useRememberedSearchParams({
    routeId: '/data-sources/summaries',
    hubId,
    enabled: Boolean(hubId),
  });

  const [filterOpen, setFilterOpen] = useState(false);
  const { currentQuery: filter } = useFilterAndSort({});
  const [density, setDensity] = useTableDensity();
  const columnCount = withTopicsColumn(COLUMN_COUNT, density);

  // Errors a retry can fix are pulled out of the list into their own section, as for documents
  const syncStatuses = filter.sync_status?.split(',').filter(Boolean);
  const showRetryableErrors = !syncStatuses || syncStatuses.includes('error');
  const mainListSyncStatuses = (syncStatuses ?? ['pending', 'complete', 'error']).filter(s => s !== 'error');
  const mainListFilter = { ...filter, sync_status: mainListSyncStatuses.length > 0 ? mainListSyncStatuses.join(',') : 'unsupported' };
  const retryableErrorsFilter = { ...filter, sync_status: 'error' };

  const {
    itemToAddToNotebook,
    previewId,
    closePreview,
    handleTogglePreviewPause,
    handleRetryPreview,
    handleTogglePreviewPriorityTier,
    handleCopyPermalink,
    openPreview,
    setItemToAddToNotebook,
    itemToPause,
    setItemToPause,
    handlePauseConfirm,
    handleRetry,
    handleTogglePriorityTier,
  } = useDataSourceItemActions<Notebook>({
    listQueryKeys: [[`/hubs/${hubId}/notebooks?published=true`]],
    invalidationKeys: [],
    entityType: 'notebooks',
    permalink: {
      listPath: '/data-sources/summaries',
      itemPath: id => `/data-sources/summaries/${id}`,
    },
  });

  const [notebookToUnpublish, setNotebookToUnpublish] = useState<Notebook | null>(null);

  const {
    items: summaries,
    observerTarget,
    isFetchingNextPage,
    pagination,
    isPending,
  } = useInfiniteScrollQuery<Notebook>({
    queryKey: [`/hubs/${hubId}/notebooks?published=true`, `filter:${JSON.stringify(mainListFilter)}`],
    queryFn: (page, perPage) => fetchPublishedSummaries(hubId, page, perPage, mainListFilter),
    perPage: 20,
    enabled: Boolean(hubId),
    keepPreviousData: true,
  });

  const { items: retryableErrorSummaries } = useInfiniteScrollQuery<Notebook>({
    queryKey: [`/hubs/${hubId}/notebooks?published=true`, 'retryable-errors', `filter:${JSON.stringify(retryableErrorsFilter)}`],
    queryFn: (page, perPage) => fetchPublishedSummaries(hubId, page, perPage, retryableErrorsFilter),
    perPage: 100,
    enabled: Boolean(hubId) && showRetryableErrors,
  });

  const hasRetryableErrors = showRetryableErrors && retryableErrorSummaries.length > 0;

  if (isPending) return <TableSkeleton className="layout-main-column-scrollable-area" rows={20} />;

  const summariesTotalCount = pagination?.unfiltered_count ?? 0;

  return (
    <>
    <div className={clsx('layout-main-column-scrollable-area', styles.tableWrapper)}>
      <ConfirmPauseModal
        open={Boolean(itemToPause)}
        paused={itemToPause?.active === false}
        entityTitle={itemToPause?.name}
        entityType="Notebook"
        onCancel={() => setItemToPause(null)}
        onConfirm={handlePauseConfirm}
      />
      <AddToNotebookModal
        assetId={itemToAddToNotebook?.id}
        assetTitle={itemToAddToNotebook?.name}
        assetType="Notebook"
        open={Boolean(itemToAddToNotebook)}
        onOpenChange={() => setItemToAddToNotebook(null)}
      />
      <DataSourceItemPreviewModal
        open={Boolean(previewId)}
        id={previewId}
        type="Notebook"
        onOpenChange={closePreview}
        onRetry={previewId ? handleRetryPreview : undefined}
        onTogglePause={previewId ? handleTogglePreviewPause : undefined}
        onTogglePriorityTier={previewId ? handleTogglePreviewPriorityTier : undefined}
      />
      <ConfirmPublishModal
        open={Boolean(notebookToUnpublish)}
        published
        title={notebookToUnpublish?.name}
        onCancel={() => setNotebookToUnpublish(null)}
        onConfirm={async () => {
          if (notebookToUnpublish) {
            try {
              await unpublishNotebook(notebookToUnpublish.id);
              queryClient.invalidateQueries({ queryKey: [`/hubs/${hubId}/notebooks?published=true`] });
              setNotebookToUnpublish(null);
              toast('success', intl.formatMessage(messages.unpublishSuccess), intl.formatMessage(messages.unpublished));
            } catch {
              toast('error', intl.formatMessage(messages.unpublishError));
            }
          }
        }}
      />
      <div className={styles.tableHeader}>
        <EditableTitle
          canEdit={false}
          className={styles.tableHeaderTitle}
          displayValue={
            <FormattedMessage
              id="global.dataSourcesSummariesPanelnotebooks"
              defaultMessage="Notebook summaries"
              description="Title for the Notebook summaries list"
            />
          }
          icon={<Icon key="icon" aria-hidden className="no-mobile-access" id="notebook_source" />}
          renderMeta={
            <MetaList>
              <FormattedMessage
                id="global.entriesCount"
                defaultMessage="<strong>Entries:</strong> {count}"
                description="Text for the count of entries in the table below"
                values={{
                  count: summariesTotalCount,
                  strong: msg => <strong key="strong">{msg}</strong>,
                }}
                tagName={MetaList.Item}
              />
            </MetaList>
          }
        />
        <div className={styles.tableHeaderButtons}>
          <DataSourcesDocumentsFilter type="summary" open={filterOpen} onOpenChange={setFilterOpen} />
          <SortModal type="summary" />
        </div>
      </div>
      <ActiveFilters type="summary" density={density} onDensityChange={setDensity} resultCount={pagination?.total_count} totalCount={pagination?.unfiltered_count} onEdit={() => setFilterOpen(true)} />
      <table aria-labelledby="tableCaption">
        <VisuallyHidden.Root asChild>
          <caption id="tableCaption">
            <FormattedMessage
              id="dataSourcesSummariesPanel.tableCaption"
              defaultMessage="Table with notebook summaries"
              description="Accessibility caption for the table that shows documents and the type of documents they are"
            />
          </caption>
        </VisuallyHidden.Root>
        <thead>
          <tr>
            <SortableHeader type="summary" sortKey="priority_tier" className="table-priority-cell">
              <Icon id="important_filled" aria-hidden />
              <VisuallyHidden.Root>
                <FormattedMessage
                  id="global.priorityTier"
                  defaultMessage="Priority tier"
                  description="Label for the priority tier"
                />
              </VisuallyHidden.Root>
            </SortableHeader>
            <SortableHeader type="summary" sortKey="title">
              <FormattedMessage
                id="dataSourcesSummariesPanel.notebookName"
                defaultMessage="Notebook name"
                description="Column label for the name of notebook listed in table"
              />
            </SortableHeader>
            <SortableHeader type="summary" sortKey="last_summary_updated_by_id" className={styles.tableHeaderUsernameColumn}>
              <FormattedMessage
                id="dataSourcesSummariesPanel.lastEditor"
                defaultMessage="Last edited by"
                description="Column label for the last editor of summaries listed in table"
              />
            </SortableHeader>
            <DataSourceItemTopicsHeader density={density} />
            <SortableHeader type="summary" sortKey="updated_at" className="table-date-cell">
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
        {hasRetryableErrors &&
          <CollapsibleItemsSection
            columnCount={columnCount}
            summary={
              <FormattedMessage
                id="global.retryableErrorsCount"
                defaultMessage="Retryable errors ({count})"
                description="Reusable label and count of items that failed to sync but will be retried"
                values={{ count: retryableErrorSummaries.length }}
                tagName="summary"
              />
            }
            columns={
              <>
                <th scope="col" className="table-priority-cell"></th>
                <th scope="col"></th>
                <th scope="col" className={styles.tableHeaderUsernameColumn}></th>
                {hasTopicsColumn(density) && <th scope="col" className={styles.topicsHeader}></th>}
                <th scope="col" className="table-date-cell"></th>
                <th scope="col" className="table-row-actions"></th>
              </>
            }
          >
            {retryableErrorSummaries.map((nb: Notebook) => (
              <NotebookRow
                key={nb.id}
                nb={nb}
                density={density}
                onPreview={openPreview}
                onUnpublish={setNotebookToUnpublish}
                onRetry={handleRetry}
                onCopyPermalink={handleCopyPermalink}
              />
            ))}
          </CollapsibleItemsSection>
        }
        <tbody>
        {summaries.length > 0 ? (
          summaries.map((nb: Notebook) => (
            <NotebookRow
              key={nb.id}
              nb={nb}
              density={density}
              onPreview={openPreview}
              onAddToNotebook={setItemToAddToNotebook}
              onPause={setItemToPause}
              onUnpublish={setNotebookToUnpublish}
              onRetry={handleRetry}
              onTogglePriorityTier={handleTogglePriorityTier}
              onCopyPermalink={handleCopyPermalink}
            />
          ))
        ) : !hasRetryableErrors && (
          <tr className={styles.noDocuments}>
            <td colSpan={columnCount}>
              <EmptyState
                actions={<DataSourcesDocumentsFilter type="summary" />}
                icon="document_dashed"
                message={
                  <>
                    <FormattedMessage
                      id="global.dataSourcesSummariesPaneltableEmpty"
                      defaultMessage="There are no published notebook summaries."
                      description="Empty message for table with no rows"
                    />
                    <br />
                    <br />
                    <FormattedMessage
                      id="global.dataSourcesSummariesFiltersAttention"
                      defaultMessage="Try a different set of filters to show notebook summaries."
                      description="Empty message to let users know they can change filters"
                    />
                  </>
                }
              />
            </td>
          </tr>
        )}
        </tbody>
        {summaries.length > 0 && (
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

export default DataSourcesSummariesPanel;
