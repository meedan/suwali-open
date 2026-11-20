import { FormattedMessage } from 'react-intl';

import type { User } from '@customTypes/user';

import Button from '@ui-components/input/Button';
import { Modal } from '@ui-components/layout/Modal';

type ConfirmDeleteMembershipModalProps = {
  open: boolean;
  user: User | null;
  onCancel: () => void;
  onConfirm: () => void;
};

const ConfirmDeleteMembershipModal = ({
  open,
  user,
  onCancel,
  onConfirm,
}: ConfirmDeleteMembershipModalProps) => (
  <Modal
    alert
    title={
      <FormattedMessage
        id="global.confirmDeleteMembershipModaltitle"
        defaultMessage="Remove editor?"
        description="Confirmation dialog title before removing an editor."
      />
    }
    titleContext={<strong>{user?.name ? user?.name : user?.email}</strong>}
    open={open}
    size="small"
    actions={
      <>
        <Button
          label={
            <FormattedMessage
              id="global.cancel"
              defaultMessage="Cancel"
              description="Reusable label for cancel buttons"
            />
          }
          size="small"
          themeMode
          variant="text"
          onClick={onCancel}
        />
        <Button
          label={
            <FormattedMessage
              id="global.confirmDeleteMembershipModalconfirm"
              defaultMessage="Remove editor"
              description="Confirmation dialog submit button label before removing an editor."
            />
          }
          size="small"
          onClick={onConfirm}
        />
      </>
    }
    body={
      <>
        <FormattedMessage
          id="global.confirmDeleteMembershipModalwarningMessage"
          defaultMessage="Editor <strong>{name}</strong> will be removed."
          description="Confirmation dialog message before removing an editor."
          tagName="p"
          values={{
            name: user?.name ? user?.name : user?.email,
            strong: msg => (<strong key="strong">{msg}</strong>),
          }}
        />
        <FormattedMessage
          id="global.confirmDeleteMembershipModalinviteCodeWillBeInvalidated"
          defaultMessage="The current invite code will be invalidated and a new one will be automatically created."
          description="Confirmation dialog message before an invite code is recreated"
          tagName="p"
        />
        <FormattedMessage
          id="global.areYouSure"
          defaultMessage="Are you sure?"
          description="Generic confirmation message."
          tagName="p"
        />
      </>
    }
  />
);

export default ConfirmDeleteMembershipModal;
