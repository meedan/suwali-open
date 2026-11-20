import { defineMessages, FormattedMessage, useIntl } from 'react-intl';

import type { PriorityTier } from '@customTypes/priority-tier';

import Button from '@ui-components/input/Button';
import Icon from '@ui-components/layout/Icon';
import Tooltip from '@ui-components/layout/Tooltip';

import PreviewDetails from './PreviewDetails';
import styles from './PriorityTierField.module.css';

const messages = defineMessages({
  availableAfterProcessing: {
    id: 'global.availableAfterProcessing',
    defaultMessage: 'Available once this item has been processed.',
    description: 'Reusable tooltip for an action that is disabled because the item is still processing or failed processing',
  },
  toggleImportant: {
    id: 'global.toggleImportant',
    defaultMessage: 'Mark this item as important for chatbot responses.',
    description: 'Tooltip when item is at default priority (tier 1) — clicking promotes it to important (tier 2)',
  },
  toggleDefault: {
    id: 'global.toggleDefault',
    defaultMessage: 'Mark this item as default priority for chatbot responses.',
    description: 'Tooltip when item is marked important (tier 2) — clicking demotes it to default (tier 1)',
  },
});

type Props = {
  onToggle?: () => void;
  priorityTier: PriorityTier;
  // The priority can't be changed while the item is being processed, or until a failed one has been, so the button is disabled
  syncStatus?: 'pending' | 'error' | 'complete';
};

// The priority of an item, which can be changed here as well as from the toggle in the title
const PriorityTierField = ({ onToggle, priorityTier, syncStatus }: Props) => {
  const intl = useIntl();
  // only tier 2 is important; the low tier reads as default, like tier 1
  const isImportant = priorityTier === 2;
  const isProcessing = syncStatus === 'pending' || syncStatus === 'error';

  return (
    <PreviewDetails.Field
      label={
        <FormattedMessage
          id="global.priorityTier"
          defaultMessage="Priority tier"
          description="Label for the priority tier"
        />
      }
      action={
        <Tooltip
          content={intl.formatMessage(
            isProcessing ? messages.availableAfterProcessing : isImportant ? messages.toggleDefault : messages.toggleImportant,
          )}
          disabled={isProcessing}
        >
          <Button
            iconLeft={<Icon id={isImportant ? 'important' : 'important_filled_color'} aria-hidden />}
            label={isImportant ? (
              <FormattedMessage
                id="dataSourceItemActionsMenu.markDefaultLabel"
                defaultMessage="Mark as default"
                description="Dropdown label when item is marked important (tier 2) — clicking demotes it to default (tier 1)"
              />
            ) : (
              <FormattedMessage
                id="dataSourceItemActionsMenu.markImportantLabel"
                defaultMessage="Mark as important"
                description="Dropdown label when item is at default priority (tier 1) — clicking promotes it to important (tier 2)"
              />
            )}
            disabled={isProcessing}
            // Not passed the click, which a handler that takes the item would mistake for it
            onClick={() => onToggle?.()}
            size="small"
            themeMode
          />
        </Tooltip>
      }
    >
      <span className={styles.value}>
        <Icon id={isImportant ? 'important_filled_color' : 'important'} aria-hidden />
        {isImportant ? (
          <FormattedMessage
            id="global.priorityTierImportant"
            defaultMessage="Important"
            description="Value of the priority of an item that the chatbot gives extra weight in its responses"
          />
        ) : (
          <FormattedMessage
            id="global.priorityTierDefault"
            defaultMessage="Default"
            description="Value of the priority of an item that the chatbot gives no extra weight in its responses"
          />
        )}
      </span>
    </PreviewDetails.Field>
  );
};

export default PriorityTierField;
