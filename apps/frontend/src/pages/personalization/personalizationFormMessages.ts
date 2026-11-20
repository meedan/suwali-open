import { defineMessages } from 'react-intl';

// What the forms for a single personalization setting have in common
export const personalizationFormMessages = defineMessages({
  resourceEmailRequired: {
    id: 'global.resourceEmailRequired',
    defaultMessage: 'Enter an email address.',
    description: 'Error shown under the email address of an external resource when it has been left empty',
  },
  resourcePhoneRequired: {
    id: 'global.resourcePhoneRequired',
    defaultMessage: 'Enter a phone number.',
    description: 'Error shown under the phone number of an external resource when it has been left empty',
  },
  resourceLinkRequired: {
    id: 'global.resourceLinkRequired',
    defaultMessage: 'Enter a link.',
    description: 'Error shown under the link, or web address, of an external resource when it has been left empty',
  },
  resourceQuestionRequired: {
    id: 'global.resourceQuestionRequired',
    defaultMessage: 'Enter a question.',
    description: 'Error shown under the question of an external resource when it has been left empty',
  },
  resourceDescriptionRequired: {
    id: 'global.resourceDescriptionRequired',
    defaultMessage: 'Describe what this resource offers.',
    description: 'Error shown under the description of an external resource when it has been left empty',
  },
  resourceScenarioRequired: {
    id: 'global.resourceScenarioRequired',
    defaultMessage: 'Select at least one scenario.',
    description: 'Error shown under the scenarios of an external resource when none is selected, which is why it cannot be saved yet',
  },
  chatbotNameAdd: {
    id: 'global.addChatbotName',
    defaultMessage: 'Add name',
    description: 'Label for the button that sets the chatbot’s name for the first time, on its own page',
  },
  chatbotNameSave: {
    id: 'global.saveChatbotName',
    defaultMessage: 'Save name',
    description: 'Label for the button that saves changes to the chatbot’s name, on its own page',
  },
  roleDescriptionAdd: {
    id: 'global.addRoleDescription',
    defaultMessage: 'Add role & description',
    description: 'Label for the button that sets role & description for the first time, on its own page',
  },
  roleDescriptionSave: {
    id: 'global.saveRoleDescription',
    defaultMessage: 'Save role & description',
    description: 'Label for the button that saves changes to role & description, on its own page',
  },
  responseStyleAdd: {
    id: 'global.addResponseStyle',
    defaultMessage: 'Add response style & tone',
    description: 'Label for the button that sets response style & tone for the first time, on its own page',
  },
  responseStyleSave: {
    id: 'global.saveResponseStyle',
    defaultMessage: 'Save response style & tone',
    description: 'Label for the button that saves changes to response style & tone, on its own page',
  },
  availableLanguagesAdd: {
    id: 'global.addAvailableLanguages',
    defaultMessage: 'Add languages',
    description: 'Label for the button that sets available languages for the first time, on its own page',
  },
  availableLanguagesSave: {
    id: 'global.saveAvailableLanguages',
    defaultMessage: 'Save languages',
    description: 'Label for the button that saves changes to available languages, on its own page',
  },
  removeTitle: {
    id: 'global.confirmDeletePersonalizationTitle',
    defaultMessage: 'Remove personalization?',
    description: 'Title for confirmation dialog before removing a bot attribute',
  },
  removeConfirm: {
    id: 'global.confirmDeletePersonalizationButton',
    defaultMessage: 'Remove personalization',
    description: 'Button label for confirming deletion of bot attribute',
  },
});
