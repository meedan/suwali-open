import clsx from 'clsx';
import React, { memo, useCallback, useMemo, useRef } from 'react';
import type { IntlShape } from 'react-intl';
import { defineMessages, useIntl } from 'react-intl';

import Icon from "./Icon";
import styles from './ListItem.module.css';

const messages = defineMessages({
  arrowIcon: {
    id: 'global.rightArrow',
    defaultMessage: 'Right arrow',
    description: 'Accessibility label to the image is an arrow pointing right',
  },
  website: {
    id: 'global.websiteSource',
    defaultMessage: 'Website',
    description: 'Label for Website source type',
  },
});

const getTranslatedSourceName = (title: string | React.ReactNode, intl: IntlShape) => {
  if (typeof title !== 'string') return title;

  if (title.toLowerCase() === 'website') {
    return intl.formatMessage(messages.website);
  }

  return title;
};


interface ListItemProps {
  id?: string;
  caption?: string | React.ReactNode;
  className?: string;
  icon: React.ReactNode;
  isActive?: boolean;
  isPaused?: boolean;
  isPublished?: boolean;
  hoverAction?: React.ReactNode;
  navigateAction?: boolean;
  tabIndex?: number;
  title: string | React.ReactNode;
  type?: string | React.ReactNode;
  onClick?: () => void;
}

const ListItem: React.FC<ListItemProps> = ({
  caption,
  className,
  icon,
  id,
  isActive = false,
  isPaused = false,
  isPublished = false,
  hoverAction,
  navigateAction = false,
  tabIndex = 0,
  title,
  type,
  onClick,
}) => {
  const intl = useIntl();
  const translatedTitle = useMemo(() => getTranslatedSourceName(title, intl), [title, intl]);
  const h4Ref = useRef<HTMLHeadingElement>(null);
  const spanRef = useRef<HTMLSpanElement>(null);

  const handleTitleMouseEnter = useCallback(() => {
    const h4 = h4Ref.current;
    const span = spanRef.current;
    if (!h4 || !span) return;

    const overflow = span.scrollWidth - h4.offsetWidth;
    if (overflow <= 0) return;

    const isRtl = document.documentElement.dir === 'rtl';
    const duration = Math.max(1.5, overflow / 50);
    span.style.setProperty('--scroll-distance', `${isRtl ? overflow : -overflow}px`);
    span.style.setProperty('--scroll-duration', `${duration}s`);
    span.classList.add(styles.scrolling);
  }, []);

  const handleTitleMouseLeave = useCallback(() => {
    spanRef.current?.classList.remove(styles.scrolling);
  }, []);

  const wrapperClassName = clsx(
    [className],
    styles.listItemWrapper,
    {
      [styles.clickable]: onClick,
      [styles.active]: isActive,
      [styles.paused]: isPaused,
      [styles.published]: isPublished,
    }
  );

  const mainContent = (
    <>
      <div className={clsx('iconWrapper', styles.icon)}>{icon}</div>
      <div className={styles.content}>
        <hgroup>
          <h4 ref={h4Ref}>
            <span ref={spanRef}>{translatedTitle}</span>
          </h4>
          {type && (<div className={styles.type}>{type}</div>)}
          <span>{caption}</span>
        </hgroup>
      </div>
      {navigateAction && (<Icon aria-label={intl.formatMessage(messages.arrowIcon)} className={clsx(styles.navigateAction, 'icon-flip-rtl')} id="chevron_right" />)}
    </>
  );

  const hoverActionContent = (hoverAction) && (
    <div className={styles.hoverActionWrapper}>
      {hoverAction &&
        <div>
          {hoverAction}
        </div>
      }
    </div>
  );

  return (
    <div
      id={id}
      className={wrapperClassName}
      aria-current={onClick ? undefined : isActive ? 'true' : undefined}
      onMouseEnter={handleTitleMouseEnter}
      onMouseLeave={handleTitleMouseLeave}
    >
      {onClick ? (
        <button
          type="button"
          className={styles.mainAction}
          aria-current={isActive ? 'true' : undefined}
          onClick={onClick}
          tabIndex={tabIndex}
        >
          {mainContent}
        </button>
      ) : (
        <div className={styles.mainAction} tabIndex={-1}>
          {mainContent}
        </div>
      )}
      {hoverActionContent}
    </div>
  );
}

export default memo(ListItem);
