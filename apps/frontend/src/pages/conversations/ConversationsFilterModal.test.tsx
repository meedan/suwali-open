import { Tooltip as TooltipPrimitive } from 'radix-ui';
import { IntlProvider } from 'react-intl';
import { MemoryRouter, useLocation } from 'react-router';
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';

import type { ConversationFrom } from '@customTypes/conversation';

import { ConversationsFilterModal } from './ConversationsFilterModal';

vi.mock('@ui-components/layout/Modal', () => ({
  Modal: ({ title, body, actions, trigger }: { title: React.ReactNode; body: React.ReactNode; actions: React.ReactNode; trigger: React.ReactNode }) => (
    <>
      {trigger}
      <dialog open>
        <div>{title}</div>
        <div>{body}</div>
        <div>{actions}</div>
      </dialog>
    </>
  ),
}));

vi.mock('@ui-components/input/SelectInput', () => ({
  Select: ({ children, value, onValueChange }: { children: React.ReactNode; value?: string; onValueChange?: (value: string) => void }) => (
    <select value={value} onChange={e => onValueChange?.(e.target.value)}>
      {children}
    </select>
  ),
  SelectItem: ({ children, value }: { children: React.ReactNode; value: string }) => (
    <option value={value}>{children}</option>
  ),
}));

const CurrentSearch = () => <output aria-label="Current search">{useLocation().search}</output>;

const renderModal = (from: ConversationFrom, { search = '', verboseButton = false }: { search?: string; verboseButton?: boolean } = {}) =>
  render(
    <MemoryRouter initialEntries={[`/${search}`]}>
      <IntlProvider locale="en" messages={{}}>
        <TooltipPrimitive.Provider>
          <ConversationsFilterModal connectedPlatforms={['whatsapp', 'telegram', 'sms']} from={from} verboseButton={verboseButton} />
          <CurrentSearch />
        </TooltipPrimitive.Provider>
      </IntlProvider>
    </MemoryRouter>
  );

describe('ConversationsFilterModal', () => {
  it('offers the end-user and platform filters for audience conversations', () => {
    renderModal('audience');

    expect(screen.getByText('Most recent message')).toBeInTheDocument();
    expect(screen.getByText('Conversations with')).toBeInTheDocument();
    expect(screen.getByText('Platform')).toBeInTheDocument();
  });

  it.each(['me', 'team'] as const)('offers only the date filters for %s conversations', (from) => {
    renderModal(from);

    expect(screen.getByText('Most recent message')).toBeInTheDocument();
    expect(screen.getByText('First message')).toBeInTheDocument();
    expect(screen.queryByText('Conversations with')).not.toBeInTheDocument();
    expect(screen.queryByText('Platform')).not.toBeInTheDocument();
  });

  it('shows just the count visibly by default, with the full phrase as its accessible label', () => {
    renderModal('team', { search: '?last_message=last_7_days' });

    const trigger = screen.getByRole('button', { name: 'Filters (1)' });
    expect(trigger).toHaveTextContent('1');
    expect(trigger).not.toHaveTextContent('Filters');
  });

  it('shows no visible label when there are no active filters, but keeps an accessible one', () => {
    renderModal('team');

    const trigger = screen.getByRole('button', { name: 'Filters (0)' });
    expect(trigger).toHaveTextContent('');
  });

  it('spells out the filter word and count when verbose', () => {
    renderModal('team', { search: '?last_message=last_7_days', verboseButton: true });

    expect(screen.getByRole('button', { name: 'Filters (1)' })).toBeInTheDocument();
  });

  it('applies a date filter without adding end-user or platform filters', () => {
    renderModal('team');

    fireEvent.change(screen.getAllByRole('combobox')[0], { target: { value: 'last_7_days' } });
    fireEvent.click(screen.getByRole('button', { name: 'Update filters' }));

    const search = new URLSearchParams(screen.getByRole('status', { name: 'Current search' }).textContent ?? '');
    expect(search.get('last_message')).toBe('last_7_days');
    expect(search.has('participants')).toBe(false);
    expect(search.has('platforms')).toBe(false);
  });

  it('does not let the last type of end-user or platform be unchecked', () => {
    renderModal('audience', { search: '?participants=trusted&platforms=sms' });

    expect(screen.getByRole('checkbox', { name: 'Trusted end-users' })).toBeDisabled();
    expect(screen.getByRole('checkbox', { name: 'SMS' })).toBeDisabled();
    expect(screen.getByRole('checkbox', { name: 'Anonymous end-users' })).toBeEnabled();
  });

  it('applies one type of end-user, and drops the filter when both are chosen', () => {
    renderModal('audience', { search: '?participants=trusted' });

    fireEvent.click(screen.getByRole('checkbox', { name: 'Anonymous end-users' }));
    fireEvent.click(screen.getByRole('button', { name: 'Update filters' }));

    expect(new URLSearchParams(screen.getByRole('status', { name: 'Current search' }).textContent ?? '').has('participants')).toBe(false);
  });

  it('does not count an address that chooses every end-user type and platform, as that is no filter', () => {
    renderModal('audience', { search: '?participants=anonymous,trusted&platforms=whatsapp,telegram,sms' });

    expect(screen.getByRole('button', { name: 'Filters (0)' })).toBeInTheDocument();
  });

  it('counts a choice of fewer end-user types or platforms', () => {
    renderModal('audience', { search: '?participants=trusted&platforms=whatsapp,telegram,sms' });

    expect(screen.getByRole('button', { name: 'Filters (1)' })).toBeInTheDocument();
  });
});
