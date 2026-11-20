import clsx from 'clsx';
import { useEffect, useRef } from 'react';
import { FormattedDate, FormattedMessage, useIntl } from 'react-intl';

import { useHubPath } from '@hooks/useHubPath';
import { useIsMobileScreen } from '@hooks/useLayout';
import usePageTitle from '@hooks/usePageTitle';
import { useUpdates } from '@hooks/useUpdates';

import Button from '@ui-components/input/Button';
import { Layout } from '@ui-components/layout/Layout';
import MetaList from '@ui-components/layout/MetaList';
import MainPagesNav from '@ui-components/navigation/MainPagesNav';

import EditableTitle from '@components/EditableTitle';

import { type Update, updates } from './updates';
import styles from './UpdatesMain.module.css';

type UpdateItemProps = {
  item: Update;
  isRead: boolean;
  onRead: (id: string) => void;
};

const UpdateItem = ({ item, isRead, onRead }: UpdateItemProps) => {
  const hubPath = useHubPath();
  const intl = useIntl();
  const ref = useRef<HTMLLIElement>(null);
  const title = typeof item.title === 'function' ? item.title(hubPath, intl) : item.title;
  const thumbNail = typeof item.thumbNail === 'function' ? item.thumbNail(hubPath, intl) : item.thumbNail;
  const content = typeof item.content === 'function' ? item.content(hubPath, intl) : item.content;

  useEffect(() => {
    if (isRead || !ref.current) return;

    const el = ref.current;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          onRead(item.id);
          observer.disconnect();
        }
      },
      { threshold: 0.5 }
    );

    observer.observe(el);
    return () => observer.disconnect();
  }, [isRead, item.id, onRead]);

  return (
    <li ref={ref} className={styles.updatesListItem}>
      <div className={styles.itemContentWrapper}>
        <hgroup>
          <span>
            {!isRead && (
              <FormattedMessage
                id="global.new"
                defaultMessage="New"
                description="Generic title or label for new items"
                tagName="small"
              />
            )}
            <time dateTime={item.date}>
              <FormattedDate
                value={item.date}
                month="long"
                day="numeric"
                year="numeric"
                timeZone="UTC"
              />
            </time>
          </span>
          <h3>{title}</h3>
        </hgroup>
        <div className={styles.itemContent}>
          {content}
        </div>
      </div>
      {thumbNail && <div className={styles.itemThumbnail}>{thumbNail}</div>}
    </li>
  );
};

const UpdatesMain = () => {
  const isMobileScreen = useIsMobileScreen();
  const { isRead, markAllAsRead, markAsRead, unreadCount } = useUpdates();

  usePageTitle(
    <FormattedMessage
      id="global.updates"
      defaultMessage="Updates"
      description="Generic title or label for updates areas"
    />
  );

  return (
    <Layout>
      {!isMobileScreen && (
        <Layout.Left homePage>
          <MainPagesNav homePage />
        </Layout.Left>
      )}
      <Layout.Main
        name={
          <FormattedMessage
            id="global.updates"
            defaultMessage="Updates"
            description="Generic title or label for updates areas"
          />
        }
      >
        <div className={clsx('layout-main-column-scrollable-area', styles.updatesWrapper)}>
          <EditableTitle
            className={styles.updatesTitle}
            canEdit={false}
            displayValue={
              <FormattedMessage
                id="global.suwaliUpdates"
                defaultMessage="Suwali updates"
                description="Navigation label for the product updates page"
              />
            }
            renderMeta={
              <MetaList>
                <FormattedMessage
                  id="global.suwaliUpdatesDescription"
                  defaultMessage="Stay up to date with the latest Suwali features and improvements."
                  description="Description for the product updates page"
                  tagName={MetaList.Item}
                />
                <MetaList.Item>
                  <Button
                    themeMode
                    size="small"
                    label={
                      <FormattedMessage
                        id="updates.markAllAsRead"
                        defaultMessage="Mark all as read"
                        description="Button label to mark all updates as read"
                      />
                    }
                    onClick={markAllAsRead}
                    disabled={unreadCount === 0}
                  />
                </MetaList.Item>
              </MetaList>
            }
          />
          <div className={styles.updatesListWrapper}>
            <ul className={styles.updatesList}>
              {updates.map(item => (
                <UpdateItem
                  key={item.id}
                  item={item}
                  isRead={isRead(item.id)}
                  onRead={markAsRead}
                />
              ))}
            </ul>
          </div>
        </div>
      </Layout.Main>
    </Layout>
  );
};

export default UpdatesMain;
