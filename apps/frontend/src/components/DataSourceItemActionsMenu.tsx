import clsx from "clsx";
import { defineMessages, useIntl } from 'react-intl';
import { useNavigate } from 'react-router';

import type { PriorityTier } from '@customTypes/priority-tier';

import { useHubPath } from '@hooks/useHubPath';
import { useIsMobileScreen } from '@hooks/useLayout';

import Button from '@ui-components/input/Button';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@ui-components/input/DropdownMenu.tsx';
import Icon from '@ui-components/layout/Icon';
import Tooltip from '@ui-components/layout/Tooltip';

import { Can } from '@components/Can';

import styles from "./DataSourceItemActionsMenu.module.css";

const messages = defineMessages({
  more: {
    id: 'global.more',
    defaultMessage: 'More',
    description: 'Reusable label to indicate more options are available',
  },
  preview: {
    id: 'global.previewButton',
    defaultMessage: 'Preview',
    description: 'Button label to preview the selected item',
  },
  includeInNotebook: {
    id: 'global.includeInNotebook',
    defaultMessage: 'Include in notebooks',
    description: 'Reusable label to indicate adding this item to a notebook',
  },
  showConversation: {
    id: 'global.showConversation',
    defaultMessage: 'Show conversation',
    description: 'Button label to navigate to the conversation for this item',
  },
  openSource: {
    id: 'global.openSource',
    defaultMessage: 'Open source',
    description: 'Button label to open the selected item external source in a new browser tab',
  },
  pauseLabel: {
    id: 'global.pause',
    defaultMessage: 'Pause',
    description: 'Reusable label for pause action',
  },
  reactivateLabel: {
    id: 'global.reactivate',
    defaultMessage: 'Reactivate',
    description: 'Reusable label for reactivate action',
  },
  remove: {
    id: 'global.remove',
    defaultMessage: 'Remove',
    description: 'Reusable label for remove action',
  },
  availableAfterProcessing: {
    id: 'global.availableAfterProcessing',
    defaultMessage: 'Available once this item has been processed.',
    description: 'Reusable tooltip for an action that is disabled because the item is still processing or failed processing',
  },
  pauseTooltip: {
    id: 'global.pauseTooltip',
    defaultMessage: 'Pause this item so it will no longer be available to the chatbot to respond to end-users.',
    description: 'Tooltip for pause action',
  },
  reactivateTooltip: {
    id: 'global.reactivateTooltip',
    defaultMessage: 'Reactivate this item, making it available to the chatbot to respond to end-users.',
    description: 'Tooltip for reactivate action',
  },
  unpublish: {
    id: 'global.unpublish',
    defaultMessage: 'Unpublish',
    description: 'Button label to unpublish the selected notebook summary',
  },
  retryLabel: {
    id: 'global.retry',
    defaultMessage: 'Retry',
    description: 'Reusable label for retry action',
  },
  retryTooltip: {
    id: 'global.retryTooltip',
    defaultMessage: 'Retry processing for this item',
    description: 'Tooltip for retry action',
  },
  download: {
    id: 'global.download',
    defaultMessage: 'Download',
    description: 'Generic reusable label for download actions',
  },
  copyPermalink: {
    id: 'dataSourceItemActionsMenu.copyPermalink',
    defaultMessage: 'Copy permalink',
    description: 'Menu option to copy a link that opens this item directly',
  },
  markImportantLabel: {
    id: 'dataSourceItemActionsMenu.markImportantLabel',
    defaultMessage: 'Mark as important',
    description: 'Dropdown label when item is at default priority (tier 1) — clicking promotes it to important (tier 2)',
  },
  markDefaultLabel: {
    id: 'dataSourceItemActionsMenu.markDefaultLabel',
    defaultMessage: 'Mark as default',
    description: 'Dropdown label when item is marked important (tier 2) — clicking demotes it to default (tier 1)',
  },
  refreshLabel: {
    id: 'dataSourceItemActionsMenu.refreshLabel',
    defaultMessage: 'Refresh from data source',
    description: 'Reusable label for refreshing an item’s content from its source',
  },
});

