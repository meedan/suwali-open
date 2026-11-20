import clsx from 'clsx';
import { FormattedDate, FormattedMessage, useIntl } from 'react-intl';

import styles from './DatePill.module.css';

type DatePillProps = {
  className?: string;
  size?: 'small' | 'medium' | 'large';
  value: Date;
};

const SIZE_CLASSES: Record<NonNullable<DatePillProps['size']>, string> = {
  small: styles.small,
  medium: styles.medium,
  large: styles.large,
};

const isToday = (date: Date) => date.toDateString() === new Date().toDateString();

const DatePill = ({ className, size = 'small', value }: DatePillProps) => {
  const intl = useIntl();

  return (
    <div
      className={clsx(
        styles.pill,
        SIZE_CLASSES[size],
        className
      )}
      title={intl.formatDate(value, { dateStyle: 'full', timeStyle: 'short' })}
    >
      {isToday(value) ? (
        <FormattedMessage
          id="global.conversationsMessagesPaneltoday"
          defaultMessage="Today"
          description="Date separator label"
        />
      ) : (
        <FormattedDate
          day="numeric"
          month="short"
          value={value}
          weekday="short"
          year={value.getFullYear() !== new Date().getFullYear() ? 'numeric' : undefined}
        />
      )}
    </div>
  );
};

export default DatePill;
