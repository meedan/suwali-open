import clsx from 'clsx';
import { useMemo, useState } from "react";
import { defineMessages, FormattedMessage, useIntl } from "react-intl";
import { useQueries } from "@tanstack/react-query";

import type { User } from "@customTypes/user";

import { getUserFallback } from "@helpers/user";

import { approveMembership, fetchHub, fetchHubEditors, removeEditor, updateInviteCode, updateMembershipRole } from "@services/HubService";

import { useSession } from "@root/SessionContext";

import { useToast } from "@hooks/useToast";

import Button from '@ui-components/input/Button';
import { Select, SelectItem } from '@ui-components/input/SelectInput';
import Avatar from "@ui-components/layout/Avatar";
import Icon from '@ui-components/layout/Icon';

import { Can } from "@components/Can";
import CopyToClipboardButton from '@components/CopyToClipboardButton';

import ConfirmDeleteMembershipModal from "./ConfirmDeleteMembershipModal";
import styles from './Team.module.css';

const messages = defineMessages({
  removeEditorSuccess: {
    id: 'global.editorsremoveSuccess',
    defaultMessage: 'Editor removed successfully.',
    description: 'Message shown in a toast when an editor is removed successfully',
  },
  removeEditorError: {
    id: 'global.editorsremoveError',
    defaultMessage: 'There was an error removing the editor. Please try again.',
    description: 'Message shown in a toast when there is an error removing an editor',
  },
  updateCodeSuccess: {
    id: 'global.editorscodeUpdateSuccess',
    defaultMessage: 'Invite code updated successfully.',
    description: 'Message shown in a toast when the invite code is updated successfully',
  },
  updateCodeError: {
    id: 'global.editorscodeUpdateError',
    defaultMessage: 'There was an error updating the invite code. Please try again.',
    description: 'Message shown in a toast when there is an error updating the invite code',
  },
  updateRoleSuccess: {
    id: 'global.editorsroleUpdateSuccess',
    defaultMessage: 'Role updated successfully.',
    description: 'Message shown in a toast when a role is updated successfully',
  },
  updateRoleError: {
    id: 'global.editorsroleUpdateError',
    defaultMessage: 'There was an error updating the role. Please try again.',
    description: 'Message shown in a toast when there is an error updating a role',
  },
  approveMembershipSuccess: {
    id: 'team.approveMembershipSuccess',
    defaultMessage: 'Membership approved successfully.',
    description: 'Message shown in a toast when a membership is approved successfully',
  },
  approveMembershipError: {
    id: 'team.approveMembershipError',
    defaultMessage: 'There was an error approving the membership. Please try again.',
    description: 'Message shown in a toast when there is an error approving a membership',
  },
  inviteCodeCopied: {
    id: 'team.inviteCodeCopied',
    defaultMessage: 'Invite code copied to clipboard',
    description: 'Toast shown when the invite code is copied to the clipboard',
  },
});