type DataSourceItemActionsMenuProps<T extends { id: number; active?: boolean; sync_status?: 'pending' | 'error' | 'complete' }> = {
  item: T;
  onPause?: (item: T) => void;
  onPreview?: (item: T) => void;
  onDelete?: (item: T) => void;
  onUnpublish?: (item: T) => void;
  onAddToNotebook?: (item: T) => void;
  onRetry?: (item: T) => void;
  onRefresh?: (item: T) => void;
  onTogglePriorityTier?: (item: T) => void;
  onCopyPermalink?: (item: T) => void;
  conversationId?: string | number;
  downloadUrl?: string | null;
  externalUrl?: string;
  priorityTier?: PriorityTier;
  quickActionsClassName?: string;
};

const DataSourceItemActionsMenu = <T extends { id: number; active?: boolean; sync_status?: 'pending' | 'error' | 'complete' }>({
  item,
  onPause,
  onPreview,
  onDelete,
  onUnpublish,
  onAddToNotebook,
  onRetry,
  onRefresh,
  onTogglePriorityTier,
  onCopyPermalink,
  conversationId,
  downloadUrl,
  externalUrl,
  priorityTier,
  quickActionsClassName,
}: DataSourceItemActionsMenuProps<T>) => {
  const intl = useIntl();
  const navigate = useNavigate();
  const hubPath = useHubPath();

  const isPaused = item.active === false;
  const hasError = item.sync_status === 'error';
  const isProcessing = item.sync_status === 'pending';
  // An item without a sync status isn't processed at all, so nothing waits on it
  const needsProcessing = isProcessing || hasError;
  const hasTopSection = Boolean(onPreview || onCopyPermalink || externalUrl || downloadUrl || conversationId);
  const hasMiddleSection = Boolean(onAddToNotebook || (onTogglePriorityTier && priorityTier !== undefined));
  const hasBottomSection = Boolean(onPause || (hasError && onRetry) || onRefresh || onDelete || onUnpublish);
  const pauseTooltip = intl.formatMessage(isPaused ? messages.reactivateTooltip : messages.pauseTooltip);
  const unavailableTooltip = intl.formatMessage(messages.availableAfterProcessing);
  const retryTooltip = intl.formatMessage(messages.retryTooltip);

  const isMobileScreen = useIsMobileScreen();

  return (
    <div className={styles.dataSourceItemActionsMenu}>
      {!isMobileScreen &&
        <div className={clsx('quick-actions', styles.quickActions, quickActionsClassName)}>
          {hasError && onRetry && (
            <Tooltip content={retryTooltip}>
              <Button
                aria-label={retryTooltip}
                themeMode
                variant="filled"
                size="small"
                iconLeft={<Icon id="arrow_clockwise" aria-hidden />}
                onClick={() => onRetry(item)}
              />
            </Tooltip>
          )}
          {onPause && (
            <Tooltip content={needsProcessing ? unavailableTooltip : pauseTooltip} disabled={needsProcessing}>
              <Button
                aria-label={pauseTooltip}
                themeMode
                variant="filled"
                size="small"
                disabled={needsProcessing}
                iconLeft={<Icon id={isPaused ? 'play' : 'pause'} aria-hidden />}
                onClick={() => onPause(item)}
              />
            </Tooltip>
          )}
          {onAddToNotebook && (
            <Can action="CREATE_NOTEBOOK_ITEM">
              <Tooltip
                content={needsProcessing ? unavailableTooltip : intl.formatMessage(messages.includeInNotebook)}
                disabled={needsProcessing}
              >
                <Button
                  aria-label={intl.formatMessage(messages.includeInNotebook)}
                  themeMode
                  variant="filled"
                  size="small"
                  disabled={needsProcessing}
                  iconLeft={<Icon id="notebook" aria-hidden />}
                  onClick={() => onAddToNotebook(item)}
                />
              </Tooltip>
            </Can>
          )}
        </div>
      }
      <DropdownMenu>
        <Tooltip content={intl.formatMessage(messages.more)}>
          <DropdownMenuTrigger>
            <Button
              aria-label={intl.formatMessage(messages.more)}
              themeMode
              variant="filled"
              size="small"
              iconLeft={<Icon id="dots_three_vertical" aria-hidden />}
            />
          </DropdownMenuTrigger>
        </Tooltip>
        <DropdownMenuContent>
          {onPreview && (
            <DropdownMenuItem>
              <Button
                label={intl.formatMessage(messages.preview)}
                size="medium"
                themeMode
                variant="menu"
                onClick={() => onPreview(item)}
              />
            </DropdownMenuItem>
          )}
          {onCopyPermalink && (
            <DropdownMenuItem>
              <Button
                label={intl.formatMessage(messages.copyPermalink)}
                size="medium"
                themeMode
                variant="menu"
                onClick={() => onCopyPermalink(item)}
              />
            </DropdownMenuItem>
          )}
          {externalUrl && (
            <DropdownMenuItem>
              <Button
                label={intl.formatMessage(messages.openSource)}
                iconRight={<Icon id="arrow_square_out" aria-hidden />}
                size="medium"
                themeMode
                variant="menu"
                onClick={() => window.open(externalUrl, '_blank', 'noopener,noreferrer')}
              />
            </DropdownMenuItem>
          )}
          {downloadUrl && (
            <DropdownMenuItem>
              <Button
                label={intl.formatMessage(messages.download)}
                size="medium"
                themeMode
                variant="menu"
                onClick={() => window.open(downloadUrl, '_blank', 'noopener,noreferrer')}
              />
            </DropdownMenuItem>
          )}
          {conversationId && (
            <DropdownMenuItem>
              <Button
                label={intl.formatMessage(messages.showConversation)}
                size="medium"
                themeMode
                variant="menu"
                onClick={() => navigate(hubPath(`/conversations/audience/${conversationId}`))}
              />
            </DropdownMenuItem>
          )}
          {hasTopSection && hasMiddleSection && <DropdownMenuSeparator />}
          {onTogglePriorityTier && priorityTier !== undefined && (
            <DropdownMenuItem>
              <Button
                iconLeft={<Icon id={priorityTier === 2 ? 'important' : 'important_filled_color'} aria-hidden />}
                label={intl.formatMessage(priorityTier === 2 ? messages.markDefaultLabel : messages.markImportantLabel)}
                size="medium"
                themeMode
                variant="menu"
                disabled={needsProcessing}
                onClick={() => onTogglePriorityTier(item)}
              />
            </DropdownMenuItem>
          )}
          {onAddToNotebook && (
            <Can action="CREATE_NOTEBOOK_ITEM">
              <DropdownMenuItem>
                <Button
                  label={intl.formatMessage(messages.includeInNotebook)}
                  size="medium"
                  themeMode
                  variant="menu"
                  disabled={needsProcessing}
                  onClick={() => onAddToNotebook(item)}
                />
              </DropdownMenuItem>
            </Can>
          )}
          {hasBottomSection && (hasTopSection || hasMiddleSection) && <DropdownMenuSeparator />}
          {onPause && (
            <DropdownMenuItem>
              <Button
                label={intl.formatMessage(isPaused ? messages.reactivateLabel : messages.pauseLabel)}
                size="medium"
                themeMode
                variant="menu"
                disabled={needsProcessing}
                onClick={() => onPause(item)}
              />
            </DropdownMenuItem>
          )}
          {hasError && onRetry && (
            <DropdownMenuItem>
              <Button
                label={intl.formatMessage(messages.retryLabel)}
                size="medium"
                themeMode
                variant="menu"
                onClick={() => onRetry(item)}
              />
            </DropdownMenuItem>
          )}
          {onRefresh && (
            <DropdownMenuItem>
              <Button
                label={intl.formatMessage(messages.refreshLabel)}
                size="medium"
                themeMode
                variant="menu"
                onClick={() => onRefresh(item)}
              />
            </DropdownMenuItem>
          )}
          {onDelete && (
            <DropdownMenuItem>
              <Button
                label={intl.formatMessage(messages.remove)}
                size="medium"
                themeMode
                variant="menu"
                disabled={isProcessing}
                onClick={() => onDelete(item)}
              />
            </DropdownMenuItem>
          )}
          {onUnpublish && (
            <DropdownMenuItem>
              <Button
                label={intl.formatMessage(messages.unpublish)}
                size="medium"
                themeMode
                variant="menu"
                disabled={isProcessing}
                onClick={() => onUnpublish(item)}
              />
            </DropdownMenuItem>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
};

export default DataSourceItemActionsMenu;
