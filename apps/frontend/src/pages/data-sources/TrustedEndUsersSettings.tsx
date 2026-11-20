import { VisuallyHidden } from 'radix-ui'
import { useMemo, useState } from "react";
import { FormattedMessage } from "react-intl";
import { useQueries, useQueryClient } from "@tanstack/react-query";

import type { ExternalUser } from '@customTypes/external-user';

import { getExternalId } from '@helpers/conversation';

import { fetchHubTrustedEndUsers } from "@services/HubService";

import { useSession } from "@root/SessionContext";

import Button from "@ui-components/input/Button";
import EmptyState from "@ui-components/layout/EmptyState";
import Icon from "@ui-components/layout/Icon";
import PlatformCaption from "@ui-components/layout/PlatformCaption";

import { Can } from '@components/Can';

import AddTrustedEndUserModal from './AddTrustedEndUserModal';
import styles from './DataSourcesContributionsSettings.module.css';
import documentsPanelStyles from './DataSourcesDocumentsPanel.module.css';
import TrustedEndUserActionsMenu from './TrustedEndUserActionsMenu';

const TrustedEndUsersSettings = () => {
  const [addModalOpen, setAddModalOpen] = useState(false);
  const session = useSession();
  const hubId = session.currentHubId();
  const queryClient = useQueryClient();

  const refetchTrustedEndUsers = () =>
    queryClient.invalidateQueries({ queryKey: [`/hubs/${hubId}/external-users?trusted=true`] });

  const [trustedEndUsersQuery] = useQueries({
    queries: [
      { queryKey: [`/hubs/${hubId}/external-users?trusted=true`], queryFn: () => fetchHubTrustedEndUsers(hubId!), enabled: Boolean(hubId) },
    ],
  });

  const trustedEndUsers = useMemo(() => trustedEndUsersQuery.data || [], [trustedEndUsersQuery.data]);

  return (
    <>
      <div className={styles.trustedEndUsersHeader}>
        <FormattedMessage
          id="global.endUserAllowlistCount"
          defaultMessage="End-user allowlist ({count})"
          description="Title of the trusted end-users table, with the number of end-users on the allowlist"
          values={{ count: trustedEndUsers.length }}
          tagName="h3"
        />
        <Can action="MANAGE_EXTERNAL_USERS">
          <Button
            iconLeft={<Icon aria-hidden id="plus" />}
            label={
              <FormattedMessage
                id="global.addEndUser"
                defaultMessage="Add end-user"
                description="Button label to open the modal for adding an end-user to the allowlist"
              />
            }
            size="small"
            themeMode
            onClick={() => setAddModalOpen(true)}
          />
        </Can>
      </div>
      <table aria-labelledby="tableCaption">
        <VisuallyHidden.Root asChild>
          <caption id="tableCaption">
            <FormattedMessage
              id="dataSourcesContributionsSettings.tableCaption"
              defaultMessage="Table with trusted end-users"
              description="Accessibility caption for the table that shows trusted end-users"
            />
          </caption>
        </VisuallyHidden.Root>
        <thead>
          <tr>
            <th scope="col">
              <FormattedMessage
                id="global.userId"
                defaultMessage="End-user ID"
                description="Column header for the external user identifier in the trusted end-users table"
              />
            </th>
            <th scope="col">
              <FormattedMessage
                id="global.username"
                defaultMessage="Username"
                description="Reusable label for the username of an end-user on a messaging platform"
              />
            </th>
            <th scope="col" className={documentsPanelStyles.tableHeaderPlatformColumn}>
              <FormattedMessage
                id="global.platform"
                defaultMessage="Platform"
                description="Reusable label for the platform the conversation is from"
              />
            </th>
            <th scope="col" className="table-row-actions"></th>
          </tr>
        </thead>
        <tbody>
        {trustedEndUsers.length > 0 ? (
          trustedEndUsers.map((user: ExternalUser) => {
            const { value: formattedId } = getExternalId(user.platform, user.external_id);
            return (
              <tr key={user.id}>
                <td>{formattedId}</td>
                <td>{user.name || <FormattedMessage id="global.trustedEndUserNoName" defaultMessage="Username available once first message is sent" description="Reusable placeholder for an end-user whose username is not known yet" tagName="i" />}</td>
                <td><PlatformCaption id={user.platform} /></td>
                <td className="table-row-actions">
                  <TrustedEndUserActionsMenu
                    user={user}
                    onRemoveSuccess={refetchTrustedEndUsers}
                  />
                </td>
              </tr>
            );
          })
        ) : (
          <tr className={documentsPanelStyles.noDocuments}>
            <td colSpan={4}>
              <EmptyState
                icon="users"
                message={
                  <FormattedMessage
                    id="global.dataSourcesTrustedEndUsersTableEmpty"
                    defaultMessage="There are no trusted end-users."
                    description="Empty message for table with no rows"
                  />
                }
              />
            </td>
          </tr>
        )}
        </tbody>
        <tfoot className={documentsPanelStyles.scrollObserver}>
          <tr><td colSpan={4}><span className="scroll-observer-large"></span></td></tr>
        </tfoot>
      </table>
      <AddTrustedEndUserModal open={addModalOpen} onOpenChange={setAddModalOpen} />
    </>
  );
};

export default TrustedEndUsersSettings;
