import { IntlProvider } from 'react-intl';
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';

import LoadMoreNode from './LoadMoreNode';

// Handle needs the node id context React Flow provides, which is not exported
vi.mock('@xyflow/react', async importOriginal => ({
  ...(await importOriginal<typeof import('@xyflow/react')>()),
  Handle: () => null,
}));

const renderNode = (direction: 'earlier' | 'newer', loading: boolean, onClick = vi.fn()) => {
  render(
    <IntlProvider locale="en" messages={{}} onError={() => {}}>
      <LoadMoreNode data={{ direction, loading, onClick }} />
    </IntlProvider>
  );
  return onClick;
};

describe('LoadMoreNode', () => {
  it('calls onClick when pressed', () => {
    const onClick = renderNode('earlier', false);

    fireEvent.click(screen.getByRole('button', { name: 'Load earlier messages' }));

    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it('labels the newer direction', () => {
    renderNode('newer', false);

    expect(screen.getByRole('button', { name: 'Load newer messages' })).toBeInTheDocument();
  });

  it('is disabled and says it is loading while a page is being fetched', () => {
    const onClick = renderNode('earlier', true);

    const button = screen.getByRole('button', { name: 'Loading more…' });
    expect(button).toBeDisabled();

    fireEvent.click(button);
    expect(onClick).not.toHaveBeenCalled();
  });
});
