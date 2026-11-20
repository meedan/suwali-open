import { IntlProvider } from 'react-intl';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';

import type { About } from '@services/AboutService';
import { fetchAbout } from '@services/AboutService';

import BookDemoHelp from './BookDemoHelp';

vi.mock('@services/AboutService');

const renderComponent = () =>
  render(
    <QueryClientProvider client={new QueryClient()}>
      <IntlProvider locale="en" messages={{}}>
        <BookDemoHelp />
      </IntlProvider>
    </QueryClientProvider>
  );

describe('BookDemoHelp', () => {
  beforeEach(() => {
    vi.mocked(fetchAbout).mockReset();
  });

  it('offers a demo at the link the server gives', async () => {
    vi.mocked(fetchAbout).mockResolvedValue({ schedule_demo_link: 'https://example.com/demo' } as About);

    renderComponent();

    const link = await screen.findByRole('link', { name: 'Book a demo.' });
    expect(link).toHaveAttribute('href', 'https://example.com/demo');
    expect(link).toHaveAttribute('target', '_blank');
  });

  it('offers nothing until the link is known', () => {
    vi.mocked(fetchAbout).mockReturnValue(new Promise(() => {}));

    renderComponent();

    expect(screen.queryByText(/Need some guidance/)).not.toBeInTheDocument();
  });
});
