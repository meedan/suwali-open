import { IntlProvider } from 'react-intl';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';

import type { ExternalResource } from '@customTypes/external-resource';

import type { About } from '@services/AboutService';
import { fetchAbout } from '@services/AboutService';
import { createExternalResource, updateExternalResource } from '@services/ExternalResourcesService';

import ExternalResourceForm from './ExternalResourceForm';

vi.mock('@services/ExternalResourcesService', () => ({
  createExternalResource: vi.fn(),
  deleteExternalResource: vi.fn(),
  updateExternalResource: vi.fn(),
}));
vi.mock('@services/AboutService');

const limits = { max_resource_question_length: 200, max_resource_description_length: 500 };

beforeEach(() => {
  vi.mocked(fetchAbout).mockResolvedValue(limits as About);
});

const resource: ExternalResource = { id: 5, resource_type: 'link', title: 'https://help.example.com', description: 'For people who want a person.', scenarios: ['speak_to_person'] };

const renderForm = (props: Partial<React.ComponentProps<typeof ExternalResourceForm>> = {}) =>
  render(
    <QueryClientProvider client={new QueryClient()}>
      <IntlProvider locale="en" messages={{}}>
        <ExternalResourceForm hubId={1} {...props} />
      </IntlProvider>
    </QueryClientProvider>
  );

// A type is named by its label, followed by the example under it
const typeRadio = (name: string) => screen.getByRole('radio', { name: (accessibleName) => accessibleName.startsWith(name) });
const chooseType = (name: string) => fireEvent.click(typeRadio(name));
const value = (name: string) => screen.getByRole('textbox', { name });
const useful = 'What does this resource offer?';
const fillUseful = (text = 'Share when someone needs a person.') => fireEvent.change(value(useful), { target: { value: text } });
const addButton = () => screen.getByRole('button', { name: 'Add new resource' });

