import { Tooltip as TooltipPrimitive } from 'radix-ui';
import { IntlProvider } from 'react-intl';
import { MemoryRouter } from 'react-router';
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';

import { SortModal } from './SortModal';

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

const renderModal = (props: Parameters<typeof SortModal>[0]) =>
  render(
    <MemoryRouter>
      <IntlProvider locale="en" messages={{}}>
        <TooltipPrimitive.Provider>
          <SortModal {...props} />
        </TooltipPrimitive.Provider>
      </IntlProvider>
    </MemoryRouter>
  );

const sortFields = () =>
  within(screen.getByRole('combobox')).getAllByRole('option').map(option => option.getAttribute('value'));

describe('SortModal', () => {
  it('offers every field for the type by default', () => {
    renderModal({ type: 'conversation' });

    expect(sortFields()).toEqual(['user', 'platform', 'last_message', 'messages_count']);
  });

  it('offers only the given fields when options are passed', () => {
    renderModal({ type: 'conversation', options: ['last_message', 'messages_count'] });

    expect(sortFields()).toEqual(['last_message', 'messages_count']);
  });

  it('names the sort directions in the terms of the selected field', () => {
    renderModal({ type: 'conversation' });

    expect(screen.getByRole('radio', { name: 'Oldest first' })).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: 'Newest first' })).toBeInTheDocument();

    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'messages_count' } });
    expect(screen.getByRole('radio', { name: 'Fewest first' })).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: 'Most first' })).toBeInTheDocument();

    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'user' } });
    expect(screen.getByRole('radio', { name: 'Ascending' })).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: 'Descending' })).toBeInTheDocument();
  });

  it('uses the given label in place of a field’s default one', () => {
    renderModal({ type: 'conversation', labels: { user: <>Team member</> } });

    expect(screen.getByRole('option', { name: 'Team member' })).toHaveValue('user');
    expect(screen.queryByRole('option', { name: 'End-user' })).not.toBeInTheDocument();
  });

  it('spells out "Sort" on the trigger button by default', () => {
    renderModal({ type: 'conversation' });

    expect(screen.getByRole('button', { name: 'Sort' })).toBeInTheDocument();
  });

  it('shows no visible label when compact, but keeps an accessible one', () => {
    renderModal({ type: 'conversation', verboseButton: false });

    const trigger = screen.getByRole('button', { name: 'Sort conversations' });
    expect(trigger).toHaveTextContent('');
  });
});
