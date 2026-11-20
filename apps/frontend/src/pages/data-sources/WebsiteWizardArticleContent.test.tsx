import { IntlProvider } from 'react-intl';
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';

import type { WebsiteWizardState } from './WebsiteWizard';
import WebsiteWizardArticleContent from './WebsiteWizardArticleContent';

const defaultState: WebsiteWizardState = {
  multiPage: false,
  websiteUrl: '',
};

const defaultProps = {
  isEditing: false,
  onCancel: vi.fn(),
  onCreate: vi.fn(),
  onStepChange: vi.fn(),
  currentStep: 0,
  wizardState: defaultState,
  setWizardState: vi.fn(),
};

const renderComponent = (wizardState: Partial<WebsiteWizardState> = {}) =>
  render(
    <IntlProvider locale="en" messages={{}}>
      <WebsiteWizardArticleContent {...defaultProps} wizardState={{ ...defaultState, ...wizardState }} />
    </IntlProvider>
  );

describe('WebsiteWizardArticleContent', () => {
  it('should have form labels for link, title and body', () => {
    renderComponent();
    expect(screen.getByText(/css selector for article links/i)).toBeInTheDocument();
    expect(screen.getByText(/css selector for article title/i)).toBeInTheDocument();
    expect(screen.getByText(/css selector for article body/i)).toBeInTheDocument();
  });

  it('should enable continue once all values have been filled', () => {
    const { rerender } = renderComponent();
    expect(screen.getByRole('button', { name: /continue/i })).toBeDisabled();

    rerender(
      <IntlProvider locale="en" messages={{}}>
        <WebsiteWizardArticleContent
          {...defaultProps}
          wizardState={{
            ...defaultState,
            linksCssSelector: 'a.post-link',
            titleCssSelector: 'h1',
            bodyCssSelector: 'article',
          }}
        />
      </IntlProvider>
    );
    expect(screen.getByRole('button', { name: /continue/i })).not.toBeDisabled();
  });

  it('should display common patterns when an input is focused', () => {
    renderComponent();
    expect(screen.queryByText('Common patterns')).not.toBeInTheDocument();

    fireEvent.focus(screen.getAllByRole('textbox')[0]);
    expect(screen.getByText('Common patterns')).toBeInTheDocument();
  });

  describe('tip box', () => {
    it('should show full detection tip when platform is detected', () => {
      renderComponent({ platform: 'wordpress' });
      const hint = screen.getByText(/seems to be built on/i);
      expect(hint.textContent).toMatch(/seems to be built on wordpress/i);
    });

    it('should show partial detection tip when selectors are present but platform is unknown', () => {
      renderComponent({ linksCssSelector: 'article h2 a' });
      expect(screen.getByText(/pre-filled some selectors/i)).toBeInTheDocument();
      expect(screen.queryByText(/seems to be/i)).not.toBeInTheDocument();
    });

    it('should not show any tip when there are no pre-filled selectors and no platform', () => {
      renderComponent();
      expect(screen.queryByText(/pre-filled/i)).not.toBeInTheDocument();
    });
  });

  describe('pagination card', () => {
    it('should display pagination tip when multiple pages is selected and no sample URL has been provided', () => {
      renderComponent({ multiPage: true, websiteUrl: 'https://example.com' });
      expect(document.body).toHaveTextContent(/if your list spans multiple pages/i);
    });

    it('should display an input to provide a sample paginated URL', () => {
      renderComponent({ multiPage: true, websiteUrl: 'https://example.com' });
      expect(screen.getByLabelText(/url of page 2/i)).toBeInTheDocument();
    });

    it('should display detected query pagination box when the sample URL has query pagination', () => {
      renderComponent({
        multiPage: true,
        websiteUrl: 'https://example.com',
        paginationSampleUrl: 'https://example.com?page=2',
      });
      expect(screen.getByRole('radio', { name: '?page=2' })).toBeInTheDocument();
    });

    it('should show only the invalid URL error, not the pagination warning, when the sample URL is invalid', () => {
      renderComponent({
        multiPage: true,
        websiteUrl: 'https://example.com',
        paginationSampleUrl: 'http:ahssdv lgcdsv',
      });

      fireEvent.blur(screen.getByLabelText(/url of page 2/i));

      expect(screen.getByText('Invalid URL')).toBeInTheDocument();
      expect(screen.queryByText(/please update the url above/i)).not.toBeInTheDocument();
    });

    it('should display multiple pages option as selected by default', () => {
      renderComponent({ multiPage: true, websiteUrl: 'https://example.com' });
      expect(screen.getByRole('radio', { name: /yes, multiple pages/i })).toBeChecked();
    });

    it('should display single page option as available but not selected', () => {
      renderComponent({ multiPage: true, websiteUrl: 'https://example.com' });
      expect(screen.getByRole('radio', { name: /no, single page/i })).not.toBeChecked();
    });

    it('should disable continue when multiple pages is selected but no pagination parameter has been chosen', () => {
      renderComponent({
        multiPage: true,
        websiteUrl: 'https://example.com',
        linksCssSelector: 'a.post-link',
        titleCssSelector: 'h1',
        bodyCssSelector: 'article',
      });
      expect(screen.getByRole('button', { name: /continue/i })).toBeDisabled();
    });
  });

});
