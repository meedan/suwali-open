import clsx from 'clsx';
import { VisuallyHidden } from 'radix-ui'
import React, { useState } from 'react';
import { defineMessages, FormattedDate, FormattedMessage, useIntl } from 'react-intl';
import { useNavigate } from 'react-router';
import { useQueryClient } from '@tanstack/react-query';

import type { Document } from '@customTypes/document';
import type { Source } from '@customTypes/source';

import { getNextSyncTime, getSourceTypeIcon, getSourceTypeName, sourceSupportsPublishedAt } from '@helpers/source';

import { fetchDocuments } from '@services/DocumentsService';
import { patchSource } from '@services/SourcesService';

import { useSession } from '@root/SessionContext';

import { useCan } from '@hooks/useCapabilities';
import { useDataSourceItemActions } from '@hooks/useDataSourceItemActions';
import { useFilterAndSort } from '@hooks/useFilterAndSort';
import { useHubPath } from '@hooks/useHubPath';
import { useInfiniteScrollQuery } from '@hooks/useInfiniteScrollQuery';
import { useRememberedSearchParams } from '@hooks/useRememberedSearchParams';
import { type Density, useTableDensity } from '@hooks/useTableDensity';
import { useToast } from '@hooks/useToast';

import Button from '@ui-components/input/Button';
import EmptyState from "@ui-components/layout/EmptyState";
import Icon from '@ui-components/layout/Icon';
import { TableSkeleton } from '@ui-components/layout/LoadingIndicator';
import MetaList from '@ui-components/layout/MetaList';
import StatusPrefix from "@ui-components/layout/StatusPrefix";
import Tooltip from '@ui-components/layout/Tooltip';

import AddToNotebookModal from '@components/AddToNotebookModal';
import { Can } from '@components/Can';
import ConfirmDeleteModal from '@components/ConfirmDeleteModal';
import ConfirmPauseModal from '@components/ConfirmPauseModal';
import DataSourceItemPreviewModal from '@components/DataSourceItemPreviewModal';
import EditableTitle from '@components/EditableTitle';
import SortableHeader from '@components/SortableHeader';
import { SortModal } from '@components/SortModal';

import TrialDataSourcesBanner from '@trial-banners/TrialDataSourcesBanner';

import ActiveFilters from './ActiveFilters';
import CollapsibleItemsSection from './CollapsibleItemsSection';
import DataSourceItemRow, { DataSourceItemDateCell, DataSourceItemTopicsHeader } from './DataSourceItemRow';
import { DataSourcesDocumentsFilter } from './DataSourcesDocumentsFilter';
import styles from './DataSourcesDocumentsPanel.module.css';
import IngestionErrorRow from './IngestionErrorRow';
import { hasTopicsColumn, withTopicsColumn } from './tableColumns';

const messages = defineMessages({
  renameSourceError: {
    id: 'global.renameSourceError',
    defaultMessage: 'Failed to rename the source. Please try again.',
    description: 'Error message shown when there is an issue renaming a data source',
  },
});

// Priority, name, date modified and actions, plus date published when the source supports it
const getColumnCount = (showPublishedAt?: boolean) => (showPublishedAt ? 5 : 4);

type DataSourcesDocumentsPanelProps = {
  source: Source;
};

type SourceLinkProps = React.PropsWithChildren<{
  source: Source;
}>;

const SourceLink: React.FC<SourceLinkProps> = ({ source, children }) => {
  if (source.external_url) {
    return <a href={source.external_url} title={source.name} target="_blank" rel="noopener noreferrer"><span>{children}</span></a>;
  }
  return <span>{children}</span>;
};

type DocumentRowProps = {
  doc: Document;
  onPreview?: (doc: Document) => void;
  onAddToNotebook?: (doc: Document) => void;
  onPause?: (doc: Document) => void;
  onDelete: (doc: Document) => void;
  onRetry: (doc: Document) => void;
  onRefresh: (doc: Document) => void;
  onTogglePriorityTier?: (doc: Document) => void;
  onCopyPermalink?: (doc: Document) => void;
  showPublishedAt?: boolean;
  density?: Density;
  columnCount?: number;
};

