import { useEffect, useRef, useState } from 'react';
import { defineMessages, FormattedMessage, useIntl } from 'react-intl';

import Button from '@ui-components/input/Button';
import Icon from '@ui-components/layout/Icon';
import { Modal } from '@ui-components/layout/Modal';
import Tooltip from '@ui-components/layout/Tooltip';

import styles from './DataSourcesDocumentsFilter.module.css';

const messages = defineMessages({
  filtersCount: {
    id: 'global.filtersCount',
    defaultMessage: 'Filters ({count})',
    description: 'Button label for applying filters to the table with the count of how many filters are applied',
  },
});

type FilterModalProps = {
  title: React.ReactNode;
  children: React.ReactNode;
  activeFiltersCount: number;
  onApply: () => void;
  onReset: () => void;
  onDiscard: () => void;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  verboseButton?: boolean;
};

export const FilterModal = ({
  title,
  children,
  activeFiltersCount,
  onApply,
  onReset,
  onDiscard,
  open,
  onOpenChange,
  verboseButton = false,
}: FilterModalProps) => {
  const intl = useIntl();
  const [ownOpen, setOwnOpen] = useState(false);
  const dialogOpen = open ?? ownOpen;

  // Opened from outside, as the chips and count of the active filters do, the dialog gets no open change from the
  // modal, so what it shows is made current here, whatever opened it. The ref keeps the latest discard without re-running
  const discard = useRef(onDiscard);
  discard.current = onDiscard;
  useEffect(() => {
    if (dialogOpen) discard.current();
  }, [dialogOpen]);

  const close = () => {
    setOwnOpen(false);
    onOpenChange?.(false);
  };

  // Escape and a click outside come through here; what was chosen and not applied is not what the dialog should show next time
  const onModalOpenChange = (next: boolean) => {
    if (!next) onDiscard();
    setOwnOpen(next);
    onOpenChange?.(next);
  };

  const onCancel = () => {
    onDiscard();
    close();
  };

  const onConfirm = () => {
    onApply();
    close();
  };

  const onResetClick = () => {
    onReset();
    close();
  };

  return (
    <Modal
      open={dialogOpen}
      onOpenChange={onModalOpenChange}
      title={title}
      actions={
        <div className={styles.filterActionsRow}>
          <Button
            label={
              <FormattedMessage
                id="global.resetToDefault"
                defaultMessage="Reset to default"
                description="Button label to reset filters to their default values"
              />
            }
            size="small"
            themeMode
            variant="text"
            onClick={onResetClick}
          />
          <div className={styles.mainActions}>
            <Button
              label={
                <FormattedMessage
                  id="global.cancel"
                  defaultMessage="Cancel"
                  description="Reusable label for cancel buttons"
                />
              }
              size="small"
              themeMode
              variant="text"
              onClick={onCancel}
            />
            <Button
              label={
                <FormattedMessage
                  id="global.updateFilters"
                  defaultMessage="Update filters"
                  description="Update filters button label"
                />
              }
              size="small"
              onClick={onConfirm}
            />
          </div>
        </div>
      }
      body={<div className={styles.modalBody}>{children}</div>}
      trigger={
        <Tooltip content={
          <FormattedMessage
            id="global.filter"
            defaultMessage="Filter"
            description="Button label to open the filter dialog"
          />
        }>
          <Button
            aria-label={verboseButton ? undefined : intl.formatMessage(messages.filtersCount, { count: activeFiltersCount })}
            variant="filled"
            size="small"
            iconLeft={<Icon aria-hidden id="filter" />}
            label={
              verboseButton ?
                <FormattedMessage {...messages.filtersCount} values={{ count: activeFiltersCount }} />
                :
                (activeFiltersCount > 0 ? activeFiltersCount : '')
            }
            themeMode={activeFiltersCount === 0}
          />
        </Tooltip>
      }
    />
  );
};
