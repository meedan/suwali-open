import { IntlProvider } from 'react-intl';
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';

import ConnectivityRetry from './ConnectivityRetry';

const renderComponent = (props: Partial<React.ComponentProps<typeof ConnectivityRetry>> = {}) =>
  render(
    <IntlProvider locale="en" messages={{}}>
      <ConnectivityRetry nextProbeAt={null} probing={false} onRetry={() => {}} {...props} />
    </IntlProvider>
  );

describe('ConnectivityRetry', () => {
  it('counts down to the next check', () => {
    renderComponent({ nextProbeAt: Date.now() + 10_000 });
    expect(screen.getByText('Retrying in 10 seconds.')).toBeInTheDocument();
  });

  it('says when it is checking, and does not allow another check meanwhile', () => {
    renderComponent({ nextProbeAt: Date.now() + 10_000, probing: true });

    expect(screen.getByText('Checking connection…')).toBeInTheDocument();
    expect(screen.queryByText(/Retrying/)).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Try now' })).toBeDisabled();
  });

  it('checks right away when the user asks', () => {
    const onRetry = vi.fn();
    renderComponent({ onRetry });

    fireEvent.click(screen.getByRole('button', { name: 'Try now' }));
    expect(onRetry).toHaveBeenCalled();
  });
});
