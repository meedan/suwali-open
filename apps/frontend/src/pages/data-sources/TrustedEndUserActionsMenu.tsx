import { useState } from 'react';
import { defineMessages, useIntl } from 'react-intl';
import { useNavigate } from 'react-router';

import type { ExternalUser } from '@customTypes/external-user';

import { useCan } from '@hooks/useCapabilities';
import { useHubPath } from '@hooks/useHubPath';

import Button from '@ui-components/input/Button';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@ui-components/input/DropdownMenu.tsx';
import Icon from '@ui-components/layout/Icon';
import Tooltip from '@ui-components/layout/Tooltip';

import ConfirmTrustedUserStatusModal from '@components/ConfirmTrustedUserStatusModal';

import styles from "./TrustedEndUserActionsMenu.module.css";

const messages = defineMessages({
  more: {
    id: 'global.more',
    defaultMessage: 'More',
    description: 'Reusable label to indicate more options are available',
  },
  viewConversation: {
    id: 'global.viewConversation',
    defaultMessage: 'View conversation',
    description: 'Button label to navigate to the latest conversation for this end-user',
  },
  remove: {
    id: 'global.remove',
    defaultMessage: 'Remove',
    description: 'Reusable label for remove action',
  },
});

type TrustedEndUserActionsMenuProps = {
  user: ExternalUser;
  onRemoveSuccess?: () => void;
};

const TrustedEndUserActionsMenu = ({ user, onRemoveSuccess }: TrustedEndUserActionsMenuProps) => {
  const intl = useIntl();
  const navigate = useNavigate();
  const hubPath = useHubPath();
  const [removeModalOpen, setRemoveModalOpen] = useState(false);
  const canRemove = useCan('MANAGE_EXTERNAL_USERS').allowed;

  return (
    <div className={styles.trustedEndUserActionsMenu}>
      <DropdownMenu>
        <Tooltip content={intl.formatMessage(messages.more)}>
          <DropdownMenuTrigger>
            <Button
              aria-label={intl.formatMessage(messages.more)}
              themeMode
              variant="filled"
              size="small"
              iconLeft={<Icon id="dots_three_vertical" aria-hidden />}
            />
          </DropdownMenuTrigger>
        </Tooltip>
        <DropdownMenuContent>
          {user.last_conversation_id && (
            <DropdownMenuItem>
              <Button
                label={intl.formatMessage(messages.viewConversation)}
                size="medium"
                themeMode
                variant="menu"
                onClick={() => navigate(hubPath(`/conversations/audience/${user.last_conversation_id}`))}
              />
            </DropdownMenuItem>
          )}
          {user.last_conversation_id && canRemove && <DropdownMenuSeparator />}
          {canRemove && (
            <DropdownMenuItem>
              <Button
                label={intl.formatMessage(messages.remove)}
                size="medium"
                themeMode
                variant="menu"
                onClick={() => setRemoveModalOpen(true)}
              />
            </DropdownMenuItem>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
      <ConfirmTrustedUserStatusModal
        action="remove"
        open={removeModalOpen}
        user={user}
        onOpenChange={setRemoveModalOpen}
        onSuccess={onRemoveSuccess}
      />
    </div>
  );
};

export default TrustedEndUserActionsMenu;
