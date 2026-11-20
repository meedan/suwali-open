import { MemoryRouter } from 'react-router';
import { describe, expect, it } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';

import MessageSelectProvider, { useMessageHighlight } from './MessageSelectContext';

const Probe = () => {
  const { highlightMessageId, selectMessageHighlight } = useMessageHighlight();

  return (
    <>
      <button type="button" onClick={() => selectMessageHighlight(7)}>Select</button>
      <span data-testid="highlighted">{String(highlightMessageId)}</span>
    </>
  );
};

const renderProbe = () => {
  render(
    <MemoryRouter>
      <MessageSelectProvider>
        <Probe />
      </MessageSelectProvider>
    </MemoryRouter>
  );
  fireEvent.click(screen.getByRole('button', { name: 'Select' }));
};

describe('MessageSelectProvider', () => {
  it('clears the highlight on Escape', () => {
    renderProbe();
    expect(screen.getByTestId('highlighted')).toHaveTextContent('7');

    fireEvent.keyDown(document, { key: 'Escape' });

    expect(screen.getByTestId('highlighted')).toHaveTextContent('null');
  });

  it('keeps the highlight when Escape was already used to close something else', () => {
    renderProbe();
    const closeOtherLayer = (event: KeyboardEvent) => event.preventDefault();
    document.addEventListener('keydown', closeOtherLayer, true);

    fireEvent.keyDown(document, { key: 'Escape' });
    document.removeEventListener('keydown', closeOtherLayer, true);

    expect(screen.getByTestId('highlighted')).toHaveTextContent('7');
  });

  it('ignores other keys', () => {
    renderProbe();

    fireEvent.keyDown(document, { key: 'Enter' });

    expect(screen.getByTestId('highlighted')).toHaveTextContent('7');
  });
});
