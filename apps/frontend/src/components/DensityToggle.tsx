import { defineMessages, FormattedMessage, type MessageDescriptor, useIntl } from 'react-intl';

import type { Density } from '@hooks/useTableDensity';

import { ToggleGroup, ToggleGroupItem } from '@ui-components/input/ToggleGroup';
import Icon from '@ui-components/layout/Icon';
import Tooltip from '@ui-components/layout/Tooltip';

import styles from './DensityToggle.module.css';

const messages = defineMessages({
  density: {
    id: 'densityToggle.density',
    defaultMessage: 'Display density',
    description: 'Accessibility label for the switch that sets how much information each table row shows',
  },
  compact: {
    id: 'densityToggle.compact',
    defaultMessage: 'Compact',
    description: 'Label for the table row density that shows the least information per row',
  },
  comfortable: {
    id: 'densityToggle.comfortable',
    defaultMessage: 'Comfortable',
    description: 'Label for the table row density that shows more information per row, such as topics',
  },
  compactTooltip: {
    id: 'densityToggle.compactTooltip',
    defaultMessage: 'Compact display density',
    description: 'Tooltip for the button that sets the compact display density, which shows the least information per table row',
  },
  comfortableTooltip: {
    id: 'densityToggle.comfortableTooltip',
    defaultMessage: 'Comfortable display density',
    description: 'Tooltip for the button that sets the comfortable display density, which shows more information per table row, such as topics',
  },
});

const OPTIONS: { value: Density; icon: string; label: MessageDescriptor; tooltip: MessageDescriptor }[] = [
  { value: 'compact', icon: 'compact', label: messages.compact, tooltip: messages.compactTooltip },
  { value: 'comfortable', icon: 'comfortable', label: messages.comfortable, tooltip: messages.comfortableTooltip },
];

type DensityToggleProps = {
  value: Density;
  onChange: (density: Density) => void;
};

const DensityToggle = ({ value, onChange }: DensityToggleProps) => {
  const intl = useIntl();

  // Radix reports an empty value when the selected item is clicked again
  const handleChange = (next: Density) => {
    if (next) onChange(next);
  };

  return (
    <ToggleGroup
      className={styles.densityToggle}
      size="small"
      type="single"
      aria-label={intl.formatMessage(messages.density)}
      value={value}
      onValueChange={handleChange}
    >
      {OPTIONS.map(option => (
        <Tooltip key={option.value} content={<FormattedMessage {...option.tooltip} />}>
          {/* The tooltip trigger sets its own data-state, which would replace the one the item is styled by when selected */}
          <span className={styles.option}>
            <ToggleGroupItem
              iconLeft={<Icon id={option.icon} aria-hidden />}
              value={option.value}
              aria-label={intl.formatMessage(option.label)}
            />
          </span>
        </Tooltip>
      ))}
    </ToggleGroup>
  );
};

export default DensityToggle;