const DocumentRow: React.FC<DocumentRowProps> = React.memo(({ doc, showPublishedAt, density, columnCount, onPreview, onAddToNotebook, onPause, onDelete, onRetry, onRefresh, onTogglePriorityTier, onCopyPermalink }) => (
  <DataSourceItemRow
    item={doc}
    title={doc.title}
    density={density}
    topics={doc.topics}
    columnCount={columnCount}
    onPreview={onPreview}
    onAddToNotebook={onAddToNotebook}
    onPause={onPause}
    onRetry={onRetry}
    onTogglePriorityTier={onTogglePriorityTier}
    onCopyPermalink={onCopyPermalink}
    menuProps={{
      onDelete,
      onRefresh: doc.refresh_supported ? onRefresh : undefined,
      downloadUrl: doc.file_url,
      externalUrl: doc.external_url,
    }}
  >
    {showPublishedAt && <DataSourceItemDateCell value={doc.published_at} onClick={onPreview && (() => onPreview(doc))} />}
  </DataSourceItemRow>
));
DocumentRow.displayName = 'DocumentRow';

type CollapsibleDocumentsSectionProps = React.PropsWithChildren<{
  summary: React.ReactNode;
  showPublishedAt?: boolean;
  density: Density;
}>;

const CollapsibleDocumentsSection: React.FC<CollapsibleDocumentsSectionProps> = ({ summary, showPublishedAt, density, children }) => (
  <CollapsibleItemsSection
    columnCount={withTopicsColumn(getColumnCount(showPublishedAt), density)}
    summary={summary}
    columns={
      <>
        <th scope="col" className="table-priority-cell"></th>
        <th scope="col"></th>
        {showPublishedAt && <th scope="col" className="table-date-cell"></th>}
        {hasTopicsColumn(density) && <th scope="col" className={styles.topicsHeader}></th>}
        <th scope="col" className="table-date-cell"></th>
        <th scope="col" className="table-row-actions"></th>
      </>
    }
  >
    {children}
  </CollapsibleItemsSection>
);

