import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';

import type { CanDecision } from '@customTypes/hub';

import * as useCapabilitiesModule from '@hooks/useCapabilities';

import { Can } from './Can';


// Mock the useCapabilities hook
vi.mock('@hooks/useCapabilities', () => ({
  useCan: vi.fn(),
}));

describe('Can component', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('when action is allowed', () => {
    beforeEach(() => {
      const allowedDecision: CanDecision = { allowed: true };
      vi.mocked(useCapabilitiesModule.useCan).mockReturnValue(allowedDecision);
    });

    it('renders children when allowed (default mode)', () => {
      render(
        <Can action="CREATE_SOURCE">
          <button>Create Source</button>
        </Can>
      );

      expect(screen.getByRole('button', { name: 'Create Source' })).toBeInTheDocument();
    });

    it('renders children when allowed (hide mode)', () => {
      render(
        <Can action="CREATE_SOURCE" mode="hide">
          <button>Create Source</button>
        </Can>
      );

      expect(screen.getByRole('button', { name: 'Create Source' })).toBeInTheDocument();
    });

    it('renders children when allowed (disable mode)', () => {
      render(
        <Can action="CREATE_SOURCE" mode="disable">
          <button>Create Source</button>
        </Can>
      );

      const button = screen.getByRole('button', { name: 'Create Source' });
      expect(button).toBeInTheDocument();
      expect(button).not.toBeDisabled();
    });

    it('renders children with render-prop form when allowed', () => {
      render(
        <Can action="CREATE_SOURCE">
          {(decision) => (
            <div>
              <span>Status: {decision.allowed ? 'Allowed' : 'Denied'}</span>
            </div>
          )}
        </Can>
      );

      expect(screen.getByText('Status: Allowed')).toBeInTheDocument();
    });
  });

  describe('when action is not allowed', () => {
    beforeEach(() => {
      const deniedDecision: CanDecision = {
        allowed: false,
        reasons: ['plan_restriction']
      };
      vi.mocked(useCapabilitiesModule.useCan).mockReturnValue(deniedDecision);
    });

    it('does not render children when denied (default mode)', () => {
      render(
        <Can action="CREATE_SOURCE">
          <button>Create Source</button>
        </Can>
      );

      expect(screen.queryByRole('button', { name: 'Create Source' })).not.toBeInTheDocument();
    });

    it('does not render children when denied (hide mode)', () => {
      render(
        <Can action="CREATE_SOURCE" mode="hide">
          <button>Create Source</button>
        </Can>
      );

      expect(screen.queryByRole('button', { name: 'Create Source' })).not.toBeInTheDocument();
    });

    it('renders children as disabled when denied (disable mode)', () => {
      render(
        <Can action="CREATE_SOURCE" mode="disable">
          <button>Create Source</button>
        </Can>
      );

      const button = screen.getByRole('button', { name: 'Create Source' });
      expect(button).toBeInTheDocument();
      expect(button).toBeDisabled();
    });

    it('renders children with render-prop form when denied', () => {
      render(
        <Can action="CREATE_SOURCE">
          {(decision) => (
            <div>
              <span>Status: {decision.allowed ? 'Allowed' : 'Denied'}</span>
              <span>Reasons: {decision.reasons?.join(', ')}</span>
            </div>
          )}
        </Can>
      );

      expect(screen.getByText('Status: Denied')).toBeInTheDocument();
      expect(screen.getByText('Reasons: plan_restriction')).toBeInTheDocument();
    });
  });

  describe('with different denial reasons', () => {
    it('handles trial_expired reason', () => {
      const deniedDecision: CanDecision = {
        allowed: false,
        reasons: ['trial_expired']
      };
      vi.mocked(useCapabilitiesModule.useCan).mockReturnValue(deniedDecision);

      render(
        <Can action="CREATE_SOURCE">
          {(decision) => <span>{decision.reasons?.join(', ')}</span>}
        </Can>
      );

      expect(screen.getByText('trial_expired')).toBeInTheDocument();
    });

    it('handles limit_reached reason', () => {
      const deniedDecision: CanDecision = {
        allowed: false,
        reasons: ['plan_restriction', 'limit_reached']
      };
      vi.mocked(useCapabilitiesModule.useCan).mockReturnValue(deniedDecision);

      render(
        <Can action="CREATE_SOURCE">
          {(decision) => <span>{decision.reasons?.join(', ')}</span>}
        </Can>
      );

      expect(screen.getByText('plan_restriction, limit_reached')).toBeInTheDocument();
    });

    it('handles missing_permission reason', () => {
      const deniedDecision: CanDecision = {
        allowed: false,
        reasons: ['missing_permission']
      };
      vi.mocked(useCapabilitiesModule.useCan).mockReturnValue(deniedDecision);

      render(
        <Can action="CREATE_SOURCE">
          {(decision) => <span>{decision.reasons?.join(', ')}</span>}
        </Can>
      );

      expect(screen.getByText('missing_permission')).toBeInTheDocument();
    });
  });

  describe('with different actions', () => {
    it('works with CREATE_DOCUMENT action', () => {
      const allowedDecision: CanDecision = { allowed: true };
      vi.mocked(useCapabilitiesModule.useCan).mockReturnValue(allowedDecision);

      render(
        <Can action="CREATE_DOCUMENT">
          <button>Create Document</button>
        </Can>
      );

      expect(screen.getByRole('button', { name: 'Create Document' })).toBeInTheDocument();
    });

    it('works with MANAGE_MESSAGING_INTEGRATION action', () => {
      const deniedDecision: CanDecision = {
        allowed: false,
        reasons: ['plan_restriction']
      };
      vi.mocked(useCapabilitiesModule.useCan).mockReturnValue(deniedDecision);

      render(
        <Can action="MANAGE_MESSAGING_INTEGRATION">
          <button>Create Integration</button>
        </Can>
      );

      expect(screen.queryByRole('button', { name: 'Create Integration' })).not.toBeInTheDocument();
    });
  });

  describe('edge cases', () => {
    it('handles non-element children in disable mode gracefully', () => {
      const deniedDecision: CanDecision = { allowed: false };
      vi.mocked(useCapabilitiesModule.useCan).mockReturnValue(deniedDecision);

      render(
        <Can action="CREATE_SOURCE" mode="disable">
          <div>Just text content</div>
        </Can>
      );

      expect(screen.getByText('Just text content')).toBeInTheDocument();
    });

    it('calls useCan with the correct action', () => {
      const allowedDecision: CanDecision = { allowed: true };
      const useCan = vi.mocked(useCapabilitiesModule.useCan);
      useCan.mockReturnValue(allowedDecision);

      render(
        <Can action="CREATE_NOTE">
          <button>Create Note</button>
        </Can>
      );

      expect(useCan).toHaveBeenCalledWith('CREATE_NOTE');
    });
  });
});
