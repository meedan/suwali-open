import type { ReactNode } from 'react';
import { useState } from 'react';
import { FormattedDate, FormattedMessage } from 'react-intl';
import { Link } from 'react-router';

import { dateFormatOptions } from '@helpers/platform-admin';

import type { AttentionUser } from '@services/AdminService';

import Button from '@ui-components/input/Button';
import EmptyState from '@ui-components/layout/EmptyState';
import Icon from '@ui-components/layout/Icon';

import { Can } from '@components/Can';

import styles from './Dashboard.module.css';
import DeleteUserModal from './DeleteUserModal';
import adminStyles from './PlatformAdmin.module.css';

interface AttentionListProps {
  iconId: string;
  iconClassName?: string;
  title: ReactNode;
  description: ReactNode;
  users: AttentionUser[] | undefined;
  showHub: boolean;
  deleteAction?: { invalidateQueryKey: string[] };
}

const AttentionList = ({ iconId, iconClassName, title, description, users, showHub, deleteAction }: AttentionListProps) => {
  const showRequested = users?.some((u) => u.requested_at !== null) ?? false;
  const [deletingUser, setDeletingUser] = useState<AttentionUser | null>(null);

  return (
    <div className={styles.attentionList}>
      <h3>
        <Icon aria-hidden className={iconClassName} id={iconId} />
        {title}
      </h3>
      <p>{description}</p>
      {!users || users.length === 0 ? (
        <EmptyState
          layout="list"
          message={
            <FormattedMessage
              id="admin.attentionListEmpty"
              defaultMessage="None"
              description="Shown when an attention list has no users"
            />
          }
        />
      ) : (
        <div className={adminStyles.tableWrapper}>
          <table>
            <thead>
              <tr>
                <FormattedMessage
                  id="global.email"
                  defaultMessage="Email"
                  description="Reusable email label"
                  tagName="th"
                />
                {showHub && (
                  <FormattedMessage
                    id="global.hub"
                    defaultMessage="Hub"
                    description="Reusable label or title for the word hub that describes an organization’s workspace"
                    tagName="th"
                  />
                )}
                <th className={adminStyles.dateColumn}>
                  <FormattedMessage
                    id="admin.hubsTableCreatedAt"
                    defaultMessage="Created"
                    description="Column header for creation date in the hubs table"
                  />
                </th>
                <th className={adminStyles.dateColumn}>
                  <FormattedMessage
                    id="admin.usersTableLastLogin"
                    defaultMessage="Last sign-in"
                    description="Column header for the date a user last signed in"
                  />
                </th>
                <th className={adminStyles.dateColumn}>
                  <FormattedMessage
                    id="admin.usersTableLastActive"
                    defaultMessage="Last active"
                    description="Column header for the date a user last used the application"
                  />
                </th>
                {showRequested && (
                  <th className={adminStyles.dateColumn}>
                    <FormattedMessage
                      id="admin.attentionTableRequestedAt"
                      defaultMessage="Requested"
                      description="Column header for the date a user requested hub access in the attention users table"
                    />
                  </th>
                )}
                {deleteAction && (
                  <Can action="IS_WRITE_ADMIN">
                    <th className={adminStyles.dateColumn}>
                      <FormattedMessage
                        id="global.actions"
                        defaultMessage="Actions"
                        description="Reusable label for actions list"
                      />
                    </th>
                  </Can>
                )}
              </tr>
            </thead>
            <tbody>
              {users.map((user) => (
                <tr key={`${user.email}-${user.hub_name ?? 'none'}`}>
                  <td>{user.email}</td>
                  {showHub && (
                    <td>
                      {user.hub_id
                        ? <Link to={`/platform-admin/hubs/${user.hub_id}`}>{user.hub_name}</Link>
                        : (user.hub_name ?? '—')}
                    </td>
                  )}
                  <td className={adminStyles.dateColumn}>
                    <FormattedDate value={user.created_at} {...dateFormatOptions} />
                  </td>
                  <td className={adminStyles.dateColumn}>
                    {user.last_login_at ? <FormattedDate value={user.last_login_at} {...dateFormatOptions} /> : '—'}
                  </td>
                  <td className={adminStyles.dateColumn}>
                    {user.last_active_at ? <FormattedDate value={user.last_active_at} {...dateFormatOptions} /> : '—'}
                  </td>
                  {showRequested && (
                    <td className={adminStyles.dateColumn}>
                      {user.requested_at ? <FormattedDate value={user.requested_at} {...dateFormatOptions} /> : '—'}
                    </td>
                  )}
                  {deleteAction && (
                    <Can action="IS_WRITE_ADMIN">
                      <td>
                        <Button
                          label={
                            <FormattedMessage
                              id="global.delete"
                              defaultMessage="Delete"
                              description="Reusable label for delete action"
                            />
                          }
                          themeMode
                          size="small"
                          variant="filled"
                          onClick={() => setDeletingUser(user)}
                        />
                      </td>
                    </Can>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {deleteAction && (
        <DeleteUserModal
          user={deletingUser}
          invalidateQueryKey={deleteAction.invalidateQueryKey}
          open={deletingUser !== null}
          onOpenChange={(open) => { if (!open) setDeletingUser(null); }}
        />
      )}
    </div>
  );
};

export default AttentionList;
