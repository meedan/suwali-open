import clsx from 'clsx';
import type { ReactNode } from 'react';

import type { StatusColor } from '@helpers/platform-admin';
import { getStatusIcon } from '@helpers/platform-admin';

import Icon from '@ui-components/layout/Icon';
import Tooltip from '@ui-components/layout/Tooltip';

import adminStyles from './PlatformAdmin.module.css';

interface StatusValueProps {
  status: StatusColor | null;
  tooltip?: ReactNode;
  children?: ReactNode;
  noBackground?: boolean;
}

const StatusValue = ({ status, tooltip, children, noBackground }: StatusValueProps) => {
  if (!status) return <>{children}</>;

  const content = (
    <div className={clsx(
      adminStyles.dataStatus,
      !noBackground &&
      {
        [adminStyles.statusGreen]: status === 'green',
        [adminStyles.statusYellow]: status === 'yellow',
        [adminStyles.statusPink]: status === 'pink',
      }
    )}>
      <Icon aria-hidden id={getStatusIcon(status)} />
      {children}
    </div>
  );

  return tooltip ? <Tooltip content={tooltip}>{content}</Tooltip> : content;
};

export default StatusValue;
