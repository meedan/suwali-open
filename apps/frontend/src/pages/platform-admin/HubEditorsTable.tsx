import clsx from 'clsx';
import { useState } from 'react';
import { FormattedDate, FormattedMessage } from 'react-intl';

import { dateFormatOptions } from '@helpers/platform-admin';
import { getUserFallback } from '@helpers/user';

import type { AdminHubMembership } from '@services/AdminService';

import Button from '@ui-components/input/Button';
import Avatar from '@ui-components/layout/Avatar';
import Icon from '@ui-components/layout/Icon';

import { Can } from '@components/Can';

import DeleteUserModal from './DeleteUserModal';
import styles from './HubDetails.module.css';
import MoveUserModal from './MoveUserModal';
import adminStyles from './PlatformAdmin.module.css';

interface HubEditorsTableProps {
  memberships: AdminHubMembership[];
  deleteUserQueryKey: string[];
  moveSourceHub?: { id: number; name: string };
}

const HubEditorsTable = ({ memberships, deleteUserQueryKey, moveSourceHub }: HubEditorsTableProps) => {
  const [deletingUser, setDeletingUser] = useState<AdminHubMembership['user'] | null>(null);
  const [movingUser, setMovingUser] = useState<AdminHubMembership['user'] | null>(null);

  return (
  <section>
    <FormattedMessage
      id="admin.hubDetailEditorsTitle"
      defaultMessage="Editors ({count})"
      description="Title for the editors section on the hub detail page, with count"
      tagName="h2"
      values={{ count: memberships.length }}
    />
    <div className={adminStyles.tableWrapper}>
      <table>
        <thead>
          <tr>
            <FormattedMessage
              id="global.editor"
              defaultMessage="Editor"
              description="Label for editor role"
              tagName="th"
            />
            <FormattedMessage
              id="global.email"
              defaultMessage="Email"
              description="Reusable email label"
              tagName="th"
            />
            <FormattedMessage
              id="admin.hubDetailEditorsColumnRole"
              defaultMessage="Role"
              description="Column header for role in the hub editors table"
              tagName="th"
            />
            <FormattedMessage
              id="admin.hubDetailEditorsColumnStatus"
              defaultMessage="Status"
              description="Column header for account status in the hub editors table"
              tagName="th"
            />
            <th className={adminStyles.dateColumn}>
              <FormattedMessage
                id="admin.hubDetailEditorsColumnJoined"
                defaultMessage="Joined"
                description="Column header for hub join date in the hub editors table"
              />
            </th>
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
            <Can action="IS_WRITE_ADMIN">
              <th className={adminStyles.dateColumn}>
                <FormattedMessage
                  id="global.actions"
                  defaultMessage="Actions"
                  description="Reusable label for actions list"
                />
              </th>
            </Can>
          </tr>
        </thead>
        <tbody>
          {memberships.map(({ id: membershipId, user, role, approved, created_at: joinedAt }) => (
            <tr key={membershipId}>
              <td>
                <div className={styles.editorCell}>
                  <Avatar
                    className={styles.editorAvatar}
                    name={user.name}
                    picture={user.profile_picture_url}
                    fallback={getUserFallback(user.name, user.email)}
                  />
                  <span className={styles.editorName}>{user.name || '—'}</span>
                </div>
              </td>
              <td>{user.email}</td>
              <td>
                {role === 'admin'
                  ? <FormattedMessage id="global.admin" defaultMessage="Admin" description="Label for admin role" />
                  : <FormattedMessage id="global.editor" defaultMessage="Editor" description="Label for editor role" />
                }
              </td>
              <td
                className={clsx({
                  [adminStyles.statusGreen]: user.confirmed && approved,
                  [adminStyles.statusPink]: user.confirmed && !approved,
                  [adminStyles.statusYellow]: !user.confirmed,
                })}
              >
                <small
                  className={clsx(styles.editorStatus, {
                    [styles.editorStatusConfirmed]: user.confirmed && approved,
                    [styles.editorStatusPending]: user.confirmed && !approved,
                  })}
                >
                  {user.confirmed && approved ? (
                    <FormattedMessage
                      id="global.confirmedAccount"
                      defaultMessage="{icon}<strong>Confirmed account</strong>"
                      description="Label and icon showing that and account has been verified by the user"
                      values={{
                        strong: chunks => <strong key="s">{chunks}</strong>,
                        icon: <Icon key="icon" aria-hidden id="check_filled" />,
                      }}
                    />
                  ) : !user.confirmed ? (
                    <FormattedMessage
                      id="global.awaitingEmailConfirmation"
                      defaultMessage="{icon}<strong>Awaiting email confirmation</strong>"
                      description="Label and icon showing that the email address for this user needs to be verified by the user"
                      values={{
                        strong: chunks => <strong key="s">{chunks}</strong>,
                        icon: <Icon key="icon" aria-hidden id="countdown_filled" />,
                      }}
                    />
                  ) : (
                    <FormattedMessage
                      id="global.awaitingAccountApproval"
                      defaultMessage="{icon}<strong>Awaiting account approval</strong>"
                      description="Label and icon showing that this membership must be approved by an admin"
                      values={{
                        strong: chunks => <strong key="s">{chunks}</strong>,
                        icon: <Icon key="icon" aria-hidden id="error_filled" />,
                      }}
                    />
                  )}
                </small>
              </td>
              <td className={adminStyles.dateColumn}>
                <FormattedDate value={joinedAt} {...dateFormatOptions} />
              </td>
              <td className={adminStyles.dateColumn}>
                <FormattedDate value={user.created_at} {...dateFormatOptions} />
              </td>
              <td className={adminStyles.dateColumn}>
                {user.last_login_at ? <FormattedDate value={user.last_login_at} {...dateFormatOptions} /> : '—'}
              </td>
              <td className={adminStyles.dateColumn}>
                {user.last_active_at ? <FormattedDate value={user.last_active_at} {...dateFormatOptions} /> : '—'}
              </td>
              {(!user.confirmed || moveSourceHub) && (
                <Can action="IS_WRITE_ADMIN">
                  <td>
                    <div className={styles.editorActions}>
                      {!user.confirmed && (
                        <Button
                          label={
                            <FormattedMessage
                              id="global.delete"
                              defaultMessage="Delete"
                              description="Reusable label for delete action"
                            />
                          }
                          size="small"
                          themeMode
                          variant="filled"
                          onClick={() => setDeletingUser(user)}
                        />
                      )}
                      {moveSourceHub && (
                        <Button
                          label={
                            <FormattedMessage
                              id="admin.moveUser"
                              defaultMessage="Move to hub"
                              description="Button label to move a user into another hub as a write super-admin"
                            />
                          }
                          size="small"
                          themeMode
                          variant="filled"
                          onClick={() => setMovingUser(user)}
                        />
                      )}
                    </div>
                  </td>
                </Can>
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
    <DeleteUserModal
      user={deletingUser}
      invalidateQueryKey={deleteUserQueryKey}
      open={deletingUser !== null}
      onOpenChange={(open) => { if (!open) setDeletingUser(null); }}
    />
    {moveSourceHub && (
      <MoveUserModal
        user={movingUser}
        sourceHub={moveSourceHub}
        open={movingUser !== null}
        onOpenChange={(open) => { if (!open) setMovingUser(null); }}
      />
    )}
  </section>
  );
};

export default HubEditorsTable;
