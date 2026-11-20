import { IntlProvider } from 'react-intl';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { QueryClient, QueryClientProvider, useQuery, type UseQueryResult } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';

import BotAttributeDisplay from './BotAttributeDisplay';

vi.mock('@tanstack/react-query', async () => ({
  ...(await vi.importActual('@tanstack/react-query')),
  useQuery: vi.fn(),
}));

const mockLanguages = [
  { code: 'en', name: 'English' },
  { code: 'pt', name: 'Português' },
  { code: 'es', name: 'Español' },
];

const renderDisplay = (props: React.ComponentProps<typeof BotAttributeDisplay>) => {
  const queryClient = new QueryClient();
  return render(
    <QueryClientProvider client={queryClient}>
      <IntlProvider locale="en" messages={{}}>
        <BotAttributeDisplay {...props} />
      </IntlProvider>
    </QueryClientProvider>
  );
};

describe('BotAttributeDisplay', () => {
  beforeEach(() => {
    vi.mocked(useQuery).mockReturnValue({
      data: { languages: mockLanguages },
      isPending: false,
      error: null,
      status: 'success',
    } as UseQueryResult<unknown, unknown>);
  });

  it('lists the languages by name, resolved from their codes', () => {
    renderDisplay({ type: 'languages', languages: ['pt', 'es'], defaultLanguage: 'pt' });
    expect(screen.getAllByRole('listitem').map(item => item.textContent)).toEqual(['Português (default)', 'Español']);
  });

  it('lists every available language, with English as the default, when none are saved', () => {
    renderDisplay({ type: 'languages', languages: [] });
    expect(screen.getByText('Your chatbot will respond in all available languages.')).toBeInTheDocument();
    expect(screen.getAllByRole('listitem').map(item => item.textContent)).toEqual(['English (default)', 'Português', 'Español']);
  });

  it('marks the saved default among all the available languages', () => {
    renderDisplay({ type: 'languages', languages: [], defaultLanguage: 'es' });
    expect(screen.getAllByRole('listitem').map(item => item.textContent)).toEqual(['English', 'Português', 'Español (default)']);
  });

  it('marks the default language in the list', () => {
    renderDisplay({ type: 'languages', languages: ['en', 'pt'], defaultLanguage: 'pt' });
    expect(screen.getAllByRole('listitem').map(item => item.textContent)).toEqual(['English', 'Português (default)']);
  });

  it('is not a button', () => {
    renderDisplay({ type: 'languages', languages: [] });
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });

  it('displays tone label and description', () => {
    renderDisplay({ type: 'tone', value: 'journalist' });
    expect(screen.getByText('Journalist')).toBeInTheDocument();
  });

  it('displays name type value directly', () => {
    renderDisplay({ type: 'name', value: 'My Bot' });
    expect(screen.getByText('My Bot')).toBeInTheDocument();
  });
});
