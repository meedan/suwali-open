import { useEffect, useState } from 'react';
import { FormattedMessage } from 'react-intl';

import Button from '@ui-components/input/Button';

import styles from './ConnectivityRetry.module.css';

type Props = {
  nextProbeAt: number | null;
  probing: boolean;
  onRetry: () => void;
};

const ConnectivityRetry = ({ nextProbeAt, probing, onRetry }: Props) => {
  const [now, setNow] = useState(Date.now);

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);

  const seconds = nextProbeAt === null ? null : Math.max(1, Math.ceil((nextProbeAt - now) / 1000));

  return (
    <span className={styles.retry}>
      {/* Hidden from screen readers, which would otherwise read out every tick of the live region */}
      <span aria-hidden className={styles.countdown}>
        {probing && (
          <FormattedMessage
            id="global.connectivityChecking"
            defaultMessage="Checking connection…"
            description="Reusable notice shown while the app checks whether it can reach the server again"
          />
        )}
        {!probing && seconds !== null && (
          <FormattedMessage
            id="global.connectivityNextCheck"
            defaultMessage="{seconds, plural, one {Retrying in # second.} other {Retrying in # seconds.}}"
            description="Reusable countdown until the app next checks whether it can reach the server again"
            values={{ seconds }}
          />
        )}
      </span>
      <Button
        label={
          <FormattedMessage
            id="global.connectivityTryNow"
            defaultMessage="Try now"
            description="Reusable button label that checks the connection to the server right away instead of waiting"
          />
        }
        size="small"
        variant="filled"
        themeMode
        disabled={probing}
        onClick={onRetry}
      />
    </span>
  );
};

export default ConnectivityRetry;
