/**
 * Capabilities-based authorization component and hooks
 *
 * The capabilities system provides three ways to check user permissions:
 *
 * 1. Component form (recommended for conditional rendering):
 *    ```tsx
 *    <Can action="CREATE_SOURCE">
 *      <Button onClick={createSource}>Add Source</Button>
 *    </Can>
 *    ```
 *
 * 2. Hook form (for programmatic checks):
 *    ```tsx
 *    import { useCan } from '@hooks/useCapabilities';
 *
 *    const decision = useCan('CREATE_SOURCE');
 *    if (decision.allowed) {
 *      // show UI
 *    }
 *    ```
 *
 * 3. Function form (when you need multiple checks):
 *    ```tsx
 *    import { useCapabilities } from '@hooks/useCapabilities';
 *
 *    const { can } = useCapabilities();
 *    const canCreateSource = can('CREATE_SOURCE');
 *    const canCreateDocument = can('CREATE_DOCUMENT');
 *    ```
 *
 * 4. Render-prop form (for custom rendering based on decision):
 *    ```tsx
 *    <Can action="MANAGE_MESSAGING_INTEGRATION">
 *      {(decision) => (
 *        decision.allowed ? (
 *          <MessagingIntegration />
 *        ) : (
 *          <UpsellCard
 *            title="Connect Messaging Integrations"
 *            description="Connect WhatsApp, Telegram, and more to your bot"
 *            reason={decision.reasons?.[0]}
 *          />
 *        )
 *      )}
 *    </Can>
 *    ```
 *
 * All methods return a CanDecision object:
 *   { allowed: boolean, reasons?: string[] }
 *
 * Example reasons: 'trial_expired', 'plan_restriction', 'limit_reached', 'missing_permission'
 */

import type { ReactNode } from 'react';
import { cloneElement, isValidElement } from 'react';

import type { CanDecision, Capabilities } from '@customTypes/hub';

import { useCan } from '@hooks/useCapabilities';

type CanProps = {
  action: keyof Capabilities;
  mode?: 'hide' | 'disable';
  children: ReactNode | ((decision: CanDecision) => ReactNode);
};

export function Can({ action, mode = 'hide', children }: CanProps) {
  const decision = useCan(action);

  // Uncomment to debug
  // console.log('<Can />', { action: action, decision: decision });

  // Render-prop form
  if (typeof children === 'function') {
    return <>{children(decision)}</>;
  }

  // If allowed, render children normally
  if (decision.allowed) {
    return <>{children}</>;
  }

  // If mode is hide, render nothing
  if (mode === 'hide') {
    return null;
  }

  // If mode is disable, clone children and add disabled prop
  if (mode === 'disable') {
    if (isValidElement(children)) {
      return cloneElement(children, { disabled: true } as { disabled: boolean });
    }
    return <>{children}</>;
  }

  return null;
}
