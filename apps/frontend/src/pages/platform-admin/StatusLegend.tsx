import clsx from 'clsx';
import { FormattedMessage } from 'react-intl';

import Icon from '@ui-components/layout/Icon';

import styles from './StatusLegend.module.css';

interface StatusLegendProps {
  className?: string;
}

const StatusLegend = ({ className }: StatusLegendProps) => (
  <div className={clsx(styles.legend, className)}>
    <span className={styles.green}>
      <Icon aria-hidden id="check_filled" />
      <FormattedMessage
        id="admin.statusLegendActive"
        defaultMessage="All good"
        description="Status legend label for the green check icon, indicating no issues"
      />
    </span>
    <span className={styles.yellow}>
      <Icon aria-hidden id="countdown_filled" />
      <FormattedMessage
        id="admin.statusLegendExpiring"
        defaultMessage="Worth checking"
        description="Status legend label for the yellow countdown icon, indicating something may need attention soon"
      />
    </span>
    <span className={styles.pink}>
      <Icon aria-hidden id="error_filled" />
      <FormattedMessage
        id="admin.statusLegendAction"
        defaultMessage="Look into this"
        description="Status legend label for the pink error icon, indicating something needs attention"
      />
    </span>
  </div>
);

export default StatusLegend;
