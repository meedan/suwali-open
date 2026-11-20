import { IntlProvider } from 'react-intl';
import { describe, expect, it } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';

import PreviewModalBase from './PreviewModalBase';

const renderModal = (props: Partial<React.ComponentProps<typeof PreviewModalBase>> = {}) =>
  render(
    <IntlProvider locale="en">
      <PreviewModalBase
        open
        onOpenChange={() => {}}
        title="A document"
        details={<span>Meta details</span>}
        content={<p>The preview</p>}
        {...props}
      />
    </IntlProvider>,
  );

describe('PreviewModalBase', () => {
  it('offers no switch between preview and details when the details are above the content', () => {
    renderModal();

    expect(screen.queryByRole('radio', { name: 'Details' })).not.toBeInTheDocument();
  });

  describe('with the details beside the content', () => {
    it('shows both and starts on the preview', () => {
      renderModal({ detailsPlacement: 'side' });

      expect(screen.getByText('The preview')).toBeInTheDocument();
      expect(screen.getByText('Meta details')).toBeInTheDocument();
      expect(screen.getByRole('radio', { name: 'Preview' })).toBeChecked();
    });

    it('moves the switch to the details when chosen', () => {
      renderModal({ detailsPlacement: 'side' });

      fireEvent.click(screen.getByRole('radio', { name: 'Details' }));

      expect(screen.getByRole('radio', { name: 'Details' })).toBeChecked();
    });

    it('keeps a choice when it is chosen again, so one pane always shows', () => {
      renderModal({ detailsPlacement: 'side' });

      fireEvent.click(screen.getByRole('radio', { name: 'Preview' }));

      expect(screen.getByRole('radio', { name: 'Preview' })).toBeChecked();
    });

    it('keeps the details in the page when they are chosen', () => {
      renderModal({ detailsPlacement: 'side' });

      fireEvent.click(screen.getByRole('radio', { name: 'Details' }));

      expect(screen.getByText('Meta details')).toBeInTheDocument();
    });
  });
});
