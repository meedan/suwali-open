import clsx from 'clsx';
import type { ReactNode } from 'react';
import { FormattedMessage } from 'react-intl';

import styles from "./LoadingIndicator.module.css";

type PanelLoadingProps = {
  appLevel?: boolean;
  className?: string;
};

export const PanelLoading = ({ appLevel = false, className }: PanelLoadingProps) => (
  <div
    className={clsx(
      styles.panelLoading,
      className,
      {
        [styles.appLoading]: appLevel,
      })
    }
  >
    <FormattedMessage
      id="global.loadingMessageloading"
      defaultMessage="Loading…"
      description="Loading message indicator that a section of the app is still loading"
      tagName="span"
    />
  </div>
);

type ListSkeletonProps = {
  count?: number;
  skipHeader?: boolean;
};

export const ListSkeleton = ({ count = 1, skipHeader = false }: ListSkeletonProps) => (
  <div className={clsx(styles.listSkeleton, 'skeleton')}>
    {!skipHeader && <header><span /></header>}
    {[...Array(count)].map((_, index) => (
      <article key={index}>
        <span />
        <div>
          <span /><span /><span />
        </div>
      </article>
    ))}
  </div>
);

const getRandomInt = (min: number, max: number) => Math.round((Math.random() * Math.abs(max - min)) + min);

type ConversationSkeletonProps = {
  className?: string;
  messages?: number;
};

export const ConversationSkeleton = ({ className, messages = 1 }: ConversationSkeletonProps) => (
  <div className={clsx(styles.conversationSkeleton, className, 'skeleton')}>
    {[...Array(messages)].map((_, index) => (
      <div
        key={index}
        className={clsx(styles.messageWrapper,
          {
            [styles.incoming]: index % 2 !== 0,
          }
        )}
      >
        <div>
          <span style={{width: `${getRandomInt(200, 800)}px`}} />
          <span style={{width: `${getRandomInt(150, 400)}px`}} />
          <span style={{width: `${getRandomInt(100, 200)}px`}} />
          <span />
        </div>
      </div>
    ))}
  </div>
);

type TableSkeletonProps = {
  className?: string;
  rows?: number;
};

export const TableSkeleton = ({ className, rows = 1 }: TableSkeletonProps) => (
  <div className={clsx(styles.tableSkeleton, className, 'skeleton')}>
    <div className={styles.tableHeader}>
      <span /><span />
    </div>
    <div className={styles.tableLoading}>
      <table>
        <thead>
          <tr>
            <th scope="col">
              <span />
            </th>
            <th scope="col">
              <span />
            </th>
          </tr>
        </thead>
        <tbody>
          {[...Array(rows)].map((_, index) => (
            <tr key={index}>
              <td>
                <span />
              </td>
              <td>
                <span />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  </div>
);

type PollingLoadingProps = {
  size?: 'small' | 'medium' | 'large';
  className?: string;
  message?: ReactNode;
};

export const PollingLoading = ({ size = 'small', className, message }: PollingLoadingProps) => {
  const indicator = (
    <span
      className={clsx(
        [styles.pollingLoading],
        {
          [styles.sizeSmall]: size === 'small',
          [styles.sizeMedium]: size === 'medium',
          [styles.sizeLarge]: size === 'large',
        },
        !message && className
      )}
    >
      <span className={styles.pollingPing} />
      <span />
    </span>
  );

  if (!message) {
    return indicator;
  }

  return (
    <span
      className={clsx(
        styles.pollingLoadingWithMessage,
        {
          [styles.sizeSmall]: size === 'small',
          [styles.sizeMedium]: size === 'medium',
          [styles.sizeLarge]: size === 'large',
        },
        className
      )}
    >
      {indicator}
      <span className={styles.pollingMessage}>{message}</span>
    </span>
  );
};