const Team = () => {
  const intl = useIntl();
  const { toast } = useToast();
  const session = useSession();
  const hubId = session.currentHubId();
  const userId = session.user?.id;
  const [membershipToDeleteId, setMembershipToDeleteId] = useState<number | null>(null);

  const [hubQuery, teamQuery] = useQueries({
    queries: [
      { queryKey: [`/hubs/${hubId}`], queryFn: () => fetchHub(hubId!), enabled: Boolean(hubId) },
      { queryKey: [`/hubs/${hubId}/memberships`], queryFn: () => fetchHubEditors(hubId!), enabled: Boolean(hubId) },
    ],
  });

  const team = useMemo(() => teamQuery.data || [], [teamQuery.data]);

  const handleApproveMembership = async (membershipId: number) => {
    try {
      await approveMembership(hubId!, membershipId);
      toast('success', intl.formatMessage(messages.approveMembershipSuccess));
      teamQuery.refetch();
    } catch {
      toast('error', intl.formatMessage(messages.approveMembershipError));
    }
  };

  const handleRoleChange = async (membershipId: number, newRole: 'admin' | 'editor') => {
    try {
      await updateMembershipRole(hubId!, membershipId, newRole);
      toast('success', intl.formatMessage(messages.updateRoleSuccess));
      teamQuery.refetch();
    } catch {
      toast('error', intl.formatMessage(messages.updateRoleError));
    }
  };

  const handleRemoveEditor = async () => {
    try {
      await removeEditor(hubId!, membershipToDeleteId!);
      toast('success', intl.formatMessage(messages.removeEditorSuccess));
      teamQuery.refetch();
    } catch {
      toast('error', intl.formatMessage(messages.removeEditorError));
    }
  };

  const handleUpdateInviteCode = async () => {
    try {
      await updateInviteCode(hubId!);
      toast('success', intl.formatMessage(messages.updateCodeSuccess));
      hubQuery.refetch();
    } catch {
      toast('error', intl.formatMessage(messages.updateCodeError));
    }
  };

  return (
    <>
      <FormattedMessage
        id="global.inviteCode"
        defaultMessage="Invite code"
        description="Reusable label for invite code"
        tagName="h3"
      />
      <div className={styles.inviteCodeWrapper}>
        <div className={styles.inviteCodeDescription}>
          <FormattedMessage
            id="global.teamInviteDescription"
            defaultMessage="Invite new people to join by sending them this invite code and directing them to complete the form at:"
            description="Description on how to invite new people to the team"
            tagName="p"
          />
          <a href="https://app.suwali.io/signup" title="Suwali">https://app.suwali.io/signup</a>
        </div>
        <div className={styles.inviteCodeActions}>
          <div className={styles.inviteCode}>
            {hubQuery.data?.invite_code}
            <CopyToClipboardButton
              iconLeft={<Icon id="clipboard" aria-hidden />}
              size="small"
              variant="filled"
              themeMode
              value={hubQuery.data?.invite_code ?? undefined}
              successMessage={intl.formatMessage(messages.inviteCodeCopied)}
            />
          </div>
          <Can action="UPDATE_HUB">
            <Button
              iconLeft={<Icon id="arrow_clockwise" aria-hidden />}
              label={
                <FormattedMessage
                  id="global.teamcodeButtonLabel"
                  defaultMessage="Change code"
                  description="Button label for changing the invite code"
                />
              }
              size="small"
              variant="text"
              themeMode
              onClick={handleUpdateInviteCode}
            />
          </Can>
        </div>
      </div>
      <div className={styles.teamList}>
        <FormattedMessage
          id="global.teamPeopleHeader"
          defaultMessage="People ({count})"
          description="Header text that includes the number of team listed below"
          tagName="h3"
          values={{ count: team.length }}
        />
        <ul>
          {team.map(({ id: membershipId, user: editor, role, approved }: { id: number, user: User, role: string, approved: boolean }) => (
            <li key={editor.id}>
              <Avatar
                className={styles.editorPhoto}
                name={editor.name}
                picture={editor.profile_picture_url}
                fallback={getUserFallback(editor.name, editor.email)}
              />
              <div>
                <span>{editor.name ? editor.name : '-'}</span>
                <small>
                  <strong><FormattedMessage id="global.email" defaultMessage="Email" description="Reusable email label" />:</strong> {editor.email}
                </small>
                {!approved && (
                  <Can action="APPROVE_MEMBERSHIP" mode="disable">
                    <Button
                      className={styles.approveMembership}
                      label={
                        <FormattedMessage
                          id="team.approve"
                          defaultMessage="Approve account"
                          description="Button label to approve membership"
                        />
                      }
                      size="small"
                      variant="filled"
                      onClick={() => handleApproveMembership(membershipId)}
                    />
                  </Can>
                )}
                {approved && (
                  <Can action="MANAGE_ADMINS" mode="disable">
                    <Select
                      disabled={userId === editor.id}
                      className={styles.roleSelect}
                      size="small"
                      value={role}
                      onValueChange={(newRole) => handleRoleChange(membershipId, newRole as 'admin' | 'editor')}
                    >
                      <SelectItem value="editor">
                        <FormattedMessage
                          id="global.editor"
                          defaultMessage="Editor"
                          description="Label for editor role"
                        />
                      </SelectItem>
                      <SelectItem value="admin">
                        <FormattedMessage
                          id="global.admin"
                          defaultMessage="Admin"
                          description="Label for admin role"
                        />
                      </SelectItem>
                    </Select>
                  </Can>
                )}
              </div>
              <div>
                <small
                  className={clsx(
                    [styles.editorConfirmation],
                    {
                      [styles.editorConfirmed]: editor.confirmed && approved,
                      [styles.editorPendingApproval]: !approved,
                    })
                  }
                >
                  {approved && editor.confirmed && (
                    <FormattedMessage
                      id="global.confirmedAccount"
                      defaultMessage="{icon}<strong>Confirmed account</strong>"
                      description="Label and icon showing that and account has been verified by the user"
                      values={{
                        strong: msg => <strong key="strong">{msg}</strong>,
                        icon: <Icon key="icon" aria-hidden id="check_seal_filled" />
                      }}
                    />
                  )}
                  {!editor.confirmed && (
                    <FormattedMessage
                      id="global.awaitingEmailConfirmation"
                      defaultMessage="{icon}<strong>Awaiting email confirmation</strong>"
                      description="Label and icon showing that the email address for this user needs to be verified by the user"
                      values={{
                        strong: msg => <strong key="strong">{msg}</strong>,
                        icon: <Icon key="icon" aria-hidden id="triangle_dashed" />
                      }}
                    />
                  )}
                  {!approved && editor.confirmed && (
                    <FormattedMessage
                      id="global.awaitingAccountApproval"
                      defaultMessage="{icon}<strong>Awaiting account approval</strong>"
                      description="Label and icon showing that this membership must be approved by an admin"
                      values={{
                        strong: msg => <strong key="strong">{msg}</strong>,
                        icon: <Icon key="icon" aria-hidden id="countdown" />
                      }}
                    />
                  )}
                </small>
                {userId !== editor.id &&
                  <Can action="REMOVE_EDITOR">
                    <Button
                      label={
                        <FormattedMessage
                          id="global.remove"
                          defaultMessage="Remove"
                          description="Reusable label for remove action"
                        />
                      }
                      size="small"
                      themeMode
                      onClick={() => setMembershipToDeleteId(membershipId)}
                    />
                  </Can>
                }
              </div>
            </li>
          ))}
        </ul>
      </div>
      <ConfirmDeleteMembershipModal
        open={Boolean(membershipToDeleteId)}
        user={team.find(({ id }: { id: number }) => id === membershipToDeleteId)?.user || null}
        onCancel={() => setMembershipToDeleteId(null)}
        onConfirm={() => {
          handleRemoveEditor();
          setMembershipToDeleteId(null);
        }}
      />
    </>
  );
};

export default Team;
