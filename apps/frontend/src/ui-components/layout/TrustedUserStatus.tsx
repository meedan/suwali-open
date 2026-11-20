import clsx from 'clsx';
import { FormattedMessage } from "react-intl";

import Icon from "@ui-components/layout/Icon";

import styles from './TrustedUserStatus.module.css';

interface TrustedUserStatusProps {
  className?: string;
  icon?: boolean;
  iconFilled?: boolean;
  label?: 'long' | 'short';
  trusted: boolean;
}

const TrustedUserStatus = ({
  className,
  icon,
  iconFilled,
  label = 'long',
  trusted,
}: TrustedUserStatusProps) => {
  return (
    <span
      className={clsx(
        styles.trustedUserStatus,
        [className],
        {
          [styles.icon]: icon,
          [styles.trusted]: trusted,
        })
      }
    >
      {trusted ?
        <>
          {icon && <Icon id={iconFilled ? 'check_seal_filled' : 'check_seal'} aria-hidden />}
          {label === 'long' &&
            <FormattedMessage
              id="global.trustedEndUser"
              defaultMessage="Trusted end-user"
              description="Reusable label to indicate if the user is a trusted end user or not"
              tagName="span"
            />
          }
          {label === 'short' &&
            <FormattedMessage
              id="global.trustedUserStatustrustedYes"
              defaultMessage="Yes"
              description="Label and icon that indicates the user is a trusted user"
              tagName="span"
            />
          }
        </>
        :
        <>
          {icon && <Icon id="empty" aria-hidden /> }
          {label ==='long' &&
            <FormattedMessage
              id="global.trustedUserStatustrustedNoLabel"
              defaultMessage="Not a trusted end-user"
              description="More verbose label that indicates the user is not a trusted user"
              tagName="span"
            />
          }
          {label === 'short' &&
            <FormattedMessage
              id="global.trustedUserStatustrustedNo"
              defaultMessage="No"
              description="Label and icon that indicates the user is not a trusted user"
              tagName="span"
            />
          }
        </>
      }
    </span>
  );
};

export default TrustedUserStatus;

