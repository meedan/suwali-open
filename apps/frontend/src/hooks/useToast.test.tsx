import { Toast as ToastPrimitive } from 'radix-ui';
import { IntlProvider } from 'react-intl';
import { describe, expect, it } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';

import { ToastProvider, useToast } from '@hooks/useToast';

const Trigger = ({ message = 'Toast message' }: { message?: string }) => {
  const { toast } = useToast();
  return <button onClick={() => toast('success', message)}>Show toast</button>;
};

const renderWithProvider = (message?: string) =>
  render(
    <IntlProvider locale="en" messages={{}}>
      <ToastPrimitive.Provider>
        <ToastProvider>
          <Trigger message={message} />
        </ToastProvider>
        <ToastPrimitive.Viewport />
      </ToastPrimitive.Provider>
    </IntlProvider>
  );

describe('ToastProvider / useToast', () => {
  it('renders a toast when toast() is called', async () => {
    renderWithProvider();
    fireEvent.click(screen.getByRole('button', { name: 'Show toast' }));
    await waitFor(() => {
      expect(screen.getByText('Toast message')).toBeInTheDocument();
    });
  });

  it('removes the toast when the close button is clicked', async () => {
    renderWithProvider();
    fireEvent.click(screen.getByRole('button', { name: 'Show toast' }));
    await waitFor(() => {
      expect(screen.getByText('Toast message')).toBeInTheDocument();
    });
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    await waitFor(() => {
      expect(screen.queryByText('Toast message')).not.toBeInTheDocument();
    });
  });

  it('can display multiple toasts independently', async () => {
    renderWithProvider();
    fireEvent.click(screen.getByRole('button', { name: 'Show toast' }));
    fireEvent.click(screen.getByRole('button', { name: 'Show toast' }));
    await waitFor(() => {
      expect(screen.getAllByText('Toast message')).toHaveLength(2);
    });
  });

  it('throws when used outside ToastProvider', () => {
    const TestComponent = () => {
      useToast();
      return null;
    };
    expect(() => render(<TestComponent />)).toThrow('useToast must be used within ToastProvider');
  });
});