const DataSourcesDocumentsPanel = ({ source }: DataSourcesDocumentsPanelProps) => {
  const intl = useIntl();
  const navigate = useNavigate();
  const hubId = useSession().currentHubId();
  const hubPath = useHubPath();
  const queryClient = useQueryClient();
  const canUpdateSource = useCan('UPDATE_SOURCE').allowed;
  const { toast } = useToast();

  useRememberedSearchParams({
    routeId: `/data-sources/${source.id}`,
    hubId,
    enabled: Boolean(hubId && source?.id),
  });

  const [filterOpen, setFilterOpen] = useState(false);
  const { currentQuery: filter } = useFilterAndSort({});
  const [density, setDensity] = useTableDensity();

  // Ingestion errors aren't real documents, so they ignore the document filters/sort and stay pinned
  // at the top, except the "Unsupported" status filter, which hides them when unchecked, and the topics
  // filter, which hides them as they have no topics.
  const syncStatuses = filter.sync_status?.split(',').filter(Boolean);
  const showPublishedAt = sourceSupportsPublishedAt(source.source_type);
  const columnCount = withTopicsColumn(getColumnCount(showPublishedAt), density);
  const showIngestionErrors = (!syncStatuses || syncStatuses.includes('unsupported')) && !filter.topics;
  const unsupportedCount = (source.ingestion_errors?.length ?? 0) + (source.non_retryable_documents?.length ?? 0);

  const showRetryableErrors = !syncStatuses || syncStatuses.includes('error');
  const mainListSyncStatuses = (syncStatuses ?? ['pending', 'complete', 'error']).filter(s => s !== 'error');
  const mainListFilter = { ...filter, sync_status: mainListSyncStatuses.length > 0 ? mainListSyncStatuses.join(',') : 'unsupported' };
  const retryableErrorsFilter = { ...filter, sync_status: 'error' };

  const {
    previewId,
    closePreview,
    handleTogglePreviewPause,
    handleTogglePreviewPriorityTier,
    handleCopyPermalink,
    itemToAddToNotebook,
    setItemToAddToNotebook,
    openPreview,
    itemToPause,
    setItemToPause,
    itemToDelete,
    setItemToDelete,
    handlePauseConfirm,
    handleDeleteConfirm,
    handleRetry,
    handleRefresh,
    handleTogglePriorityTier,
  } = useDataSourceItemActions<Document>({
    entityType: 'documents',
    listQueryKeys: [[`/sources/${source.id}/documents`]],
    invalidationKeys: [[`/hubs/${hubId}/sources`]],
    permalink: {
      listPath: `/data-sources/${source.id}`,
      itemPath: id => `/data-sources/${source.id}/documents/${id}`,
    },
  });

  const {
    items: documents,
    pagination,
    error,
    isPending,
    isFetchingNextPage,
    observerTarget
  } = useInfiniteScrollQuery<Document>({
    queryKey: [`/sources/${source.id}/documents`, `filter:${JSON.stringify(mainListFilter)}`],
    queryFn: (page, perPage) => fetchDocuments(source.id, page, perPage, mainListFilter),
    perPage: 20,
    enabled: Boolean(source?.id),
    keepPreviousData: true,
  });

  const { items: retryableErrorDocuments } = useInfiniteScrollQuery<Document>({
    queryKey: [`/sources/${source.id}/documents`, 'retryable-errors', `filter:${JSON.stringify(retryableErrorsFilter)}`],
    queryFn: (page, perPage) => fetchDocuments(source.id, page, perPage, retryableErrorsFilter),
    perPage: 100,
    enabled: Boolean(source?.id) && showRetryableErrors,
  });

  const handleSaveTitle = async (newTitle: string) => {
    try {
      await patchSource(source.id, { source: { name: newTitle }});
      queryClient.invalidateQueries({ queryKey: [`/hubs/${hubId}/sources`] });
    } catch {
      toast('error', intl.formatMessage(messages.renameSourceError));
    }
  };

  const hasRetryableErrors = showRetryableErrors && retryableErrorDocuments.length > 0;
  const hasUnsupportedFiles = showIngestionErrors && unsupportedCount > 0;

  if (isPending) return <TableSkeleton className="layout-main-column-scrollable-area" rows={20} />;

  // The error is thrown to be caught by the SuwaliErrorBoundary, which will show a fallback UI and report the error to Sentry.
  if (error) throw error;

  return (
    <div className={clsx('layout-main-column-scrollable-area', styles.tableWrapper)}>
      <ConfirmPauseModal
        open={Boolean(itemToPause)}
        paused={itemToPause?.active === false}
        entityTitle={itemToPause?.title}
        entityType="Document"
        onCancel={() => setItemToPause(null)}
        onConfirm={handlePauseConfirm}
      />
      <ConfirmDeleteModal
        open={Boolean(itemToDelete)}
        entityTitle={itemToDelete?.title}
        entityType="Document"
        onCancel={() => setItemToDelete(null)}
        onConfirm={handleDeleteConfirm}
      />
      <AddToNotebookModal
        assetId={itemToAddToNotebook?.id}
        assetTitle={itemToAddToNotebook?.title}
        assetType="Document"
        open={Boolean(itemToAddToNotebook)}
        onOpenChange={() => setItemToAddToNotebook(null)}
      />
      <DataSourceItemPreviewModal
        open={Boolean(previewId)}
        id={previewId}
        type="Document"
        onOpenChange={closePreview}
        onTogglePause={previewId ? handleTogglePreviewPause : undefined}
        onTogglePriorityTier={previewId ? handleTogglePreviewPriorityTier : undefined}
      />
      <div className={styles.tableHeader}>
        <EditableTitle
          canEdit={canUpdateSource}
          className={styles.tableHeaderTitle}
          icon={<Icon aria-hidden className="no-mobile-access" id={getSourceTypeIcon(source.source_type)} />}
          onSave={handleSaveTitle}
          renderMeta={
            <MetaList>
              {!source.active &&
                <MetaList.Item>
                  <StatusPrefix status="paused" hyphen={false} sync />
                </MetaList.Item>
              }
              <MetaList.Item>
                <SourceLink source={source}>
                  <FormattedMessage
                    id="global.entriesCount"
                    defaultMessage="<strong>Entries:</strong> {count}"
                    description="Text for the count of entries in the table below"
                    values={{
                      count: source.documents_count,
                      strong: msg => <strong key="strong">{msg}</strong>,
                    }}
                  />
                </SourceLink>
              </MetaList.Item>
              {source.source_type !== 'uploaded_files' && source.last_synced_at && (
                <FormattedMessage
                  id="global.lastSyncLabel"
                  defaultMessage="<strong>Last sync:</strong> {date}"
                  description="Last sync label"
                  tagName={MetaList.Item}
                  values={{
                    strong: msg => <strong key="strong">{msg}</strong>,
                    date:
                      <FormattedDate
                        key="date"
                        value={new Date(source.last_synced_at)}
                        weekday="short"
                        month="short"
                        day="2-digit"
                        hour="2-digit"
                        minute="2-digit"
                      />
                  }}
                />
              )}
              {source.source_type === 'uploaded_files' && source.last_synced_at && (
                <FormattedMessage
                  id="global.lastUploadLabel"
                  defaultMessage="<strong>Last upload:</strong> {date}"
                  description="Last upload label"
                  tagName={MetaList.Item}
                  values={{
                    strong: msg => <strong key="strong">{msg}</strong>,
                    date:
                      <FormattedDate
                        key="date"
                        value={new Date(source.last_synced_at)}
                        weekday="short"
                        month="short"
                        day="2-digit"
                        hour="2-digit"
                        minute="2-digit"
                      />
                  }}
                />
              )}
              {source.source_type !== 'uploaded_files' &&
                <FormattedMessage
                  id="global.nextSyncLabel"
                  defaultMessage="<strong>Next scheduled sync:</strong> {date}"
                  description="Next sync label showing the upcoming scheduled sync time at :00 or :30 of the hour"
                  tagName={MetaList.Item}
                  values={{
                    strong: msg => <strong key="strong">{msg}</strong>,
                    date:
                      <FormattedDate
                        key="date"
                        value={getNextSyncTime()}
                        hour="2-digit"
                        minute="2-digit"
                      />
                  }}
                />
              }
            </MetaList>
          }
          value={source.name}
        />
        <div className={styles.tableHeaderButtons}>
          <DataSourcesDocumentsFilter type="document" sourceId={source.id} showDatePublished={showPublishedAt} open={filterOpen} onOpenChange={setFilterOpen} />
          <SortModal
            type="document"
            options={showPublishedAt ? ['title', 'updated_at', 'published_at', 'sync_status', 'priority_tier'] : undefined}
          />
          {source.source_type !== 'json_api' && (source.source_type !== 'uploaded_files' || canUpdateSource) &&
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
                onClick={() => navigate(hubPath(`/data-sources/${source.id}/settings`))}
              />
            </Tooltip>
          }
          {source.source_type === 'uploaded_files' &&
            <Can action="UPDATE_SOURCE">
              <Button
                label={
                  <FormattedMessage
                    id="global.addFiles"
                    defaultMessage="Add files"
                    description="Reusable label for adding new uploaded files"
                  />
                }
                className="no-mobile-access"
                variant="filled"
                size="small"
                iconLeft={<Icon id="plus" aria-hidden />}
                onClick={() => navigate(hubPath(`/data-sources/${source.id}/settings`))}
              />
            </Can>
          }
        </div>
      </div>
      <TrialDataSourcesBanner />
      <ActiveFilters type="document" sourceId={source.id} density={density} onDensityChange={setDensity} resultCount={pagination?.total_count} totalCount={source.documents_count} onEdit={() => setFilterOpen(true)} />
      <table aria-labelledby="tableCaption">
        <VisuallyHidden.Root asChild>
          <caption id="tableCaption">
            <FormattedMessage
              id="dataSourcesDocumentsPanel.tableCaption"
              defaultMessage="Table with {type} documents"
              description="Accessibility caption for the table that shows documents and the type of documents they are"
              values={{ type: getSourceTypeName(source.source_type) }}
            />
          </caption>
        </VisuallyHidden.Root>
        <thead>
          <tr>
            <SortableHeader type="document" sortKey="priority_tier" className="table-priority-cell">
              <Icon id="important_filled" aria-hidden />
              <VisuallyHidden.Root>
                <FormattedMessage
                  id="global.priorityTier"
                  defaultMessage="Priority tier"
                  description="Label for the priority tier"
                />
              </VisuallyHidden.Root>
            </SortableHeader>
            <SortableHeader type="document" sortKey="title">
              <FormattedMessage
                id="global.name"
                defaultMessage="Name"
                description="Reusable label for item name"
              />
            </SortableHeader>
            {showPublishedAt && (
              <SortableHeader type="document" sortKey="published_at" className="table-date-cell">
                <FormattedMessage
                  id="global.datePublished"
                  defaultMessage="Date published"
                  description="Reusable label for the date the item was last published"
                />
              </SortableHeader>
            )}
            <DataSourceItemTopicsHeader density={density} />
            <SortableHeader type="document" sortKey="updated_at" className="table-date-cell">
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
        {hasUnsupportedFiles &&
          <CollapsibleDocumentsSection
            showPublishedAt={showPublishedAt}
            density={density}
            summary={
              <FormattedMessage
                id="global.unsupportedFilesCount"
                defaultMessage="Unsupported files ({count})"
                description="Label and count of files that are not supported by the system"
                values={{ count: unsupportedCount }}
                tagName="summary"
              />
            }
          >
            {source.ingestion_errors?.map(error => (
              <IngestionErrorRow key={error.external_id} error={error} lastSyncedAt={source.last_synced_at} showPublishedAt={showPublishedAt} topicsColumn={hasTopicsColumn(density)} />
            ))}
            {source.non_retryable_documents?.map(document => (
              <IngestionErrorRow
                key={`document-${document.id}`}
                error={{
                  external_id: document.external_id ?? String(document.id),
                  title: document.title,
                  reason: document.last_sync_error_code,
                  link: document.external_url,
                }}
                lastSyncedAt={source.last_synced_at}
                showPublishedAt={showPublishedAt}
                topicsColumn={hasTopicsColumn(density)}
                onDelete={source.source_type === 'google_drive_folder' ? undefined : () => setItemToDelete({ id: document.id, title: document.title } as Document)}
              />
            ))}
          </CollapsibleDocumentsSection>
        }
        {hasRetryableErrors &&
          <CollapsibleDocumentsSection
            showPublishedAt={showPublishedAt}
            density={density}
            summary={
              <FormattedMessage
                id="global.retryableErrorsCount"
                defaultMessage="Retryable errors ({count})"
                description="Reusable label and count of items that failed to sync but will be retried"
                values={{ count: retryableErrorDocuments.length }}
                tagName="summary"
              />
            }
          >
            {retryableErrorDocuments.map((doc: Document) => (
              <DocumentRow
                doc={doc}
                key={doc.id}
                showPublishedAt={showPublishedAt}
                density={density}
                columnCount={columnCount}
                onDelete={setItemToDelete}
                onRetry={handleRetry}
                onRefresh={handleRefresh}
              />
            ))}
          </CollapsibleDocumentsSection>
        }
        <tbody>
        {documents.length > 0 ? (
          documents.map((doc: Document) => (
            <DocumentRow
              doc={doc}
              key={doc.id}
              showPublishedAt={showPublishedAt}
              density={density}
              columnCount={columnCount}
              onPreview={openPreview}
              onAddToNotebook={setItemToAddToNotebook}
              onPause={setItemToPause}
              onDelete={setItemToDelete}
              onRetry={handleRetry}
              onRefresh={handleRefresh}
              onTogglePriorityTier={handleTogglePriorityTier}
              onCopyPermalink={handleCopyPermalink}
            />
          ))
        ) : !hasRetryableErrors && !hasUnsupportedFiles && (
          <tr className={styles.noDocuments}>
            <td colSpan={columnCount}>
              <EmptyState
                actions={<DataSourcesDocumentsFilter type="document" sourceId={source.id} showDatePublished={showPublishedAt} />}
                icon="document_dashed"
                message={
                  <>
                    <FormattedMessage
                      id="global.dataSourcesDocumentsPaneltableEmpty"
                      defaultMessage="No documents found for {name}."
                      description="Empty message for table with no rows"
                      values={{ name: source.name }}
                    />
                    <br />
                    <br />
                    <FormattedMessage
                      id="global.dataSourcesDocumentsFiltersAttention"
                      defaultMessage="Try a different set of filters to show documents."
                      description="Empty message to let users know they can change filters"
                    />
                  </>
                }
              />
            </td>
          </tr>
        )}
        </tbody>
        {documents.length > 0 && (
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
  );
};

export default DataSourcesDocumentsPanel;
