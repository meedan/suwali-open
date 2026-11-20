import { IntlProvider } from 'react-intl';
import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';

import * as SessionContext from '@root/SessionContext';
import { buildHub } from '@root/test/fixtures/hub';

import ExternalDataSourcesProgress from './ExternalDataSourcesProgress';

const testHub = buildHub({
  external_data_sources_count: 1,
  documents_count: 1,
  max_sources_for_plan: 3,
  max_documents_for_plan: 3000,
});

vi.mock('../SessionContext', () => ({
  useSession: vi.fn(),
}));

const renderWithHub = (overrides = {}) => {
  vi.mocked(SessionContext.useSession).mockReturnValue({
    currentHub: () => ({ ...testHub, ...overrides }),
  } as ReturnType<typeof SessionContext.useSession>);

  return render(
    <IntlProvider locale="en" messages={{}}>
      <ExternalDataSourcesProgress />
    </IntlProvider>
  );
};

describe('ExternalDataSourcesProgress', () => {
  it('returns null when hub is null', () => {
    vi.mocked(SessionContext.useSession).mockReturnValue({
      currentHub: () => null,
    } as ReturnType<typeof SessionContext.useSession>);

    const { container } = render(
      <IntlProvider locale="en" messages={{}}>
        <ExternalDataSourcesProgress />
      </IntlProvider>
    );
    expect(container).toBeEmptyDOMElement();
  });

  it('shows sources as slots and documents as a bar, each with a label and count', () => {
    renderWithHub();

    expect(screen.getByText('External data sources')).toBeInTheDocument();
    expect(screen.getByText('Sources')).toBeInTheDocument();
    expect(screen.getByText('1 of 3')).toBeInTheDocument();
    expect(screen.getAllByRole('progressbar')).toHaveLength(1);
    expect(screen.getByRole('progressbar', { name: 'Documents' })).toHaveAccessibleDescription('1 of 3,000');
  });

  it('falls back to a bar for sources when the limit is large', () => {
    renderWithHub({ max_sources_for_plan: 50, external_data_sources_count: 25 });

    const sources = screen.getByRole('progressbar', { name: 'Sources' });
    expect(sources.tagName).toBe('PROGRESS');
    expect(sources).toHaveAccessibleDescription('25 of 50');
  });

  it('shows only the limit that exists when the other is unlimited', () => {
    renderWithHub({ max_documents_for_plan: null });

    expect(screen.getByText('1 of 3')).toBeInTheDocument();
    expect(screen.queryByText(/Documents/)).not.toBeInTheDocument();
  });

  it('shows only the count when neither limit exists', () => {
    renderWithHub({ max_sources_for_plan: null, max_documents_for_plan: null });

    expect(screen.getByText(/External data sources/)).toHaveTextContent('External data sources (1)');
    expect(screen.queryByText(/of/)).not.toBeInTheDocument();
  });
});
