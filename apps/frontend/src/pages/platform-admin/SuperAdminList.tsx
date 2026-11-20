import { useState } from 'react';
import { FormattedDate, FormattedMessage } from 'react-intl';
import { useQuery } from '@tanstack/react-query';

import { dateFormatOptions } from '@helpers/platform-admin';

import { fetchSuperAdmins, type SuperAdmin } from '@services/AdminService';

import Button from '@ui-components/input/Button';
import EmptyState from '@ui-components/layout/EmptyState';

import adminStyles from './PlatformAdmin.module.css';
import UpgradeAdminModal from './UpgradeAdminModal';

const SuperAdminList = () => {
  const [upgradingUser, setUpgradingUser] = useState<SuperAdmin | null>(null);

  const { data: users } = useQuery({
    queryKey: ['/admin/users/super-admins'],
    queryFn: fetchSuperAdmins,
    staleTime: 5 * 60 * 1000,
  });

  return (
    <section id="platform-admins">
      <FormattedMessage
        id="admin.superAdminsTitle"
        defaultMessage="Platform admins ({count})"
        description="Title for the platform admins table section"
        tagName="h2"
        values={{ count: users?.length ?? 0 }}
      />
      <FormattedMessage
        id="admin.superAdminsDescription"
        defaultMessage="Team members with platform admin access. Write admins can modify platform settings while read-only admins have view-only access."
        description="Description for the platform admins section"
        tagName="p"
      />
      {!users || users.length === 0 ? (
        <EmptyState
          message={
            <FormattedMessage
              id="admin.superAdminsEmpty"
              defaultMessage="No platform admins found"
              description="Shown when the platform admins table has no results"
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
                <FormattedMessage
                  id="admin.superAdminsAccess"
                  defaultMessage="Access"
                  description="Column header for the access level of a platform admin"
                  tagName="th"
                />
                <th className={adminStyles.dateColumn}>
                  <FormattedMessage
                    id="admin.hubsTableCreatedAt"
                    defaultMessage="Created"
                    description="Column header for creation date in the hubs table"
                  />
                </th>
                <FormattedMessage
                  id="global.actions"
                  defaultMessage="Actions"
                  description="Reusable label for actions list"
                  tagName="th"
                />
              </tr>
            </thead>
            <tbody>
              {users.map((user) => (
                <tr key={user.id}>
                  <td>{user.email}</td>
                  <td>
                    {user.admin_write_access
                      ? <FormattedMessage
                          id="admin.superAdminsAccessWrite"
                          defaultMessage="Write"
                          description="Access level label for a write platform admin"
                        />
                      : <FormattedMessage
                          id="admin.superAdminsAccessReadOnly"
                          defaultMessage="Read-only"
                          description="Access level label for a read-only platform admin"
                        />
                    }
                  </td>
                  <td className={adminStyles.dateColumn}>
                    <FormattedDate value={user.created_at} {...dateFormatOptions} />
                  </td>
                  <td>
                    {!user.admin_write_access && (
                      <Button
                        label={
                          <FormattedMessage
                            id="admin.upgradeLabel"
                            defaultMessage="Upgrade"
                            description="Label for the button that upgrades a read-only platform admin to write platform admin"
                          />
                        }
                        themeMode
                        size="small"
                        variant="filled"
                        onClick={() => setUpgradingUser(user)}
                      />
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <UpgradeAdminModal
        user={upgradingUser}
        open={upgradingUser !== null}
        onOpenChange={(open) => { if (!open) setUpgradingUser(null); }}
      />
    </section>
  );
};

export default SuperAdminList;
