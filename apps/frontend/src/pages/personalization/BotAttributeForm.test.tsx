import { IntlProvider } from 'react-intl';
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';

import BotAttributeForm from './BotAttributeForm';

vi.mock('@services/HubService', () => ({
  updateBotAttributes: vi.fn(),
}));

const renderForm = (props: Partial<React.ComponentProps<typeof BotAttributeForm>> = {}) =>
  render(
    <IntlProvider locale="en" messages={{}}>
      <BotAttributeForm attributeType="chatbotName" hubId={1} {...props} />
    </IntlProvider>
  );

describe('BotAttributeForm', () => {
  describe.each([
    ['chatbotName', 'Add name', 'Save name'],
    ['roleDescription', 'Add role & description', 'Save role & description'],
    ['responseStyle', 'Add response style & tone', 'Save response style & tone'],
  ] as const)('the buttons for %s', (attributeType, add, save) => {
    it(`offer to "${add}" while it is not set, and to "${save}" once it is`, () => {
      const { unmount } = renderForm({ attributeType });
      expect(screen.getByRole('button', { name: add })).toBeInTheDocument();
      unmount();

      renderForm({ attributeType, hasSavedValue: true, currentBotAttributes: { name: 'Evidence Bot', description: 'Checks claims.', tone: 'journalist' } });
      expect(screen.getByRole('button', { name: save })).toBeInTheDocument();
    });
  });

  describe('setting it for the first time', () => {
    it('cancels back out', () => {
      const onCancel = vi.fn();
      renderForm({ onCancel });

      fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));

      expect(onCancel).toHaveBeenCalled();
    });
  });

  describe('naming the fields', () => {
    it('names the role field for what it is, while its visible label is the instruction', () => {
      renderForm({ attributeType: 'roleDescription', hasSavedValue: true, currentBotAttributes: { description: 'Checks claims.' } });

      expect(screen.getByRole('textbox', { name: 'Role & description' })).toHaveValue('Checks claims.');
      expect(screen.getByText('Describe the best use of your chatbot for your audience.')).toBeInTheDocument();
    });
  });

  describe('editing what was saved', () => {
    const props = { hasSavedValue: true, currentBotAttributes: { name: 'Evidence Bot' } };

    it('keeps save off and hides discard until something changes', () => {
      renderForm(props);

      expect(screen.getByRole('textbox', { name: /Chatbot name/ })).toHaveValue('Evidence Bot');
      expect(screen.getByRole('button', { name: 'Save name' })).toBeDisabled();
      expect(screen.queryByRole('button', { name: 'Discard changes' })).not.toBeInTheDocument();
    });

    it('goes back to what was saved on discard, staying on the form', () => {
      const onCancel = vi.fn();
      renderForm({ ...props, onCancel });

      fireEvent.change(screen.getByRole('textbox', { name: /Chatbot name/ }), { target: { value: 'Other Bot' } });
      expect(screen.getByRole('button', { name: 'Save name' })).toBeEnabled();

      fireEvent.click(screen.getByRole('button', { name: 'Discard changes' }));

      expect(screen.getByRole('textbox', { name: /Chatbot name/ })).toHaveValue('Evidence Bot');
      expect(screen.getByRole('button', { name: 'Save name' })).toBeDisabled();
      expect(onCancel).not.toHaveBeenCalled();
    });
  });

  describe('response style', () => {
    const props = { attributeType: 'responseStyle' as const, hasSavedValue: true, currentBotAttributes: { tone: 'journalist' as const } };

    it('offers each style as a card, with the saved one selected', () => {
      renderForm(props);

      expect(screen.getByRole('group', { name: /Response style/ })).toBeInTheDocument();
      expect(screen.getByRole('radio', { name: /Journalist/ })).toBeChecked();
      expect(screen.getByRole('radio', { name: /Advocate/ })).not.toBeChecked();
      expect(screen.getByRole('radio', { name: /Executive/ })).toBeInTheDocument();
    });

    it('saves a different style, and goes back to the saved one on discard', () => {
      renderForm(props);
      expect(screen.getByRole('button', { name: 'Save response style & tone' })).toBeDisabled();

      fireEvent.click(screen.getByRole('radio', { name: /Advocate/ }));
      expect(screen.getByRole('radio', { name: /Advocate/ })).toBeChecked();
      expect(screen.getByRole('button', { name: 'Save response style & tone' })).toBeEnabled();

      fireEvent.click(screen.getByRole('button', { name: 'Discard changes' }));
      expect(screen.getByRole('radio', { name: /Journalist/ })).toBeChecked();
    });

    it('selects the default style, and marks it, when none has been saved', () => {
      renderForm({ attributeType: 'responseStyle', hasSavedValue: true, currentBotAttributes: {} });

      expect(screen.getByRole('radio', { name: /Journalist/ })).toBeChecked();
      expect(screen.getByRole('radio', { name: /Journalist.*Default/ })).toBeInTheDocument();
      expect(screen.getByRole('radio', { name: /Advocate/ })).not.toHaveAccessibleName(/Default/);
    });

    it('offers to remove a saved style, but not the default that is used when none is saved', () => {
      const { unmount } = renderForm({ attributeType: 'responseStyle', hasSavedValue: true, currentBotAttributes: {} });
      expect(screen.queryByRole('button', { name: /Remove/ })).not.toBeInTheDocument();
      unmount();

      renderForm(props);
      expect(screen.getByRole('button', { name: /Remove/ })).toBeInTheDocument();
    });
  });
});
