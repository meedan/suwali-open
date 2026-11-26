import { defineMessages, type MessageDescriptor } from 'react-intl';

import type { Scenario } from '@customTypes/external-resource';

const messages = defineMessages({
  roleDescriptionLabel: {
    id: 'global.roleDescriptionScenarioLabel',
    defaultMessage: 'When describing what the chatbot can do',
    description: 'Label for the scenario where the chatbot describes its purpose and what the user can ask it. Not the same as the Role & description personalization section',
  },
  errorOccurredLabel: {
    id: 'global.errorOccurredLabel',
    defaultMessage: 'Error occurred',
    description: 'Label for error occurred scenario',
  },
  unanswerableQuestionLabel: {
    id: 'global.unanswerableQuestionsLabel',
    defaultMessage: 'Unanswerable questions',
    description: 'Label for unanswerable questions scenario',
  },
  firstMessageLabel: {
    id: 'global.firstMessageLabel',
    defaultMessage: 'Welcome / First end-user message',
    description: 'Label for first message scenario',
  },
  speakToPersonLabel: {
    id: 'global.speakToPersonLabel',
    defaultMessage: 'Speak to a person',
    description: 'Label for speak to a person scenario',
  },
  purchaseSubscribeLabel: {
    id: 'global.purchaseSubscribeLabel',
    defaultMessage: 'Purchase or subscribe to services',
    description: 'Label for purchase or subscribe scenario',
  },
  conversationClosedLabel: {
    id: 'global.conversationClosedLabel',
    defaultMessage: 'End of conversation',
    description: 'Label for the scenario where a conversation is closed after a period with no new messages from the user',
  },
});

// Every scenario an external resource can be offered in, in the order they are presented
export const scenarios: Scenario[] = ['first_message', 'role_description', 'unanswerable_question', 'error_occurred', 'speak_to_person', 'purchase_subscribe', 'conversation_closed'];

export const scenarioLabels: Record<Scenario, MessageDescriptor> = {
  role_description: messages.roleDescriptionLabel,
  unanswerable_question: messages.unanswerableQuestionLabel,
  error_occurred: messages.errorOccurredLabel,
  first_message: messages.firstMessageLabel,
  speak_to_person: messages.speakToPersonLabel,
  purchase_subscribe: messages.purchaseSubscribeLabel,
  conversation_closed: messages.conversationClosedLabel,
};

const descriptions = defineMessages({
  roleDescription: {
    id: 'global.roleDescriptionDescription',
    defaultMessage: 'When the chatbot describes its purpose or what kind of things the end-user can ask about, it will include this resource.',
    description: 'Description for role description field',
  },
  unanswerableQuestions: {
    id: 'global.unanswerableQuestionsDescription',
    defaultMessage: 'When the chatbot cannot come up with an answer to a question it will include this resource in the response to the end-user.',
    description: 'Description for unanswerable questions scenario',
  },
  errorOccurred: {
    id: 'global.errorOccurredDescription',
    defaultMessage: 'When an error occurs from the system the chatbot will include this resource in the response to the end-user.',
    description: 'Description for error occurred scenario',
  },
  firstMessage: {
    id: 'global.firstMessageDescription',
    defaultMessage: 'When an end-user sends their very first message in a new conversation the chatbot will include this resource in the welcome response.',
    description: 'Description for first message scenario',
  },
  speakToPerson: {
    id: 'global.speakToPersonDescription',
    defaultMessage: 'When the end-user indicates that they would like to speak to a human, the chatbot will include this resource in the response to the end-user.',
    description: 'Description for speak to a person scenario',
  },
  purchaseSubscribe: {
    id: 'global.purchaseSubscribeDescription',
    defaultMessage: 'When the end-user indicates that they are interested in buying or subscribing to products or services provided by your organization, the chatbot will include this resource in the response to the end-user.',
    description: 'Description for purchase or subscribe scenario',
  },
  conversationClosed: {
    id: 'global.conversationClosedDescription',
    defaultMessage: '{minutes, plural, one {When a conversation concludes because there have been no new end-user messages in # minute, include this resource in the close of conversation message.} other {When a conversation concludes because there have been no new end-user messages in # minutes, include this resource in the close of conversation message.}}',
    description: 'Description for the conversation closed scenario. {minutes} is how long the chatbot waits without new messages from the user before closing the conversation',
  },
});

export const scenarioDescriptions: Record<Scenario, MessageDescriptor> = {
  role_description: descriptions.roleDescription,
  unanswerable_question: descriptions.unanswerableQuestions,
  error_occurred: descriptions.errorOccurred,
  first_message: descriptions.firstMessage,
  speak_to_person: descriptions.speakToPerson,
  purchase_subscribe: descriptions.purchaseSubscribe,
  conversation_closed: descriptions.conversationClosed,
};

const shortcutMessages = defineMessages({
  introductions: {
    id: 'global.scenarioShortcutIntroductions',
    defaultMessage: 'Introductions',
    description: 'Label of the quick select button that chooses the external resource scenarios where the chatbot introduces itself to the user',
  },
  userRequests: {
    id: 'global.scenarioShortcutUserRequests',
    defaultMessage: 'End-user requests',
    description: 'Label of the quick select button that chooses the external resource scenarios where the user asks to speak to a person or to buy or subscribe',
  },
  closings: {
    id: 'global.scenarioShortcutClosings',
    defaultMessage: 'Closings',
    description: 'Label of the quick select button that chooses the external resource scenarios where the chatbot closes a conversation',
  },
  cantHelp: {
    id: 'global.scenarioShortcutCantHelp',
    defaultMessage: 'Can’t help',
    description: 'Label of the quick select button that chooses the external resource scenarios where the chatbot has no answer or something went wrong',
  },
});

export type ScenarioGroup = {
  id: string;
  label: MessageDescriptor;
  scenarios: Scenario[];
};

// How the scenarios are grouped for the quick select buttons when choosing them for a resource. Every scenario belongs to exactly one group, so
// a new scenario needs adding both to the list above and here, or it can't be chosen in the form.
export const scenarioGroups: ScenarioGroup[] = [
  { id: 'introductions', label: shortcutMessages.introductions, scenarios: ['first_message', 'role_description'] },
  { id: 'user_requests', label: shortcutMessages.userRequests, scenarios: ['speak_to_person', 'purchase_subscribe'] },
  { id: 'cant_help', label: shortcutMessages.cantHelp, scenarios: ['unanswerable_question', 'error_occurred'] },
  { id: 'closings', label: shortcutMessages.closings, scenarios: ['conversation_closed'] },
];
