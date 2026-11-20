import clsx from 'clsx';
import { defineMessages, FormattedMessage, useIntl } from 'react-intl';

import Icon from '@ui-components/layout/Icon';

import styles from './Status.module.css'

const messages = defineMessages({
  syncingPaused: {
    id: 'global.syncingPaused',
    defaultMessage: 'Syncing paused{separator}',
    description: 'Label indicating an a data source is no longer actively syncing',
  },
  paused: {
    id: 'global.paused',
    defaultMessage: 'Paused{separator}',
    description: 'Label indicating an item is paused',
  },
  pausing: {
    id: 'global.pausing',
    defaultMessage: 'Pausing{separator}',
    description: 'Label indicating an item is being paused',
  },
  processing: {
    id: 'global.processing',
    defaultMessage: 'Processing{separator}',
    description: 'Label indicating an item is being processed by the system',
  },
  error: {
    id: 'global.errorStatus',
    defaultMessage: 'Error{separator}',
    description: 'Label indicating an item has caused an error during processing',
  },
  unsupported: {
    id: 'global.unsupportedStatus',
    defaultMessage: 'Unsupported{separator}',
    description: 'Label indicating an item could not be imported because it is not supported',
  },
});

interface StatusPrefixProps {
  className?: string;
  hyphen?: boolean;
  icon?: boolean;
  // Shows only the icon; the label stays available as a tooltip and accessible name
  iconOnly?: boolean;
  status: 'paused' | 'pausing' | 'error' | 'processing' | 'unsupported';
  sync?: boolean;
}

const STATUS_ICONS: Record<StatusPrefixProps['status'], string> = {
  paused: 'pause_filled',
  pausing: 'pause',
  error: 'error_filled',
  processing: 'countdown_pie',
  unsupported: 'info_filled',
};

const getStatus = (status: StatusPrefixProps['status'], sync: boolean) => {
  if (sync && status === 'paused') return messages.syncingPaused;
  switch (status) {
    case 'paused': return messages.paused;
    case 'pausing': return messages.pausing;
    case 'error': return messages.error;
    case 'processing': return messages.processing;
    case 'unsupported': return messages.unsupported;
  }
}

const StatusPrefix: React.FC<StatusPrefixProps> = ({
  className,
  hyphen = true,
  icon = true,
  iconOnly = false,
  status = 'paused',
  sync = false,
}) => {
  const intl = useIntl();
  const label = iconOnly ? intl.formatMessage(getStatus(status, sync), { separator: '' }) : undefined;

  return (
    <strong
      className={clsx(
        [styles.statusPrefix],
        [className],
        {
          [styles.paused]: status === 'paused',
          [styles.pausing]: status === 'pausing',
          [styles.error]: status === 'error',
          [styles.processing]: status === 'processing',
          [styles.unsupported]: status === 'unsupported',
        })
      }
      aria-label={label}
      title={label}
    >
      { (icon || iconOnly) && <><Icon aria-hidden id={STATUS_ICONS[status]} />&nbsp;</> }
      { !iconOnly && <FormattedMessage {...getStatus(status, sync)} values={{ separator: hyphen && '\u00A0-\u00A0' }} /> }
    </strong>
  )
};

export default StatusPrefix;
