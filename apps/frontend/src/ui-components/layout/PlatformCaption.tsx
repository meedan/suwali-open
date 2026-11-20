import clsx from 'clsx';

import { getPlatformIcon, getPlatformName, platformIconNeedsInlineSvg } from "@helpers/conversation";

import Icon from "@ui-components/layout/Icon";

import styles from './PlatformCaption.module.css';

interface PlatformCaptionProps {
  className?: string;
  id: string;
}

const PlatformCaption = ({
  className,
  id,
}: PlatformCaptionProps) => {
  return (
    <span className={clsx(styles.platformCaption, [className])}>
      <Icon id={getPlatformIcon(id)} inlineSvg={platformIconNeedsInlineSvg(id)} aria-label={getPlatformName(id)} />
      {getPlatformName(id)}
    </span>
  );
};

export default PlatformCaption;
