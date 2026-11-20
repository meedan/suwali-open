import { useState } from 'react';
import { defineMessages, useIntl } from 'react-intl';

import type { Conversation } from '@customTypes/conversation';

import { downloadExport } from '@services/ExportService';

import { HttpError, sanitizeApiErrors } from '@root/NetworkLayer';

import { useCan } from '@hooks/useCapabilities';
import { useToast } from '@hooks/useToast';

import Button from '@ui-components/input/Button';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@ui-components/input/DropdownMenu.tsx';
import Icon from '@ui-components/layout/Icon';
import Tooltip from '@ui-components/layout/Tooltip';

const messages = defineMessages({
  more: {
    id: 'global.more',
    defaultMessage: 'More',
    description: 'Reusable label to indicate more options are available',
  },
  userDetails: {
    id: 'global.endUserDetails',
    defaultMessage: 'End-user details',
    description: 'Reusable label to indicate user details are available',
  },
  includeInNotebook: {
    id: 'global.includeInNotebook',
    defaultMessage: 'Include in notebooks',
    description: 'Reusable label to indicate adding this item to a notebook',
  },
  exportConversation: {
    id: 'global.exportAsCsv',
    defaultMessage: 'Export as CSV',
    description: 'Reusable label for a button that downloads data as a CSV file',
  },
  exportConversationError: {
    id: 'conversationStack.exportConversationError',
    defaultMessage: 'Could not export the conversation. Please try again.',
    description: 'Error message when downloading a conversation as a CSV file fails',
  },
});

type ConversationActionsMenuProps = {
  conversation: Conversation;
  onShowUserDetails: () => void;
  onAddToNotebook: () => void;
};

const ConversationActionsMenu = ({ conversation, onShowUserDetails, onAddToNotebook }: ConversationActionsMenuProps) => {
  const intl = useIntl();
  const { toast } = useToast();
  // Kept here rather than in the item, which unmounts when the menu closes, so reopening the menu mid-download can't start another
  const [exporting, setExporting] = useState(false);
  const canAddToNotebook = useCan('CREATE_NOTEBOOK_ITEM').allowed;
  const canExport = useCan('IS_ADMIN').allowed;
  const hasUserDetails = conversation.platform !== 'internal';

  if (!hasUserDetails && !canAddToNotebook && !canExport) {
    return null;
  }

  const handleExport = async () => {
    setExporting(true);

    try {
      const blob = await downloadExport(`/hubs/${conversation.hub_id}/conversations/${conversation.id}/export`);
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `suwali-conversation-${conversation.id}-export-${new Date().toISOString().split('T')[0]}.csv`;
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      document.body.removeChild(a);
    } catch (err: unknown) {
      const apiError = err instanceof HttpError ? sanitizeApiErrors(err.data) ?? err.data?.error : undefined;
      toast('error', apiError ?? intl.formatMessage(messages.exportConversationError));
    } finally {
      setExporting(false);
    }
  };

  return (
    <DropdownMenu>
      <Tooltip content={intl.formatMessage(messages.more)}>
        <DropdownMenuTrigger>
          <Button
            aria-label={intl.formatMessage(messages.more)}
            iconLeft={<Icon id="dots_three_vertical" aria-hidden />}
            themeMode
            size="small"
          />
        </DropdownMenuTrigger>
      </Tooltip>
      <DropdownMenuContent>
        {hasUserDetails && (
          <DropdownMenuItem>
            <Button
              iconLeft={<Icon id="user" aria-hidden />}
              label={intl.formatMessage(messages.userDetails)}
              size="medium"
              themeMode
              variant="menu"
              onClick={onShowUserDetails}
            />
          </DropdownMenuItem>
        )}
        {canAddToNotebook && (
          <DropdownMenuItem>
            <Button
              iconLeft={<Icon id="notebook" aria-hidden />}
              label={intl.formatMessage(messages.includeInNotebook)}
              size="medium"
              themeMode
              variant="menu"
              onClick={onAddToNotebook}
            />
          </DropdownMenuItem>
        )}
        {canExport && (
          <DropdownMenuItem>
            <Button
              iconLeft={<Icon id="download" aria-hidden />}
              label={intl.formatMessage(messages.exportConversation)}
              size="medium"
              themeMode
              variant="menu"
              disabled={exporting}
              onClick={handleExport}
            />
          </DropdownMenuItem>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
};

export default ConversationActionsMenu;
