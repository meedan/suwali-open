import clsx from 'clsx';

import { useSession } from '@root/SessionContext';

import Avatar from '@ui-components/layout/Avatar';

import styles from './OnboardingCardHeader.module.css';

type Props = {
  className?: string;
  title: React.ReactNode;
  subtitle: React.ReactNode;
  children?: React.ReactNode;
};

const OnboardingCardHeader = ({
  className,
  title,
  subtitle,
  children
}: Props) => {
  const hub = useSession().currentHub();

  return (
    <header className={clsx(styles.onboardingCardHeader, className)}>
      <div className={styles.hubCard}>
        <span className={styles.hubName}>{hub?.name}</span>
        <Avatar
          picture={hub?.profile_picture_url ?? undefined}
          name={hub?.name}
          fallback={hub?.name?.trim() ? hub?.name?.charAt(0).toUpperCase() : '…'}
          className={styles.hubImage}
        />
      </div>
      <hgroup>
        <h1>{title}</h1>
        <h2>{subtitle}</h2>
        {children}
      </hgroup>
    </header>
  );
};

export default OnboardingCardHeader;
