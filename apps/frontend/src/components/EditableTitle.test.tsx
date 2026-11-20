import { Tooltip as TooltipPrimitive } from 'radix-ui';
import { IntlProvider } from 'react-intl';
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';

import EditableTitle from './EditableTitle';

const renderEditableTitle = (props: Partial<React.ComponentProps<typeof EditableTitle>> = {}) =>
  render(
    <IntlProvider locale="en" messages={{}}>
      <TooltipPrimitive.Provider>
        <EditableTitle value="My title" onSave={vi.fn()} {...props} />
      </TooltipPrimitive.Provider>
    </IntlProvider>
  );

describe('EditableTitle', () => {
  describe('display mode', () => {
    it('renders value in an h2 by default', () => {
      renderEditableTitle();
      expect(screen.getByRole('heading', { level: 2, name: 'My title' })).toBeInTheDocument();
    });

    it('renders value in an h3 when size is small', () => {
      renderEditableTitle({ size: 'small' });
      expect(screen.getByRole('heading', { level: 3, name: 'My title' })).toBeInTheDocument();
    });

    it('renders displayValue instead of value when provided', () => {
      renderEditableTitle({ displayValue: <span>Custom display</span> });
      expect(screen.getByText('Custom display')).toBeInTheDocument();
      expect(screen.queryByRole('heading', { name: 'My title' })).not.toBeInTheDocument();
    });

    it('does not enter edit mode on click when canEdit is false', () => {
      renderEditableTitle({ canEdit: false });
      fireEvent.click(screen.getByRole('heading', { level: 2 }));
      expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
    });
  });

  describe('entering edit mode', () => {
    it('shows a text input after clicking the heading', () => {
      renderEditableTitle();
      fireEvent.click(screen.getByRole('heading', { level: 2 }));
      expect(screen.getByRole('textbox')).toBeInTheDocument();
    });

    it('starts in edit mode when startEditing is true', () => {
      renderEditableTitle({ startEditing: true });
      expect(screen.getByRole('textbox')).toBeInTheDocument();
    });
  });

  describe('confirming', () => {
    it('calls onSave with trimmed value and exits edit mode when confirm button is clicked', () => {
      const onSave = vi.fn();
      renderEditableTitle({ onSave });
      fireEvent.click(screen.getByRole('heading', { level: 2 }));
      fireEvent.change(screen.getByRole('textbox'), { target: { value: '  New title  ' } });
      fireEvent.click(screen.getByRole('button', { name: 'Set title' }));
      expect(onSave).toHaveBeenCalledWith('New title');
      expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
    });

    it('calls onSave when Enter is pressed', () => {
      const onSave = vi.fn();
      renderEditableTitle({ onSave });
      fireEvent.click(screen.getByRole('heading', { level: 2 }));
      fireEvent.change(screen.getByRole('textbox'), { target: { value: 'New title' } });
      fireEvent.keyDown(screen.getByRole('textbox'), { key: 'Enter' });
      expect(onSave).toHaveBeenCalledWith('New title');
      expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
    });

    it('does not call onSave when value is unchanged', () => {
      const onSave = vi.fn();
      renderEditableTitle({ onSave });
      fireEvent.click(screen.getByRole('heading', { level: 2 }));
      fireEvent.keyDown(screen.getByRole('textbox'), { key: 'Enter' });
      expect(onSave).not.toHaveBeenCalled();
    });

    it('does not call onSave when trimmed value is empty', () => {
      const onSave = vi.fn();
      renderEditableTitle({ onSave });
      fireEvent.click(screen.getByRole('heading', { level: 2 }));
      fireEvent.change(screen.getByRole('textbox'), { target: { value: '   ' } });
      fireEvent.keyDown(screen.getByRole('textbox'), { key: 'Enter' });
      expect(onSave).not.toHaveBeenCalled();
    });
  });

  describe('cancelling', () => {
    it('exits edit mode and restores original value when cancel button is clicked', () => {
      renderEditableTitle();
      fireEvent.click(screen.getByRole('heading', { level: 2 }));
      fireEvent.change(screen.getByRole('textbox'), { target: { value: 'Changed' } });
      fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
      expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
      expect(screen.getByRole('heading', { name: 'My title' })).toBeInTheDocument();
    });

    it('exits edit mode and restores original value when Escape is pressed', () => {
      renderEditableTitle();
      fireEvent.click(screen.getByRole('heading', { level: 2 }));
      fireEvent.change(screen.getByRole('textbox'), { target: { value: 'Changed' } });
      fireEvent.keyDown(screen.getByRole('textbox'), { key: 'Escape' });
      expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
      expect(screen.getByRole('heading', { name: 'My title' })).toBeInTheDocument();
    });

    it('exits edit mode and restores original value when clicking outside', () => {
      renderEditableTitle();
      fireEvent.click(screen.getByRole('heading', { level: 2 }));
      fireEvent.change(screen.getByRole('textbox'), { target: { value: 'Changed' } });
      fireEvent.mouseDown(document.body);
      expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
      expect(screen.getByRole('heading', { name: 'My title' })).toBeInTheDocument();
    });

    it('stays in edit mode when clicking inside the input', () => {
      renderEditableTitle();
      fireEvent.click(screen.getByRole('heading', { level: 2 }));
      fireEvent.change(screen.getByRole('textbox'), { target: { value: 'Changed' } });
      fireEvent.mouseDown(screen.getByRole('textbox'));
      expect(screen.getByRole('textbox')).toBeInTheDocument();
    });
  });

  describe('external value updates', () => {
    it('does not overwrite unsaved edits when value prop changes while editing', () => {
      const onSave = vi.fn();
      const { rerender } = renderEditableTitle({ onSave });
      fireEvent.click(screen.getByRole('heading', { level: 2 }));
      fireEvent.change(screen.getByRole('textbox'), { target: { value: 'Changed' } });

      rerender(
        <IntlProvider locale="en" messages={{}}>
          <TooltipPrimitive.Provider>
            <EditableTitle value="Updated elsewhere" onSave={onSave} />
          </TooltipPrimitive.Provider>
        </IntlProvider>
      );

      expect(screen.getByRole('textbox')).toHaveValue('Changed');
    });

    it('adopts the new value once editing ends', () => {
      const onSave = vi.fn();
      const { rerender } = renderEditableTitle({ onSave });
      fireEvent.click(screen.getByRole('heading', { level: 2 }));

      rerender(
        <IntlProvider locale="en" messages={{}}>
          <TooltipPrimitive.Provider>
            <EditableTitle value="Updated elsewhere" onSave={onSave} />
          </TooltipPrimitive.Provider>
        </IntlProvider>
      );
      fireEvent.keyDown(screen.getByRole('textbox'), { key: 'Escape' });

      expect(screen.getByRole('heading', { name: 'Updated elsewhere' })).toBeInTheDocument();
    });
  });
});
