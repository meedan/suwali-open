import { IntlProvider } from 'react-intl';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { QueryClient, QueryClientProvider, useQuery, type UseQueryResult } from '@tanstack/react-query';
import { fireEvent, render, screen } from '@testing-library/react';

import AvailableLanguagesForm from './AvailableLanguagesForm';

vi.mock('@tanstack/react-query', async () => ({
  ...(await vi.importActual('@tanstack/react-query')),
  useQuery: vi.fn(),
}));

vi.mock('@services/HubService', () => ({
  updateBotAttributes: vi.fn(),
}));

vi.mock('@ui-components/layout/Modal', () => ({
  Modal: ({ title, body, actions, open }: { title: React.ReactNode; body: React.ReactNode; actions: React.ReactNode; open: boolean }) =>
    open ? (
      <dialog open>
        <div>{title}</div>
        <div>{body}</div>
        <div>{actions}</div>
      </dialog>
    ) : null,
}));

const mockLanguages = [
  { code: 'en', name: 'English' },
  { code: 'pt', name: 'Português' },
  { code: 'es', name: 'Español' },
];

const renderForm = (props: Partial<React.ComponentProps<typeof AvailableLanguagesForm>> = {}) => {
  const queryClient = new QueryClient();
  return render(
    <QueryClientProvider client={queryClient}>
      <IntlProvider locale="en" messages={{}}>
        <AvailableLanguagesForm hubId={1} {...props} />
      </IntlProvider>
    </QueryClientProvider>
  );
};

describe('AvailableLanguagesForm', () => {
  beforeEach(() => {
    vi.mocked(useQuery).mockReturnValue({
      data: { languages: mockLanguages },
      isPending: false,
      error: null,
      status: 'success',
    } as UseQueryResult<unknown, unknown>);
  });

  it('renders the form with language checkboxes', () => {
    renderForm();
    expect(screen.getByText('English')).toBeInTheDocument();
    expect(screen.getByText('Português')).toBeInTheDocument();
    expect(screen.getByText('Español')).toBeInTheDocument();
  });

  it('renders the "All Languages" checkbox checked by default', () => {
    renderForm();
    const allCheckbox = screen.getByRole('checkbox', { name: /all languages/i });
    expect(allCheckbox).toBeChecked();
  });

  it('disables individual language checkboxes when "All Languages" is checked', () => {
    renderForm();
    const enCheckbox = screen.getByRole('checkbox', { name: 'English' });
    expect(enCheckbox).toBeDisabled();
  });

  it('enables individual language checkboxes when "All Languages" is unchecked', () => {
    renderForm();
    const allCheckbox = screen.getByRole('checkbox', { name: /all languages/i });
    fireEvent.click(allCheckbox);

    // Non-default languages should be enabled
    const ptCheckbox = screen.getByRole('checkbox', { name: 'Português' });
    expect(ptCheckbox).not.toBeDisabled();
  });

  it('keeps the default language checkbox disabled when "All Languages" is unchecked', () => {
    renderForm();
    const allCheckbox = screen.getByRole('checkbox', { name: /all languages/i });
    fireEvent.click(allCheckbox);

    // Default language (en) should remain disabled (can't uncheck it)
    const enCheckbox = screen.getByRole('checkbox', { name: 'English' });
    expect(enCheckbox).toBeDisabled();
  });

  it('shows "Set default" buttons for non-default languages', () => {
    renderForm();
    const setDefaultButtons = screen.getAllByRole('button', { name: 'Set default' });
    expect(setDefaultButtons.length).toBeGreaterThan(0);
  });

  it('shows "Default" label for the current default language', () => {
    renderForm();
    expect(screen.getByRole('button', { name: 'Default' })).toBeInTheDocument();
  });

  it('renders the submit button', () => {
    renderForm();
    expect(screen.getByRole('button', { name: 'Add languages' })).toBeInTheDocument();
  });

  it('renders the save button in edit mode', () => {
    renderForm({
      hasSavedValue: true,
      currentBotAttributes: { supported_languages: ['en', 'pt'], default_language: 'en' },
    });
    expect(screen.getByRole('button', { name: 'Save languages' })).toBeInTheDocument();
  });

  it('renders the remove button in edit mode', () => {
    renderForm({
      hasSavedValue: true,
      currentBotAttributes: { supported_languages: ['en', 'pt'], default_language: 'en' },
    });
    expect(screen.getByRole('button', { name: 'Remove' })).toBeInTheDocument();
  });

  it('says all languages are used, and offers nothing to remove, while none are saved', () => {
    renderForm({ hasSavedValue: true, currentBotAttributes: {} });

    expect(screen.getByText(/Until you choose, your chatbot responds in all languages/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Remove' })).not.toBeInTheDocument();
  });

  it('does not say all languages are used once languages are saved', () => {
    renderForm({
      hasSavedValue: true,
      currentBotAttributes: { supported_languages: ['en', 'pt'], default_language: 'en' },
    });

    expect(screen.queryByText(/Until you choose/)).not.toBeInTheDocument();
  });

  it('shows delete confirmation modal when remove is clicked', () => {
    renderForm({
      hasSavedValue: true,
      currentBotAttributes: { supported_languages: ['en', 'pt'], default_language: 'en' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Remove' }));
    expect(screen.getByText('Remove personalization?')).toBeInTheDocument();
  });

  describe('editing saved languages', () => {
    const saved = { supported_languages: ['en', 'es'], default_language: 'en' };

    it('keeps save off and hides discard until something changes', () => {
      renderForm({ hasSavedValue: true, currentBotAttributes: saved });

      expect(screen.getByRole('button', { name: 'Save languages' })).toBeDisabled();
      expect(screen.queryByRole('button', { name: 'Discard changes' })).not.toBeInTheDocument();
    });

    it('goes back to what was saved on discard', () => {
      renderForm({ hasSavedValue: true, currentBotAttributes: saved });

      fireEvent.click(screen.getByRole('checkbox', { name: 'Español' }));
      expect(screen.getByRole('button', { name: 'Save languages' })).toBeEnabled();

      fireEvent.click(screen.getByRole('button', { name: 'Discard changes' }));
      expect(screen.getByRole('checkbox', { name: 'Español' })).toBeChecked();
      expect(screen.getByRole('button', { name: 'Save languages' })).toBeDisabled();
    });
  });
});
