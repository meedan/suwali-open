import { defineMessages, useIntl } from 'react-intl';

import type { PriorityTier } from '@customTypes/priority-tier';

import Button from '@ui-components/input/Button';
import Icon from '@ui-components/layout/Icon';
import Tooltip from '@ui-components/layout/Tooltip';

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
  disabled?: boolean;
  onToggle?: () => void;
  // only tier 2 is important; the low tier reads as default, like tier 1
  priorityTier: PriorityTier;
  size?: 'small' | 'large';
  variant?: 'text' | 'filled';
};

const PriorityTierToggle = ({ disabled, onToggle, priorityTier, size = 'large', variant = 'text' }: Props) => {
  const intl = useIntl();
  const isImportant = priorityTier === 2;
  const label = intl.formatMessage(isImportant ? messages.toggleDefault : messages.toggleImportant);

  return (
    <Tooltip content={disabled ? intl.formatMessage(messages.availableAfterProcessing) : label} disabled={disabled}>
      <Button
        aria-label={label}
        disabled={disabled}
        iconLeft={<Icon id={isImportant ? 'important_filled_color' : 'important'} aria-hidden />}
        // stops the click reaching a clickable row the toggle may sit inside
        onClick={e => { e.stopPropagation(); onToggle?.(); }}
        size={size}
        themeMode
        variant={variant}
      />
    </Tooltip>
  );
};

export default PriorityTierToggle;
