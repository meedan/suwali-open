import clsx from 'clsx';
import { useEffect, useState } from 'react';
import { FormattedMessage } from 'react-intl';
import { useQueryClient } from '@tanstack/react-query';

import { prefetchIcon } from '@helpers/icons';

import { NetworkError } from '@root/NetworkLayer';

import { useConnectivity } from '@hooks/useConnectivity';

import Icon from '@ui-components/layout/Icon';

import styles from './ConnectivityBanner.module.css';
import ConnectivityRetry from './ConnectivityRetry';

const RECONNECTED_DURATION = 4000;

// The live region stays mounted so screen readers announce the message when it changes
const ConnectivityBanner = () => {
  const { connected, probing, nextProbeAt, retryNow } = useConnectivity();
  const queryClient = useQueryClient();
  const [wasConnected, setWasConnected] = useState(connected);
  const [reconnected, setReconnected] = useState(false);

  // Fetched while still online; the icons are only drawn once the connection may be gone
  useEffect(() => {
    prefetchIcon('error');
    prefetchIcon('check');
  }, []);

  if (connected !== wasConnected) {
    setWasConnected(connected);
    setReconnected(connected);
  }

  useEffect(() => {
    if (!reconnected) return;

    queryClient.refetchQueries({ type: 'active', predicate: (query) => query.state.error instanceof NetworkError });
    const timer = setTimeout(() => setReconnected(false), RECONNECTED_DURATION);
    return () => clearTimeout(timer);
  }, [reconnected, queryClient]);

  return (
    <output className={styles.region}>
      {!connected && (
        <span className={clsx(styles.banner, styles.offline)}>
          <Icon id="error" className={styles.icon} aria-hidden />
          <FormattedMessage
            id="global.connectivityOffline"
            defaultMessage="Connection lost. Some things may not load or save."
            description="Reusable notice shown while the device can’t reach the server, because it is offline or the connection is poor"
            tagName="span"
          />
          <ConnectivityRetry nextProbeAt={nextProbeAt} probing={probing} onRetry={retryNow} />
        </span>
      )}
      {reconnected && (
        <span className={styles.banner}>
          <Icon id="check" className={styles.icon} aria-hidden />
          <FormattedMessage
            id="global.connectivityRestored"
            defaultMessage="You’re back online."
            description="Reusable notice shown briefly once the device can reach the server again after losing its connection"
            tagName="span"
          />
        </span>
      )}
    </output>
  );
};

export default ConnectivityBanner;
