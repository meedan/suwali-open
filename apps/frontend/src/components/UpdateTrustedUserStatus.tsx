import { useState } from 'react';
import { FormattedMessage } from 'react-intl';
import { useQueryClient } from '@tanstack/react-query';

import type { ExternalUser } from '@customTypes/external-user';

import { useSession } from '@root/SessionContext';

import Button from '@ui-components/input/Button';

import ConfirmTrustedUserStatusModal from './ConfirmTrustedUserStatusModal';

type UpdateTrustedUserStatusProps = {
  user: ExternalUser;
};

const UpdateTrustedUserStatus = ({ user }: UpdateTrustedUserStatusProps) => {
  const [open, setOpen] = useState(false);
  const hubId = useSession().currentHubId();
  const queryClient = useQueryClient();

  const onSuccess = () => Promise.all([
    queryClient.invalidateQueries({ queryKey: [`/hubs/${hubId}/conversations`] }),
    queryClient.invalidateQueries({ queryKey: [`/hubs/${hubId}/external-users?trusted=true`] }),
  ]);

  return (
    <>
      <Button
        label={
          <FormattedMessage
            id="global.update"
            defaultMessage="Update"
            description="Reusable label for Update buttons"
          />
        }
        size="small"
        variant="filled"
        themeMode
        onClick={() => setOpen(true)}
      />
      <ConfirmTrustedUserStatusModal
        action={user.trusted_user ? 'remove' : 'add'}
        open={open}
        user={user}
        onOpenChange={setOpen}
        onSuccess={onSuccess}
      />
    </>
  );
};

export default UpdateTrustedUserStatus;
