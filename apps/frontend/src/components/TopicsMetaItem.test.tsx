import { Tooltip as TooltipPrimitive } from 'radix-ui';
import { IntlProvider } from 'react-intl';
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';

import * as TopicsService from '@services/TopicsService';

import { ToastProvider } from '@hooks/useToast';

import TopicsMetaItem from './TopicsMetaItem';

vi.mock('@services/TopicsService', () => ({
  deleteTopicItem: vi.fn(),
}));

vi.mock('@ui-components/layout/Icon', () => ({
  default: () => null,
}));

vi.mock('@ui-components/layout/Modal', () => ({
  Modal: ({ open, title, titleContext, body, actions }: { open: boolean; title: React.ReactNode; titleContext: React.ReactNode; body: React.ReactNode; actions: React.ReactNode }) =>
    open ? (
      <dialog open>
        <div>{title}</div>
        <div>{titleContext}</div>
        <div>{body}</div>
        <div>{actions}</div>
      </dialog>
    ) : null,
}));

const topics = [
  { id: 1, name: 'Climate' },
  { id: 2, name: 'Elections' },
];

const renderItem = (props: Partial<React.ComponentProps<typeof TopicsMetaItem>> = {}) =>
  render(
    <IntlProvider locale="en" messages={{}}>
      <TooltipPrimitive.Provider>
        <ToastProvider>
          <TopicsMetaItem topics={topics} {...props} />
        </ToastProvider>
      </TooltipPrimitive.Provider>
    </IntlProvider>
  );

describe('TopicsMetaItem', () => {
  it('renders nothing when topics is undefined', () => {
    const { container } = renderItem({ topics: undefined });
    expect(container).toBeEmptyDOMElement();
  });

  it('renders nothing when topics is an empty array', () => {
    const { container } = renderItem({ topics: [] });
    expect(container).toBeEmptyDOMElement();
  });

  it('offers to add a topic, even to an item with none, when it is given one to add to', () => {
    renderItem({ topics: [], stacked: true, addTopic: { itemType: 'Document', itemId: 7, onAdded: vi.fn() } });

    expect(screen.getByRole('button', { name: 'Add topic' })).toBeInTheDocument();
  });

  it('offers no way to add a topic when it has no item to add to', () => {
    renderItem();

    expect(screen.queryByRole('button', { name: 'Add topic' })).not.toBeInTheDocument();
  });

  it('renders a chip for each topic', () => {
    renderItem();
    expect(screen.getByText('Climate')).toBeInTheDocument();
    expect(screen.getByText('Elections')).toBeInTheDocument();
  });

  it('does not render remove buttons when onTopicDeleted is not provided', () => {
    renderItem();
    expect(screen.queryByRole('button', { name: /Remove topic/ })).not.toBeInTheDocument();
  });

  it('renders a remove button per topic when onTopicDeleted is provided', () => {
    renderItem({ onTopicDeleted: vi.fn() });
    expect(screen.getByRole('button', { name: 'Remove topic Climate' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Remove topic Elections' })).toBeInTheDocument();
  });

  it('opens the confirmation modal when a remove button is clicked', () => {
    renderItem({ onTopicDeleted: vi.fn() });
    expect(screen.queryByText('Remove topic?')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Remove topic Climate' }));

    expect(screen.getByText('Remove topic?')).toBeInTheDocument();
  });

  it('deletes the topic and notifies the parent when confirmed', async () => {
    vi.mocked(TopicsService.deleteTopicItem).mockResolvedValue(undefined);
    const onTopicDeleted = vi.fn();
    renderItem({ onTopicDeleted });

    fireEvent.click(screen.getByRole('button', { name: 'Remove topic Climate' }));
    fireEvent.click(screen.getByRole('button', { name: 'Remove topic' }));

    expect(TopicsService.deleteTopicItem).toHaveBeenCalledWith(1);
    await waitFor(() => expect(onTopicDeleted).toHaveBeenCalled());
  });
});
