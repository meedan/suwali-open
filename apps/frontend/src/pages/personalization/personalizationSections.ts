import { defineMessages, type MessageDescriptor } from 'react-intl';

import type { Capabilities, Hub } from '@customTypes/hub';

import { getPersonalizationIcon } from '@helpers/source';

import { hubHasFeature } from '@components/FeatureFlag';

export type PersonalizationSectionId = 'chatbotName' | 'roleDescription' | 'responseStyle' | 'availableLanguages' | 'externalResource';

export type PersonalizationSection = {
  id: PersonalizationSectionId;
  // What the section is called in a URL
  slug: string;
  group: 'identity' | 'behavior' | 'resources';
  // The icon that stands for the section
  icon: string;
  label: MessageDescriptor;
  // What the setting is called where it stands for several things, such as on the overview and the page listing them
  pluralLabel?: MessageDescriptor;
  // The label once it is set, for sections that can only be set once. Resources can always have another.
  addedLabel?: MessageDescriptor;
  // Who can change the section
  action: keyof Capabilities;
  // Keeps the section hidden until the hub has this feature flag, so new settings can ship before they are ready
  flag?: string;
  isConfigured?: (hub?: Hub | null) => boolean;
  // Whether a value has actually been saved, for settings that count as set up before one is (they have a default)
  hasValue?: (hub?: Hub | null) => boolean;
};

export const personalizationMessages = defineMessages({
  chatbotName: {
    id: 'global.chatbotNameLabel',
    defaultMessage: 'Chatbot name',
    description: 'Label for chatbot name',
  },
  chatbotNameAdded: {
    id: 'global.chatbotNameAddedLabel',
    defaultMessage: 'Chatbot name <small>{icon} added!</small>',
    description: 'Label for chatbot name after its been already configured',
  },
  roleDescription: {
    id: 'global.roleDescriptionLabel',
    defaultMessage: 'Role & description',
    description: 'Label for role & description personalization',
  },
  roleDescriptionAdded: {
    id: 'global.roleDescriptionAddedLabel',
    defaultMessage: 'Role & description <small>{icon} added!</small>',
    description: 'Label for chatbot role and description after its been already configured',
  },
  responseStyle: {
    id: 'global.responseStyleLabel',
    defaultMessage: 'Response style & tone',
    description: 'Label for response style & tone',
  },
  responseStyleAdded: {
    id: 'global.responseStyleAddedLabel',
    defaultMessage: 'Response style & tone <small>{icon} added!</small>',
    description: 'Label for chatbot role and description after its been already configured',
  },
  availableLanguages: {
    id: 'global.availableLanguagesLabel',
    defaultMessage: 'Available languages',
    description: 'Label for available languages personalization setting',
  },
  availableLanguagesAdded: {
    id: 'global.availableLanguagesAddedLabel',
    defaultMessage: 'Available languages <small>{icon} added!</small>',
    description: 'Label for available languages after it’s been already configured',
  },
  resource: {
    id: 'global.resource',
    defaultMessage: 'Resource',
    description: 'Menu option for adding resource personalization',
  },
  resources: {
    id: 'global.personalizationResources',
    defaultMessage: 'Contacts, links & questions',
    description: 'Name of the resources setting where it stands for all of them, in the list of personalization settings on the overview and as the title of the page listing them. Names the kinds of resource: email addresses and phone numbers, links, and questions',
  },
});

// The headings the settings are grouped under, in the sidebar and on the overview
export const personalizationGroupMessages = defineMessages({
  identity: {
    id: 'global.personalizationGroupIdentity',
    defaultMessage: 'Identity',
    description: 'Heading in the personalization sidebar for who the chatbot is, such as its name and role',
  },
  behavior: {
    id: 'global.personalizationGroupBehavior',
    defaultMessage: 'Behavior',
    description: 'Heading in the personalization sidebar for how the chatbot responds, such as its tone and languages',
  },
  resources: {
    id: 'global.resources',
    defaultMessage: 'Resources',
    description: 'Generic header or label for resources available to the chatbot',
  },
});

// Every setting an admin can give the chatbot, in the order they are offered. Adding a setting starts
// here: the sidebar, the routes and the add menu all read from this list.
export const personalizationSections: PersonalizationSection[] = [
  {
    id: 'chatbotName',
    slug: 'name',
    group: 'identity',
    icon: getPersonalizationIcon('name'),
    label: personalizationMessages.chatbotName,
    addedLabel: personalizationMessages.chatbotNameAdded,
    action: 'UPDATE_HUB',
    isConfigured: hub => Boolean(hub?.bot_attributes?.name),
  },
  {
    id: 'roleDescription',
    slug: 'role',
    group: 'identity',
    icon: getPersonalizationIcon('description'),
    label: personalizationMessages.roleDescription,
    addedLabel: personalizationMessages.roleDescriptionAdded,
    action: 'UPDATE_HUB',
    isConfigured: hub => Boolean(hub?.bot_attributes?.description),
  },
  {
    id: 'responseStyle',
    slug: 'tone',
    group: 'behavior',
    icon: getPersonalizationIcon('tone'),
    label: personalizationMessages.responseStyle,
    addedLabel: personalizationMessages.responseStyleAdded,
    action: 'UPDATE_HUB',
    // Without a chosen tone the chatbot uses the default one, so the section counts as set up either way
    isConfigured: () => true,
    hasValue: hub => Boolean(hub?.bot_attributes?.tone),
  },
  {
    id: 'availableLanguages',
    slug: 'languages',
    group: 'behavior',
    icon: getPersonalizationIcon('languages'),
    label: personalizationMessages.availableLanguages,
    addedLabel: personalizationMessages.availableLanguagesAdded,
    action: 'UPDATE_HUB',
    // Without a choice the chatbot responds in all languages, so the section counts as set up either way
    isConfigured: () => true,
    hasValue: hub => Boolean(hub?.bot_attributes?.default_language || hub?.bot_attributes?.supported_languages),
  },
  {
    id: 'externalResource',
    slug: 'resources',
    group: 'resources',
    icon: 'arrow_square_out',
    label: personalizationMessages.resource,
    pluralLabel: personalizationMessages.resources,
    action: 'MANAGE_EXTERNAL_RESOURCE',
  },
];

// The sections a hub has available: those without a feature flag, and those whose flag the hub has
export const availablePersonalizationSections = (hub?: Hub | null): PersonalizationSection[] =>
  personalizationSections.filter(section => !section.flag || (Boolean(hub) && hubHasFeature(hub!, section.flag)));

// Whether a section has been given anything: an attribute that is set, or at least one resource
export const isSectionSetUp = (section: PersonalizationSection, hub?: Hub | null, resourceCount = 0): boolean =>
  section.id === 'externalResource' ? resourceCount > 0 : Boolean(section.isConfigured?.(hub));
