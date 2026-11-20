import { defineMessages, FormattedMessage, useIntl } from 'react-intl';

import Button from '@ui-components/input/Button';
import Icon from '@ui-components/layout/Icon';
import StatusPrefix from '@ui-components/layout/StatusPrefix';
import Tooltip from '@ui-components/layout/Tooltip';

import PreviewDetails from './PreviewDetails';
import styles from './StatusField.module.css';

const messages = defineMessages({
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
  reactivateTooltip: {
    id: 'global.reactivateTooltip',
    defaultMessage: 'Reactivate this item, making it available to the chatbot to respond to end-users.',
    description: 'Tooltip for reactivate action',
  },
});

type Props = {
  active: boolean;
  syncStatus?: 'pending' | 'error' | 'complete';
  // Pauses or reactivates the item. Only an item that has been processed can be, so the button is disabled for no other.
  onToggle?: () => void;
  // Processes an item that failed again. When given, an item in error is offered this in place of the pause it can't have yet.
  onRetry?: () => void;
};

// What state an item is in, and so whether the chatbot can use it, which can be changed here as well as from the menu
// of the item in its list
const StatusField = ({ active, syncStatus, onToggle, onRetry }: Props) => {
  const intl = useIntl();
  const awaitingProcessing = syncStatus !== 'complete';
  const tooltip = intl.formatMessage(active ? messages.pauseTooltip : messages.reactivateTooltip);

  return (
    <PreviewDetails.Field
      label={
        <FormattedMessage
          id="previewDetails.status"
          defaultMessage="Status"
          description="Label for whether an item is available to the chatbot, which the button beside the label changes"
        />
      }
      action={syncStatus === 'error' && onRetry ? (
        <Tooltip content={intl.formatMessage(messages.retryTooltip)}>
          <Button
            iconLeft={<Icon id="arrow_clockwise" aria-hidden />}
            label={intl.formatMessage(messages.retryLabel)}
            // Not passed the click, which a handler that takes the item would mistake for it
            onClick={() => onRetry()}
            size="small"
            themeMode
          />
        </Tooltip>
      ) : onToggle && (
        <Tooltip
          content={awaitingProcessing ? intl.formatMessage(messages.availableAfterProcessing) : tooltip}
          disabled={awaitingProcessing}
        >
          <Button
            iconLeft={<Icon id={active ? 'pause' : 'play'} aria-hidden />}
            label={active ? (
              <FormattedMessage
                id="global.pause"
                defaultMessage="Pause"
                description="Reusable label for pause action"
              />
            ) : (
              <FormattedMessage
                id="global.reactivate"
                defaultMessage="Reactivate"
                description="Reusable label for reactivate action"
              />
            )}
            disabled={awaitingProcessing}
            // Not passed the click, which a handler that takes the item to pause would mistake for it
            onClick={() => onToggle?.()}
            size="small"
            themeMode
          />
        </Tooltip>
      )}
    >
      {syncStatus === 'error' ? (
        <StatusPrefix className={styles.state} status="error" hyphen={false} />
      ) : syncStatus === 'pending' ? (
        <StatusPrefix className={styles.state} status={active ? 'processing' : 'pausing'} hyphen={false} />
      ) : active ? (
        <FormattedMessage
          id="global.statusActive"
          defaultMessage="Active"
          description="Value of the status of an item that is available to the chatbot"
        />
      ) : (
        <StatusPrefix className={styles.state} status="paused" hyphen={false} />
      )}
    </PreviewDetails.Field>
  );
};

export default StatusField;
