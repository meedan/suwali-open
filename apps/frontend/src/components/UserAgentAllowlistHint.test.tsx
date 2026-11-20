import { Toast as ToastPrimitive, Tooltip as TooltipPrimitive } from 'radix-ui';
import { IntlProvider } from 'react-intl';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';

import * as SessionContext from '@root/SessionContext';

import { ToastProvider } from '@hooks/useToast';

import UserAgentAllowlistHint from './UserAgentAllowlistHint';

vi.mock('@root/SessionContext');

const userAgent = 'Suwali/1.0 (Hub 1; +https://suwali.io)';

const renderHint = (hub: { user_agent?: string } | null) => {
  vi.mocked(SessionContext.useSession).mockReturnValue({
    currentHub: () => hub,
  } as unknown as ReturnType<typeof SessionContext.useSession>);

  return render(
    <IntlProvider locale="en" messages={{}}>
      <TooltipPrimitive.Provider>
        <ToastPrimitive.Provider>
          <ToastProvider>
            <UserAgentAllowlistHint />
          </ToastProvider>
          <ToastPrimitive.Viewport />
        </ToastPrimitive.Provider>
      </TooltipPrimitive.Provider>
    </IntlProvider>
  );
};

describe('UserAgentAllowlistHint', () => {
  const writeText = vi.fn().mockResolvedValue(undefined);

  beforeEach(() => {
    vi.clearAllMocks();
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
  });

  it('shows the hub’s User-Agent', () => {
    renderHint({ user_agent: userAgent });

    expect(screen.getByText(userAgent)).toBeInTheDocument();
  });

  it('copies the User-Agent', () => {
    renderHint({ user_agent: userAgent });
    fireEvent.click(screen.getByRole('button', { name: 'Copy' }));

    expect(writeText).toHaveBeenCalledWith(userAgent);
  });

  it('has nothing to copy until the hub is known', () => {
    renderHint(null);

    expect(screen.queryByRole('button', { name: 'Copy' })).not.toBeInTheDocument();
  });
});
