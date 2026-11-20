import { Tooltip as TooltipPrimitive } from 'radix-ui';
import { IntlProvider } from 'react-intl';
import { MemoryRouter } from 'react-router';
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';

import type { IngestionError } from '@customTypes/source';

import IngestionErrorRow from './IngestionErrorRow';

vi.mock('@hooks/useCapabilities', () => ({
  useCan: () => ({ allowed: true }),
}));

vi.mock('@ui-components/input/DropdownMenu.tsx', () => ({
  DropdownMenu: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DropdownMenuTrigger: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DropdownMenuContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DropdownMenuItem: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DropdownMenuSeparator: () => null,
}));

const baseError: IngestionError = {
  external_id: 'file-1',
  title: 'linked.txt',
  link: 'https://drive.google.com/file/d/file-1/view',
  reason: 'shortcut_target_inaccessible',
  details: null,
};

const renderRow = (overrides: Partial<IngestionError> = {}, lastSyncedAt?: string | null, onDelete?: () => void) =>
  render(
    <MemoryRouter>
      <IntlProvider locale="en" messages={{}}>
        <TooltipPrimitive.Provider>
          <table><tbody>
            <IngestionErrorRow error={{ ...baseError, ...overrides }} lastSyncedAt={lastSyncedAt} onDelete={onDelete} />
          </tbody></table>
        </TooltipPrimitive.Provider>
      </IntlProvider>
    </MemoryRouter>
  );

describe('IngestionErrorRow', () => {
  it('renders the file title with an unsupported status', () => {
    renderRow();
    expect(screen.getByText('linked.txt')).toBeInTheDocument();
    expect(screen.getByText(/Unsupported/)).toBeInTheDocument();
  });

  it('shows the reason for a shortcut whose target is not shared', () => {
    renderRow({ reason: 'shortcut_target_inaccessible' });
    expect(screen.getByText("This shortcut’s target file isn’t shared with the importer.")).toBeInTheDocument();
  });

  it('includes the MIME type in the unsupported-type reason', () => {
    renderRow({ reason: 'unsupported_type', details: 'image/png' });
    expect(screen.getByText("This file type isn’t supported (image/png).")).toBeInTheDocument();
  });

  it('shows the reason for a subfolder', () => {
    renderRow({ reason: 'folder_not_supported' });
    expect(screen.getByText('Subfolders aren’t imported. Move the files into the connected folder to import them.')).toBeInTheDocument();
  });

  it('falls back to a generic reason for an unrecognized reason', () => {
    renderRow({ reason: 'something_new' });
    expect(screen.getByText('This file could not be imported.')).toBeInTheDocument();
  });

  it('shows the reason for a document with no extractable text', () => {
    renderRow({ reason: 'NO_TEXT_FOUND' });
    expect(screen.getByText('No text could be extracted from this file.')).toBeInTheDocument();
  });

  it('shows the reason for a document that is too large to process', () => {
    renderRow({ reason: 'TEXT_TOO_LARGE' });
    expect(screen.getByText('This file’s content is too large to process.')).toBeInTheDocument();
  });

  it('shows the last sync date, falling back to an em-dash when absent', () => {
    const { rerender } = renderRow({}, '2026-06-15T10:00:00Z');
    expect(screen.getByText(new Date('2026-06-15T10:00:00Z').toLocaleDateString())).toBeInTheDocument();

    rerender(
      <MemoryRouter>
        <IntlProvider locale="en" messages={{}}>
          <TooltipPrimitive.Provider>
            <table><tbody>
              <IngestionErrorRow error={baseError} lastSyncedAt={null} />
            </tbody></table>
          </TooltipPrimitive.Provider>
        </IntlProvider>
      </MemoryRouter>
    );
    expect(screen.getByText('—')).toBeInTheDocument();
  });

  it('offers an "Open source" action linking to the file', () => {
    renderRow();
    expect(screen.getByRole('button', { name: 'Open source' })).toBeInTheDocument();
  });

  it('offers Remove and calls onDelete when a delete handler is given', () => {
    const onDelete = vi.fn();
    renderRow({}, null, onDelete);
    fireEvent.click(screen.getByRole('button', { name: 'Remove' }));
    expect(onDelete).toHaveBeenCalledTimes(1);
  });

  it('omits Remove when there is no delete handler', () => {
    renderRow();
    expect(screen.queryByRole('button', { name: 'Remove' })).not.toBeInTheDocument();
  });

  it('omits the "Open source" action when there is no link', () => {
    renderRow({ link: null });
    expect(screen.queryByRole('button', { name: 'Open source' })).not.toBeInTheDocument();
  });
});
