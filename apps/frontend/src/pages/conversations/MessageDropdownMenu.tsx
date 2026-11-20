import { useState } from 'react';
import { defineMessages, useIntl } from 'react-intl';

import type { Message } from '@customTypes/message';

import { startsWithHubPath } from '@helpers/hubPath';

import { useMessageHighlight } from '@contexts/MessageSelectContext';

import { useToast } from '@hooks/useToast';

import Button from '@ui-components/input/Button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@ui-components/input/DropdownMenu.tsx';
import ReportMessageModal from '@ui-components/input/ReportMessageModal';
import Icon from '@ui-components/layout/Icon';
import Tooltip from '@ui-components/layout/Tooltip';

import AddToNotebookModal from '@components/AddToNotebookModal';
import { Can } from '@components/Can';

const messages = defineMessages({
  more: {
    id: "global.more",
    defaultMessage: "More",
    description: "Reusable label to indicate more options are available",
  },
  copyPermalink: {
    id: "global.copyPermalink",
    defaultMessage: "Copy permalink for this message",
    description: "Menu option to copy a permalink to this message",
  },
  permalinkCopied: {
    id: "global.permalinkCopied",
    defaultMessage: "Permalink copied!",
    description: "Confirmation message shown when permalink is copied",
  },
  permalinkCopyFailed: {
    id: "global.permalinkCopyFailed",
    defaultMessage: "Failed to copy permalink",
    description: "Error message shown when permalink copy fails",
  },
  includeInNotebook: {
    id: "messageDropdownMenu.includeInNotebook",
    defaultMessage: "Include message in notebooks",
    description: "Message context menu option to include this message in a notebook",
  },
  selectMessage: {
    id: "global.selectMessage",
    defaultMessage: "Select message",
    description: "Label for button that selects/highlights a message",
  },
  deselectMessage: {
    id: "global.deselectMessage",
    defaultMessage: "Deselect message",
    description: "Label for button that deselects/unhighlights a currently selected message",
  },
  reportMessage: {
    id: "messageDropdownMenu.reportMessage",
    defaultMessage: "Report a problem",
    description: "Menu option to report a problem with this message",
  },
});

type MessageDropdownMenuProps = {
  message: Message;
};

const MessageDropdownMenu = ({ message }: MessageDropdownMenuProps) => {
  const intl = useIntl();

  const { toast } = useToast();
  const { highlightMessageId, toggleMessageHighlight } = useMessageHighlight();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [reportOpen, setReportOpen] = useState(false);

  const selected = highlightMessageId === message.id;

  const handleCopyPermalink = async () => {
    try {
      const baseUrl = window.location.origin;
      // Your own conversations are only listed under "me" for you, so a link to them has to point at "team", where everyone can open them
      const path = window.location.pathname.replace(/(\/conversations\/)me(\/)/, '$1team$2');
      // Only audience conversations are filtered by platform, so only their links need to clear it
      const isAudienceRoute = startsWithHubPath(path, '/conversations/audience');
      const permalink = isAudienceRoute
        ? `${baseUrl}${path}?platforms=any&messageId=${message.id}`
        : `${baseUrl}${path}?messageId=${message.id}`;

      await navigator.clipboard.writeText(permalink);

      toast('success', intl.formatMessage(messages.permalinkCopied));
    } catch (err) {
      console.error('Failed to copy permalink:', err);
      toast('error', intl.formatMessage(messages.permalinkCopyFailed));
    }
  };

  const isInternalRoute = startsWithHubPath(window.location.pathname, '/internal-conversations');
  const isUserMessage = message.direction === "incoming";
  if (isInternalRoute && isUserMessage) {
    return null;
  }

  return (
    <>
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
          <DropdownMenuItem>
            <Button
              label={intl.formatMessage(selected ? messages.deselectMessage : messages.selectMessage)}
              size="medium"
              themeMode
              variant="menu"
              onClick={() => toggleMessageHighlight(message.id)}
            />
          </DropdownMenuItem>
          {!isInternalRoute && (
            <>
              <DropdownMenuItem>
                <Button
                  label={intl.formatMessage(messages.copyPermalink)}
                  size="medium"
                  themeMode
                  variant="menu"
                  onClick={handleCopyPermalink}
                />
              </DropdownMenuItem>
              <Can action="CREATE_NOTEBOOK_ITEM">
                <DropdownMenuItem>
                  <Button
                    label={intl.formatMessage(messages.includeInNotebook)}
                    size="medium"
                    themeMode
                    variant="menu"
                    onClick={() => setDialogOpen(true)}
                  />
                </DropdownMenuItem>
              </Can>
            </>
          )}
          { message.direction == "outgoing" && (
          <DropdownMenuItem>
            <Button
              label={intl.formatMessage(messages.reportMessage)}
              size="medium"
              themeMode
              variant="menu"
              onClick={() => setReportOpen(true)}
            />
          </DropdownMenuItem>
          ) }
        </DropdownMenuContent>
      </DropdownMenu>
      <AddToNotebookModal
        key={`add-to-notebook-modal-${dialogOpen}`}
        assetId={message.id}
        assetTitle={message.body}
        assetType="Message"
        open={dialogOpen}
        onOpenChange={() => setDialogOpen(false)}
      />
      <ReportMessageModal
        messageId={message.id}
        messageBody={message.body}
        open={reportOpen}
        onOpenChange={() => setReportOpen(false)}
      />
    </>
  );
}

export default MessageDropdownMenu;
