import { Tooltip as TooltipPrimitive } from 'radix-ui';
import { IntlProvider } from 'react-intl';
import { describe, expect, it } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';

import type { TemplateCategory } from '@customTypes/messaging-integration';

import TemplateStatusBadge from './TemplateStatusBadge';

const MARKETING_EXPLANATION = /re-classified as “marketing”\. You can appeal this decision with Meta\.$/;
const PENDING_MARKETING_EXPLANATION = /re-classified as “marketing”\. You can appeal this decision with Meta once the template has been approved\./;

const renderBadge = (status: string, category: TemplateCategory | null) =>
  render(
    <IntlProvider locale="en" messages={{}}>
      <TooltipPrimitive.Provider delayDuration={0}>
        <TemplateStatusBadge status={status} category={category} className="badge" />
      </TooltipPrimitive.Provider>
    </IntlProvider>
  );

describe('TemplateStatusBadge', () => {
  it('shows the plain status for a utility template', async () => {
    renderBadge('APPROVED', 'UTILITY');

    fireEvent.pointerMove(screen.getByText('APPROVED'));

    expect(screen.queryByRole('button')).not.toBeInTheDocument();
    await waitFor(() => expect(screen.queryByText(MARKETING_EXPLANATION)).not.toBeInTheDocument());
  });

  it('shows the plain status when the category is unknown', () => {
    renderBadge('APPROVED', null);

    expect(screen.getByText('APPROVED')).toBeInTheDocument();
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });

  it('explains the reclassification and how to appeal when hovering a marketing template', async () => {
    renderBadge('APPROVED', 'MARKETING');

    fireEvent.pointerMove(screen.getByRole('button', { name: 'APPROVED' }));

    expect((await screen.findAllByText(MARKETING_EXPLANATION)).length).toBeGreaterThan(0);
  });

  it('says the appeal is possible once a pending marketing template is approved', async () => {
    renderBadge('PENDING', 'MARKETING');

    fireEvent.pointerMove(screen.getByRole('button', { name: 'PENDING' }));

    expect((await screen.findAllByText(PENDING_MARKETING_EXPLANATION)).length).toBeGreaterThan(0);
  });

  it('lets keyboard users open the explanation by focusing a marketing template', async () => {
    renderBadge('APPROVED', 'MARKETING');

    const badge = screen.getByRole('button', { name: 'APPROVED' });
    badge.focus();

    expect(badge).toHaveFocus();
    expect((await screen.findAllByText(MARKETING_EXPLANATION)).length).toBeGreaterThan(0);
  });
});
