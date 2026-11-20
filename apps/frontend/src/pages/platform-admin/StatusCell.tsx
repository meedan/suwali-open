import clsx from 'clsx';
import type { ReactNode } from 'react';

import type { StatusColor } from '@helpers/platform-admin';

import adminStyles from './PlatformAdmin.module.css';
import StatusValue from './StatusValue';

interface StatusCellProps {
  status: StatusColor | null;
  tooltip?: ReactNode;
  children?: ReactNode;
  className?: string;
}

const StatusCell = ({ status, tooltip, children, className }: StatusCellProps) => {
  if (!status) {
    return <td className={className}>{children}</td>;
  }

  return (
    <td
      className={clsx(
        className,
        {
          [adminStyles.statusGreen]: status === 'green',
          [adminStyles.statusYellow]: status === 'yellow',
          [adminStyles.statusPink]: status === 'pink',
        },
        tooltip && adminStyles.tooltipCell
      )}
    >
      <StatusValue status={status} tooltip={tooltip} noBackground>{children}</StatusValue>
    </td>
  );
};

export default StatusCell;
