import { Toast as ToastPrimitive } from 'radix-ui';
import { useEffect } from 'react';
import { IntlProvider } from 'react-intl';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';

import { fetchAbout } from '@services/AboutService';

import { ToastProvider } from '@hooks/useToast';

import DocumentSummary from './DocumentSummary';

// Stands in for the editor, which writes the markdown its own way: bullets as *, and without the trailing newline
const normalize = (md: string) => md.replace(/^- /gm, '* ').trimEnd();

type EditorProps = { ariaLabel?: string; initialValue: string; isEditing?: boolean; onChange?: (md: string) => void; onReady?: (md: string) => void };

const FakeEditor = ({ ariaLabel, initialValue, isEditing, onChange, onReady }: EditorProps) => {
  // Reports once on mount, as the editor does, and not again as the text it was given changes with each edit
  useEffect(() => {
    if (!isEditing) return;
    if (normalize(initialValue) !== initialValue) onChange?.(normalize(initialValue));
    onReady?.(normalize(initialValue));
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  return isEditing
    ? <textarea aria-label={ariaLabel} defaultValue={initialValue} onChange={e => onChange?.(e.target.value)} />
    : <div>{initialValue}</div>;
};

vi.mock('@components/MarkdownEditor', () => ({ default: FakeEditor }));

// What the server says the longest summary can be
const MAX_SUMMARY_LENGTH = 2000;

vi.mock('@services/AboutService', () => ({ fetchAbout: vi.fn() }));



const renderSummary = (onSave = vi.fn().mockResolvedValue(undefined), summary = 'The original summary') => {
  render(
    <IntlProvider locale="en">
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <ToastPrimitive.Provider>
          <ToastProvider>
            <DocumentSummary summary={summary} onSave={onSave} />
          </ToastProvider>
          <ToastPrimitive.Viewport />
        </ToastPrimitive.Provider>
      </QueryClientProvider>
    </IntlProvider>,
  );
  return onSave;
};

const edit = async (text: string) => {
  fireEvent.click(screen.getByRole('button', { name: 'Edit' }));
  fireEvent.change(await screen.findByRole('textbox', { name: 'Document summary' }), { target: { value: text } });
};

describe('DocumentSummary', () => {
  beforeEach(() => {
    vi.mocked(fetchAbout).mockReset().mockResolvedValue({ max_summary_length: MAX_SUMMARY_LENGTH } as Awaited<ReturnType<typeof fetchAbout>>);
  });

  it('shows the summary to read', async () => {
    renderSummary();

    expect(await screen.findByText('The original summary')).toBeInTheDocument();
    expect(screen.queryByRole('textbox', { name: 'Document summary' })).not.toBeInTheDocument();
  });

  it('opens the summary for editing', async () => {
    renderSummary();

    fireEvent.click(screen.getByRole('button', { name: 'Edit' }));

    expect(await screen.findByRole('textbox', { name: 'Document summary' })).toHaveValue('The original summary');
    expect(screen.queryByRole('button', { name: 'Edit' })).not.toBeInTheDocument();
  });

  it('cannot save until the summary has changed, and is neither empty nor too long', async () => {
    renderSummary();
    fireEvent.click(screen.getByRole('button', { name: 'Edit' }));
    await screen.findByRole('textbox');
    const save = screen.getByRole('button', { name: 'Save summary' });
    await screen.findByText(/\/ 2,000 characters/);

    expect(save).toBeDisabled();
    fireEvent.change(screen.getByRole('textbox'), { target: { value: '   ' } });
    expect(save).toBeDisabled();
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'A new summary' } });
    expect(save).toBeEnabled();
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'a'.repeat(MAX_SUMMARY_LENGTH + 1) } });
    expect(save).toBeDisabled();
  });

  it('counts the characters of the draft against the most the server allows', async () => {
    renderSummary();
    await edit('Hello');

    expect(await screen.findByText('5 / 2,000 characters')).toBeInTheDocument();
  });

  it('counts and limits nothing while the most the server allows is not known, leaving that to the server', async () => {
    vi.mocked(fetchAbout).mockReturnValue(new Promise(() => {}));
    renderSummary();

    await edit('a'.repeat(MAX_SUMMARY_LENGTH + 1));

    expect(screen.queryByText(/characters/)).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Save summary' })).toBeEnabled();
  });

  it('does not count the editor writing the markdown its own way as a change', async () => {
    renderSummary(undefined, '# Title\n\n- one\n- two\n');
    fireEvent.click(screen.getByRole('button', { name: 'Edit' }));
    await screen.findByRole('textbox', { name: 'Document summary' });

    expect(screen.getByRole('button', { name: 'Save summary' })).toBeDisabled();
    fireEvent.change(screen.getByRole('textbox'), { target: { value: '# Title\n\n* one\n* two\n* three' } });
    expect(screen.getByRole('button', { name: 'Save summary' })).toBeEnabled();
    fireEvent.change(screen.getByRole('textbox'), { target: { value: '# Title\n\n* one\n* two' } });
    expect(screen.getByRole('button', { name: 'Save summary' })).toBeDisabled();
  });

  it('discards the changes when cancelled', async () => {
    renderSummary();
    await edit('A new summary');

    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));

    expect(await screen.findByText('The original summary')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Edit' }));
    expect(await screen.findByRole('textbox')).toHaveValue('The original summary');
  });

  it('asks to confirm before saving, and saves nothing if that is cancelled', async () => {
    const onSave = renderSummary();
    await edit('A new summary');

    fireEvent.click(screen.getByRole('button', { name: 'Save summary' }));
    expect(screen.getByText('Save summary?')).toBeInTheDocument();
    expect(onSave).not.toHaveBeenCalled();

    const cancelButtons = screen.getAllByRole('button', { name: 'Cancel' });
    fireEvent.click(cancelButtons[cancelButtons.length - 1]);
    expect(onSave).not.toHaveBeenCalled();
    expect(screen.getByRole('textbox')).toHaveValue('A new summary');
  });

  it('saves the new summary once confirmed, and shows it', async () => {
    const onSave = renderSummary();
    await edit('A new summary');

    fireEvent.click(screen.getByRole('button', { name: 'Save summary' }));
    fireEvent.click(screen.getByRole('button', { name: 'Yes, save' }));

    await waitFor(() => expect(screen.getByText('A new summary')).toBeInTheDocument());
    expect(onSave).toHaveBeenCalledWith('A new summary');
    expect(screen.queryByRole('textbox', { name: 'Document summary' })).not.toBeInTheDocument();
  });

  it('keeps the editor open with the changes when saving fails', async () => {
    renderSummary(vi.fn().mockRejectedValue(new Error('nope')));
    await edit('A new summary');

    fireEvent.click(screen.getByRole('button', { name: 'Save summary' }));
    fireEvent.click(screen.getByRole('button', { name: 'Yes, save' }));

    await waitFor(() => expect(screen.getByText(/error saving the summary/i)).toBeInTheDocument());
    expect(screen.getByRole('textbox')).toHaveValue('A new summary');
  });
});
