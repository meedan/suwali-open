import type { ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { renderHook } from '@testing-library/react';

import type { User } from '@customTypes/user';

import * as SessionContext from '@root/SessionContext';

import { useCan } from '@hooks/useCapabilities';

import { CapabilitiesProvider } from './CapabilitiesProvider';

vi.mock('@root/SessionContext');

const renderCan = (action: 'IS_ADMIN' | 'IS_WRITE_ADMIN', user: Partial<User>) => {
  vi.mocked(SessionContext.useSession).mockReturnValue({
    user,
    currentHub: () => null,
  } as unknown as ReturnType<typeof SessionContext.useSession>);
  const wrapper = ({ children }: { children: ReactNode }) => <CapabilitiesProvider>{children}</CapabilitiesProvider>;
  return renderHook(() => useCan(action), { wrapper }).result.current;
};

describe('CapabilitiesProvider', () => {
  it('grants platform-admin capabilities to a super-admin who belongs to no hub', () => {
    expect(renderCan('IS_ADMIN', { is_admin: true, is_write_admin: true }).allowed).toBe(true);
    expect(renderCan('IS_WRITE_ADMIN', { is_admin: true, is_write_admin: true }).allowed).toBe(true);
  });

  it('denies platform-admin capabilities to a regular user', () => {
    expect(renderCan('IS_ADMIN', { is_admin: false, is_write_admin: false }).allowed).toBe(false);
    expect(renderCan('IS_WRITE_ADMIN', { is_admin: false, is_write_admin: false }).allowed).toBe(false);
  });
});
