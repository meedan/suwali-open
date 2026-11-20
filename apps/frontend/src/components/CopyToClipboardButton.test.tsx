import { Toast as ToastPrimitive, Tooltip as TooltipPrimitive } from 'radix-ui';
import { IntlProvider } from 'react-intl';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';

import { ToastProvider } from '@hooks/useToast';

import CopyToClipboardButton from './CopyToClipboardButton';

const renderButton = (props: Partial<React.ComponentProps<typeof CopyToClipboardButton>> = {}) =>
  render(
    <IntlProvider locale="en" messages={{}}>
      <TooltipPrimitive.Provider>
        <ToastPrimitive.Provider>
          <ToastProvider>
            <CopyToClipboardButton aria-label="Copy" value="test-value" {...props} />
          </ToastProvider>
          <ToastPrimitive.Viewport />
        </ToastPrimitive.Provider>
      </TooltipPrimitive.Provider>
    </IntlProvider>
  );

describe('CopyToClipboardButton', () => {
  beforeEach(() => {
    vi.stubGlobal('navigator', {
      ...navigator,
      clipboard: { writeText: vi.fn().mockResolvedValue(undefined) },
    });
  });

  it('is disabled when value is undefined', () => {
    renderButton({ value: undefined });
    expect(screen.getByRole('button', { name: 'Copy' })).toBeDisabled();
  });

  it('is enabled when value is provided', () => {
    renderButton();
    expect(screen.getByRole('button', { name: 'Copy' })).not.toBeDisabled();
  });

  it('calls clipboard.writeText with the provided value on click', () => {
    renderButton({ value: 'hello-world' });
    fireEvent.click(screen.getByRole('button', { name: 'Copy' }));
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith('hello-world');
  });

  it('does not call clipboard.writeText when value is undefined', () => {
    renderButton({ value: undefined });
    fireEvent.click(screen.getByRole('button', { name: 'Copy' }));
    expect(navigator.clipboard.writeText).not.toHaveBeenCalled();
  });
});
