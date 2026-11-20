import clsx from 'clsx';
import type { ReactNode } from 'react';
import { useId } from 'react';
import { FormattedMessage } from 'react-intl';

import { useSession } from '@root/SessionContext';

import ListHeader from '@ui-components/layout/ListHeader';

import styles from './ExternalDataSourcesProgress.module.css';

// Past this many, individual slots get too small to read; fall back to a bar.
const MAX_SLOTS = 10;

type MeterProps = { name: ReactNode, current: number, max: number, asSlots?: boolean };

const Meter = ({ name, current, max, asSlots }: MeterProps) => {
  const nameId = useId();
  const countId = useId();
  const a11yProps = { 'aria-labelledby': nameId, 'aria-describedby': countId };

  return (
    <div className={styles.meter}>
      <span className={styles.name} id={nameId}>{name}</span>
      {asSlots ? (
        <div aria-hidden="true" className={styles.slots}>
          {Array.from({ length: max }, (_, i) => (
            <span key={i} className={clsx(styles.slot, { [styles.slotFilled]: i < current })} />
          ))}
        </div>
      ) : (
        <progress className={styles.bar} max={Math.max(max, 1)} value={Math.min(current, max)} {...a11yProps} />
      )}
      <span className={styles.count} id={countId}>
        <FormattedMessage
          id="externalDataSourcesProgress.count"
          defaultMessage="{current, number} of {max, number}"
          description="How much of a plan limit is used, e.g. 720 of 8,000"
          values={{ current, max }}
        />
      </span>
    </div>
  );
};

const ExternalDataSourcesProgress = () => {
  const session = useSession();
  const hub = session.currentHub();

  if (!hub) {
    return null;
  }

  const currentSourcesCount = hub.external_data_sources_count;
  const currentDocumentsCount = hub.documents_count;
  const maxSources = hub.max_sources_for_plan;
  const maxDocuments = hub.max_documents_for_plan;

  const title = (
    <FormattedMessage
      id="global.externalDataSources"
      defaultMessage="External data sources"
      description="Reusable external data sources label"
    />
  );

  if (maxSources === null && maxDocuments === null) {
    return <ListHeader count={currentSourcesCount} sticky title={title} />;
  }

  return (
    <ListHeader
      className={styles.container}
      sticky
      title={title}
      caption={
        <div className={styles.limits}>
          {maxSources !== null && (
            <Meter
              asSlots={maxSources <= MAX_SLOTS}
              current={currentSourcesCount}
              max={maxSources}
              name={
                <FormattedMessage
                  id="global.sources"
                  defaultMessage="Sources"
                  description="Generic title or label shortened version of data sources"
                />
              }
            />
          )}
          {maxDocuments !== null && (
            <Meter
              current={currentDocumentsCount}
              max={maxDocuments}
              name={
                <FormattedMessage
                  id="global.documents"
                  defaultMessage="Documents"
                  description="Reusable label for documents page or list title"
                />
              }
            />
          )}
        </div>
      }
    />
  );
};

export default ExternalDataSourcesProgress;
