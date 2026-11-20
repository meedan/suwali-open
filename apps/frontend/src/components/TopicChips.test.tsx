import { Tooltip as TooltipPrimitive } from 'radix-ui';
import { IntlProvider } from 'react-intl';
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';

import TopicChips from './TopicChips';

const renderChips = (topics: { id: number; name: string }[], onTopicClick?: (topic: { id: number; name: string }) => void) =>
  render(
    <IntlProvider locale="en">
      <TooltipPrimitive.Provider>
        <TopicChips topics={topics} onTopicClick={onTopicClick} />
      </TooltipPrimitive.Provider>
    </IntlProvider>
  );

describe('TopicChips', () => {
  it('lists each topic', () => {
    renderChips([{ id: 1, name: 'Elections' }, { id: 2, name: 'Health' }]);
    const list = screen.getByRole('list', { name: 'Topics' });
    expect(list).toHaveTextContent('Elections');
    expect(list).toHaveTextContent('Health');
    expect(screen.getAllByRole('listitem')).toHaveLength(2);
  });

  it('renders nothing without topics', () => {
    renderChips([]);
    expect(screen.queryByRole('list')).not.toBeInTheDocument();
  });

  it('shows plain chips unless they can be clicked', () => {
    renderChips([{ id: 1, name: 'Elections' }]);
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });

  it('calls back with the topic clicked', () => {
    const onTopicClick = vi.fn();
    renderChips([{ id: 1, name: 'Elections' }, { id: 2, name: 'Health' }], onTopicClick);

    fireEvent.click(screen.getByRole('button', { name: 'Filter by Health' }));
    expect(onTopicClick).toHaveBeenCalledWith({ id: 2, name: 'Health' });
  });
});
