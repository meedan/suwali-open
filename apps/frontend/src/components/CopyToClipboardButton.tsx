import type { ComponentProps } from 'react';
import { defineMessages, FormattedMessage, useIntl } from 'react-intl';

import { useToast } from '@hooks/useToast';

import Button from '@ui-components/input/Button';
import Tooltip from '@ui-components/layout/Tooltip';

const messages = defineMessages({
  defaultSuccess: {
    id: 'global.copiedToClipboard',
    defaultMessage: 'Copied to clipboard',
    description: 'Default toast message shown after copying content to the clipboard',
  },
});

type CopyToClipboardButtonProps = {
  value: string | undefined;
  successMessage?: string;
} & Pick<ComponentProps<typeof Button>, 'aria-label' | 'className' | 'iconLeft' | 'label' | 'size' | 'themeMode' | 'title' | 'variant'>;

const CopyToClipboardButton = ({
  value,
  successMessage,
  ...buttonProps
}: CopyToClipboardButtonProps) => {
  const intl = useIntl();
  const { toast } = useToast();

  const handleCopy = () => {
    if (!value) return;
    void navigator.clipboard.writeText(value);
    toast('success', successMessage ?? intl.formatMessage(messages.defaultSuccess));
  };

  return (
    <Tooltip
      content={
        <FormattedMessage
          id="global.copytoClipboard"
          defaultMessage="Copy to clipboard"
          description="Tooltip text for copy text to clipboard"
        />
      }
    >
      <Button
        {...buttonProps}
        disabled={!value}
        onClick={handleCopy}
      />
    </Tooltip>
  );
};

export default CopyToClipboardButton;
