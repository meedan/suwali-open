import clsx from 'clsx';
import { defineMessages, FormattedMessage } from 'react-intl';

import StatusPrefix from '@ui-components/layout/StatusPrefix';

import styles from './Status.module.css'

const messages = defineMessages({
  paused: {
    id: 'global.pausedStatusDetails',
    defaultMessage: 'This content is unavailable to the chatbot to respond to end-users.',
    description: 'Details describing how content will be handled when an it is paused',
  },
  pausing: {
    id: 'global.pausingDetails',
    defaultMessage: 'Content is currently being processed in order to make it unavailable to the chatbot to respond to end-users.',
    description: 'Details describing that an item is being paused',
  },
  error: {
    id: 'global.errorStatusDetails',
    defaultMessage: 'An error occurred during processing. This content is unavailable to the chatbot to respond to end-users.',
    description: 'Details describing how content will be handled when an error occurs ',
  },
  processing: {
    id: 'global.processingStatusDetails',
    defaultMessage: 'Content is currently being processed in order to be available to respond to end-users.',
    description: 'Details describing how content will be handled while it is being processed by the system',
  },
});

interface StatusBannerProps {
  className?: string;
  status: 'paused' | 'pausing' | 'error' | 'processing';
}

const getStatusDetails = (status: StatusBannerProps['status']) => {
  switch (status) {
    case 'paused': return messages.paused;
    case 'pausing': return messages.pausing;
    case 'error': return messages.error;
    case 'processing': return messages.processing;
  }
}

const StatusBanner: React.FC<StatusBannerProps> = ({
  className,
  status = 'paused',
}) => {

  return (
    <div
      className={clsx(
        [styles.statusBanner],
        [className],
        {
          [styles.paused]: status === 'paused',
          [styles.pausing]: status === 'pausing',
          [styles.error]: status === 'error',
          [styles.processing]: status === 'processing',
        })
      }
    >
      <StatusPrefix status={status} />
      <FormattedMessage {...getStatusDetails(status)} tagName="span" />
    </div>
  )
};

export default StatusBanner;