describe('ExternalResourceForm', () => {
  describe('adding one', () => {
    it('asks for the type first, and has nothing chosen until it is', () => {
      renderForm();

      for (const name of ['Email address', 'Phone number', 'Link', 'Question']) {
        expect(typeRadio(name)).not.toBeChecked();
      }
      expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
      expect(screen.queryByRole('checkbox')).not.toBeInTheDocument();
      expect(addButton()).toBeDisabled();

      chooseType('Link');
      expect(screen.getByRole('checkbox', { name: /Speak to a person/ })).toBeInTheDocument();
    });

    it('can be saved once it has a type, a value that fits it and a scenario, and cancels back out', () => {
      const onCancel = vi.fn();
      renderForm({ onCancel });

      chooseType('Email address');
      fireEvent.change(value('Email address'), { target: { value: 'help@example.com' } });
      expect(addButton()).toBeDisabled();

      fireEvent.click(screen.getByRole('checkbox', { name: /Speak to a person/ }));
      expect(addButton()).toBeDisabled();

      fillUseful();
      expect(addButton()).toBeEnabled();

      fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
      expect(onCancel).toHaveBeenCalled();
    });

    it('saves the type with the value, and a phone number in full international form', async () => {
      vi.mocked(createExternalResource).mockResolvedValue({} as ExternalResource);
      const onSuccess = vi.fn();
      renderForm({ onSuccess });

      chooseType('Phone number');
      fireEvent.change(value('Phone number'), { target: { value: '(202) 555-0100' } });
      fillUseful('Call during office hours.');
      fireEvent.click(screen.getByRole('checkbox', { name: /Speak to a person/ }));
      fireEvent.click(addButton());

      await waitFor(() => expect(onSuccess).toHaveBeenCalled());
      expect(createExternalResource).toHaveBeenCalledWith({
        params: { hub_id: 1, resource_type: 'phone', title: '+12025550100', description: 'Call during office hours.', scenarios: ['speak_to_person'] },
      });
    });

    it.each([
      ['Email address', 'not an email', 'This does not look like a valid email address.'],
      ['Phone number', '123', 'This does not look like a valid phone number.'],
      ['Link', 'asdf', 'Invalid URL'],
      ['Link', 'ftp://example.com', 'Invalid URL'],
      ['Link', 'www.google,asdf', 'Invalid URL'],
    ])('does not accept a %s that does not fit, and says why once the field is left', (type, typed, message) => {
      renderForm();

      chooseType(type);
      fireEvent.change(value(type), { target: { value: typed } });
      fillUseful();
      fireEvent.click(screen.getByRole('checkbox', { name: /Speak to a person/ }));
      expect(screen.queryByText(message)).not.toBeInTheDocument();
      expect(addButton()).toBeDisabled();

      fireEvent.blur(value(type));
      expect(screen.getByText(message)).toBeInTheDocument();
      expect(addButton()).toBeDisabled();
    });

    it('says a scenario is needed once the rest is filled in, and when the last one is cleared', () => {
      const message = 'Select at least one scenario.';
      renderForm();

      chooseType('Email address');
      fireEvent.change(value('Email address'), { target: { value: 'help@example.com' } });
      expect(screen.queryByText(message)).not.toBeInTheDocument();

      fillUseful();
      expect(screen.getByText(message)).toBeInTheDocument();
      expect(addButton()).toBeDisabled();

      const scenario = screen.getByRole('checkbox', { name: /Speak to a person/ });
      fireEvent.click(scenario);
      expect(screen.queryByText(message)).not.toBeInTheDocument();
      expect(addButton()).toBeEnabled();

      fireEvent.click(scenario);
      expect(screen.getByText(message)).toBeInTheDocument();
    });

    it.each([
      ['Email address', 'Enter an email address.'],
      ['Phone number', 'Enter a phone number.'],
      ['Link', 'Enter a link.'],
      ['Question', 'Enter a question.'],
    ])('asks for the %s once it is left empty or cleared', (type, message) => {
      renderForm();

      chooseType(type);
      expect(screen.queryByText(message)).not.toBeInTheDocument();

      fireEvent.blur(value(type));
      expect(screen.getByText(message)).toBeInTheDocument();

      fireEvent.change(value(type), { target: { value: type === 'Phone number' ? '2025550100' : 'help@example.com' } });
      expect(screen.queryByText(message)).not.toBeInTheDocument();

      fireEvent.change(value(type), { target: { value: '' } });
      expect(screen.getByText(message)).toBeInTheDocument();
    });

    it('asks for the description once it is left empty or cleared', () => {
      const message = 'Describe what this resource offers.';
      renderForm();

      chooseType('Link');
      expect(screen.queryByText(message)).not.toBeInTheDocument();

      fireEvent.blur(value(useful));
      expect(screen.getByText(message)).toBeInTheDocument();

      fillUseful();
      expect(screen.queryByText(message)).not.toBeInTheDocument();

      fillUseful('');
      expect(screen.getByText(message)).toBeInTheDocument();
    });

    it('adds https:// to a link without a scheme when the field is left, and tidies an email address', () => {
      renderForm();

      chooseType('Link');
      fireEvent.change(value('Link'), { target: { value: ' help.example.com ' } });
      fireEvent.blur(value('Link'));
      expect(value('Link')).toHaveValue('https://help.example.com');
      expect(screen.queryByText('Invalid URL')).not.toBeInTheDocument();

      chooseType('Email address');
      fireEvent.change(value('Email address'), { target: { value: ' help@example.com ' } });
      fireEvent.blur(value('Email address'));
      expect(value('Email address')).toHaveValue('help@example.com');
    });

    it('lets a link without a scheme be saved before the field is left, as https', async () => {
      vi.mocked(createExternalResource).mockResolvedValue({} as ExternalResource);
      renderForm({ onSuccess: vi.fn() });

      chooseType('Link');
      fireEvent.change(value('Link'), { target: { value: 'help.example.com' } });
      fillUseful();
      fireEvent.click(screen.getByRole('checkbox', { name: /Speak to a person/ }));
      fireEvent.click(addButton());

      await waitFor(() => expect(createExternalResource).toHaveBeenCalledWith({
        params: expect.objectContaining({ resource_type: 'link', title: 'https://help.example.com' }),
      }));
    });

    it('takes any text as a question', () => {
      renderForm();

      chooseType('Question');
      fireEvent.change(value('Question'), { target: { value: 'Where do I vote?' } });
      fillUseful();
      fireEvent.click(screen.getByRole('checkbox', { name: /Speak to a person/ }));

      expect(addButton()).toBeEnabled();
    });

    it('needs what the resource is useful for, and saves it', async () => {
      vi.mocked(createExternalResource).mockResolvedValue({} as ExternalResource);
      const onSuccess = vi.fn();
      renderForm({ onSuccess });
      expect(screen.queryByRole('textbox', { name: useful })).not.toBeInTheDocument();

      chooseType('Link');
      fireEvent.change(value('Link'), { target: { value: 'https://help.example.com' } });
      fireEvent.click(screen.getByRole('checkbox', { name: /Speak to a person/ }));
      expect(addButton()).toBeDisabled();

      fillUseful('   ');
      expect(addButton()).toBeDisabled();

      fillUseful('Share when someone needs a person.');
      fireEvent.click(addButton());

      await waitFor(() => expect(onSuccess).toHaveBeenCalled());
      expect(createExternalResource).toHaveBeenCalledWith({
        params: expect.objectContaining({ description: 'Share when someone needs a person.' }),
      });
    });

    it('keeps a question to 200 characters, on one line, and counts them', async () => {
      renderForm();

      chooseType('Question');
      expect(await screen.findByText('0 / 200 characters')).toBeInTheDocument();
      expect(value('Question')).toHaveAttribute('maxlength', '200');
      expect(value('Question').tagName).toBe('INPUT');

      fireEvent.change(value('Question'), { target: { value: 'Where do I vote?' } });
      expect(screen.getByText('16 / 200 characters')).toBeInTheDocument();
    });

    it.each([
      ['Email address', true],
      ['Phone number', true],
      ['Link', true],
      ['Question', false],
    ])('keeps the browser from offering the person’s own details for the %s, and from correcting it: %s', (type, isNotWords) => {
      renderForm();

      chooseType(type);

      expect(value(type)).toHaveAttribute('autocomplete', 'off');
      if (isNotWords) {
        expect(value(type)).toHaveAttribute('spellcheck', 'false');
      } else {
        expect(value(type)).not.toHaveAttribute('spellcheck', 'false');
      }
    });

    it('puts the cursor in the field of a type chosen with a pointer, but not one chosen with the keyboard', () => {
      renderForm();

      fireEvent.pointerDown(typeRadio('Link'));
      fireEvent.click(typeRadio('Link'));
      expect(value('Link')).toHaveFocus();

      // The arrow keys choose each type in turn, so focus stays where they are
      const radio = typeRadio('Question');
      radio.focus();
      fireEvent.keyDown(radio, { key: 'ArrowDown' });
      fireEvent.click(radio);
      expect(value('Question')).not.toHaveFocus();
      expect(radio).toHaveFocus();
    });

    it('keeps what a resource is useful for to 500 characters, and counts them', async () => {
      renderForm();

      chooseType('Link');
      expect(await screen.findByText('0 / 500 characters')).toBeInTheDocument();
      expect(value(useful)).toHaveAttribute('maxlength', '500');

      fillUseful('Share it.');
      expect(screen.getByText('9 / 500 characters')).toBeInTheDocument();
    });

    it('clears what was typed when the type changes', () => {
      renderForm();

      chooseType('Link');
      fireEvent.change(value('Link'), { target: { value: 'https://help.example.com' } });
      chooseType('Question');

      expect(value('Question')).toHaveValue('');
    });
  });

  describe('choosing scenarios', () => {
    it('chooses just the scenarios of a quick select, which is on only while they are all that is selected', () => {
      renderForm();
      chooseType('Link');
      const chip = (pressed: boolean) => screen.getByRole('button', { name: 'Introductions', pressed });
      const checkbox = (name: RegExp) => screen.getByRole('checkbox', { name });

      fireEvent.click(checkbox(/Speak to a person/));
      fireEvent.click(chip(false));
      expect(checkbox(/Welcome/)).toBeChecked();
      expect(checkbox(/When describing what the chatbot can do/)).toBeChecked();
      expect(checkbox(/Speak to a person/)).not.toBeChecked();

      fireEvent.click(checkbox(/Error occurred/));
      expect(chip(false)).toBeInTheDocument();

      fireEvent.click(checkbox(/Error occurred/));
      fireEvent.click(chip(true));
      expect(checkbox(/Welcome/)).not.toBeChecked();
      expect(checkbox(/When describing what the chatbot can do/)).not.toBeChecked();
    });

    it('keeps what a scenario means out of the way until asked for', () => {
      renderForm();
      chooseType('Link');
      const info = screen.getByRole('button', { name: /More information Speak to a person/ });
      const meaning = /would like to speak to a human/;

      expect(screen.queryByText(meaning)).not.toBeInTheDocument();
      expect(info).toHaveAttribute('aria-expanded', 'false');

      fireEvent.click(info);
      expect(screen.getByText(meaning)).toBeInTheDocument();
      expect(info).toHaveAttribute('aria-expanded', 'true');
      expect(screen.getByRole('checkbox', { name: /Speak to a person/ })).not.toBeChecked();

      fireEvent.click(info);
      expect(screen.queryByText(meaning)).not.toBeInTheDocument();
    });

    it('says how long a conversation waits before it closes, once that is known', async () => {
      vi.mocked(fetchAbout).mockResolvedValue({ ...limits, conversation_inactivity_timeout_minutes: 10 } as About);
      renderForm();
      chooseType('Link');

      fireEvent.click(screen.getByRole('button', { name: /More information End of conversation/ }));

      expect(await screen.findByText(/no new end-user messages in 10 minutes/)).toBeInTheDocument();
    });
  });

  describe('reading what the scenarios mean', () => {
    it('shows or hides every description at once', () => {
      renderForm();
      chooseType('Link');

      expect(screen.queryByText(/would like to speak to a human/)).not.toBeInTheDocument();

      fireEvent.click(screen.getByRole('button', { name: 'Show descriptions' }));
      expect(screen.getByText(/would like to speak to a human/)).toBeInTheDocument();
      expect(screen.getByText(/very first message/)).toBeInTheDocument();

      fireEvent.click(screen.getByRole('button', { name: 'Hide descriptions' }));
      expect(screen.queryByText(/would like to speak to a human/)).not.toBeInTheDocument();
    });
  });

  describe('editing a saved one', () => {
    const props = { resource, hasSavedValue: true };

    it('keeps save off and hides discard until something changes', () => {
      renderForm(props);

      expect(value('Link')).toHaveValue('https://help.example.com');
      expect(value(useful)).toHaveValue('For people who want a person.');
      expect(screen.getByRole('button', { name: 'Save resource' })).toBeDisabled();
      expect(screen.queryByRole('button', { name: 'Discard changes' })).not.toBeInTheDocument();
    });

    it('asks for the description from the start when the saved resource has none, and not when it has one', () => {
      const message = 'Describe what this resource offers.';
      const { unmount } = renderForm(props);
      expect(screen.queryByText(message)).not.toBeInTheDocument();
      unmount();

      renderForm({ ...props, resource: { ...resource, description: '' } });
      expect(screen.getByText(message)).toBeInTheDocument();

      fillUseful();
      expect(screen.queryByText(message)).not.toBeInTheDocument();
    });

    it('needs a description saved longer than is allowed to be shortened, even for another change', async () => {
      renderForm({ ...props, resource: { ...resource, description: 'a'.repeat(501) } });
      await screen.findByText('501 / 500 characters');

      fireEvent.click(screen.getByRole('checkbox', { name: /Error occurred/ }));
      expect(screen.getByRole('button', { name: 'Save resource' })).toBeDisabled();

      fillUseful('a'.repeat(500));
      expect(screen.getByRole('button', { name: 'Save resource' })).toBeEnabled();
    });

    it('does not offer to change the type, which the field is named for', () => {
      renderForm(props);

      expect(screen.queryByRole('group', { name: 'What kind of resource are you adding?' })).not.toBeInTheDocument();
      expect(screen.queryByRole('radio')).not.toBeInTheDocument();
    });

    it('guesses the type of one saved before types were kept, and treats the rest as a question', () => {
      const { unmount } = renderForm({ ...props, resource: { ...resource, resource_type: undefined, title: 'help@example.com' } });
      expect(value('Email address')).toHaveValue('help@example.com');
      unmount();

      renderForm({ ...props, resource: { ...resource, resource_type: undefined, title: 'Help line' } });
      expect(value('Question')).toHaveValue('Help line');
    });

    it('needs a description to save one saved without, even for another change', () => {
      renderForm({ ...props, resource: { ...resource, description: undefined } });

      fireEvent.click(screen.getByRole('checkbox', { name: /Error occurred/ }));
      expect(screen.getByRole('button', { name: 'Save resource' })).toBeDisabled();

      fillUseful();
      expect(screen.getByRole('button', { name: 'Save resource' })).toBeEnabled();
    });

    it('edits a saved phone number as the number in its country', () => {
      renderForm({ ...props, resource: { ...resource, resource_type: 'phone', title: '+12025550100' } });

      expect(value('Phone number')).toHaveValue('2025550100');
    });

    it('saves the type with the changes', async () => {
      vi.mocked(updateExternalResource).mockResolvedValue({} as ExternalResource);
      const onSuccess = vi.fn();
      renderForm({ ...props, onSuccess });

      fireEvent.change(value('Link'), { target: { value: 'https://other.example.com' } });
      fireEvent.click(screen.getByRole('button', { name: 'Save resource' }));

      await waitFor(() => expect(onSuccess).toHaveBeenCalled());
      expect(updateExternalResource).toHaveBeenCalledWith({
        resourceId: 5,
        params: { resource_type: 'link', title: 'https://other.example.com', description: 'For people who want a person.', scenarios: ['speak_to_person'] },
      });
    });

    it('goes back to what was saved on discard, staying on the form', () => {
      const onCancel = vi.fn();
      renderForm({ ...props, onCancel });

      fireEvent.change(value('Link'), { target: { value: 'https://other.example.com' } });
      fireEvent.click(screen.getByRole('checkbox', { name: /Error occurred/ }));
      expect(screen.getByRole('button', { name: 'Save resource' })).toBeEnabled();

      fireEvent.click(screen.getByRole('button', { name: 'Discard changes' }));

      expect(value('Link')).toHaveValue('https://help.example.com');
      expect(screen.getByRole('checkbox', { name: /Error occurred/ })).not.toBeChecked();
      expect(screen.getByRole('button', { name: 'Save resource' })).toBeDisabled();
      expect(screen.queryByRole('button', { name: 'Discard changes' })).not.toBeInTheDocument();
      expect(onCancel).not.toHaveBeenCalled();
    });

    it('is not changed by choosing the same scenarios again', () => {
      renderForm(props);

      fireEvent.click(screen.getByRole('checkbox', { name: /Error occurred/ }));
      fireEvent.click(screen.getByRole('checkbox', { name: /Error occurred/ }));

      expect(screen.getByRole('button', { name: 'Save resource' })).toBeDisabled();
    });
  });
});
