import { IntlProvider } from 'react-intl';
import { describe, expect, it } from 'vitest';
import { render as renderBase, screen } from '@testing-library/react';

import MessageBubble from './MessageBubble';
import styles from './MessageBubble.module.css';

const render = (ui: React.ReactElement) => renderBase(
  <IntlProvider locale="en" messages={{}}>{ui}</IntlProvider>
);

describe('MessageBubble', () => {
  it('renders its content without wrapping it in an interactive button', () => {
    render(<MessageBubble>Hello there</MessageBubble>);

    expect(screen.getByText('Hello there')).toBeInTheDocument();
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });

  it('omits the row actions wrapper when rowActions is not provided', () => {
    const { container } = render(<MessageBubble>Hello</MessageBubble>);

    expect(container.querySelector(`.${styles.rowActions}`)).not.toBeInTheDocument();
  });

  it('renders rowActions when provided', () => {
    const { container } = render(<MessageBubble rowActions={<button>Copy</button>}>Hello</MessageBubble>);

    expect(container.querySelector(`.${styles.rowActions}`)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Copy' })).toBeInTheDocument();
  });

  it('omits the bubble actions wrapper when bubbleActions is not provided', () => {
    const { container } = render(<MessageBubble>Hello</MessageBubble>);

    expect(container.querySelector(`.${styles.bubbleActions}`)).not.toBeInTheDocument();
  });

  it('renders bubbleActions when provided', () => {
    const { container } = render(<MessageBubble bubbleActions={<button>Reply</button>}>Hello</MessageBubble>);

    expect(container.querySelector(`.${styles.bubbleActions}`)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Reply' })).toBeInTheDocument();
  });

  it('marks both the wrapper and the bubble as highlighted when highlighted', () => {
    const { container } = render(<MessageBubble highlighted>Hello</MessageBubble>);

    expect(container.querySelector(`.${styles.wrapper}`)).toHaveClass(styles.highlighted);
    expect(container.querySelector(`.${styles.bubble}`)).toHaveClass(styles.highlighted);
  });
});
