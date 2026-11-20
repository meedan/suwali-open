import { type CountryCode, getCountryCallingCode, parsePhoneNumberFromString } from 'libphonenumber-js';
import { defineMessages } from 'react-intl';

import type { ResourceType } from '@customTypes/external-resource';

import { normalizeUrl } from './forms';

export const resourceTypes: ResourceType[] = ['email', 'phone', 'link', 'question'];

export const resourceTypeLabels = defineMessages({
  email: {
    id: 'global.resourceTypeEmailLabel',
    defaultMessage: 'Email address',
    description: 'Label for the email address type of external resource',
  },
  phone: {
    id: 'global.resourceTypePhoneLabel',
    defaultMessage: 'Phone number',
    description: 'Label for the phone number type of external resource',
  },
  link: {
    id: 'global.resourceTypeLinkLabel',
    defaultMessage: 'Link',
    description: 'Label for the link, or web address, type of external resource',
  },
  question: {
    id: 'global.resourceTypeQuestionLabel',
    defaultMessage: 'Question',
    description: 'Label for the question type of external resource, which is free text',
  },
});

const resourceTypeIcons: Record<ResourceType, string> = {
  email: 'envelope',
  phone: 'phone',
  link: 'link',
  question: 'question',
};

// Resources saved before their type was stored have only a title, so what they are is guessed from it
export const detectResourceType = (title: string): ResourceType | undefined => {
  if (title.includes('@') || title.toLowerCase().includes('email')) {
    return 'email';
  }
  // Phone number patterns, e.g. +1-555-0100, (555) 555-5555, 555-555-5555
  if (/[\d\s()+-]{7,}/.test(title) || title.toLowerCase().includes('phone') || title.toLowerCase().includes('tel')) {
    return 'phone';
  }
  if (title.includes('http://') || title.includes('https://') || title.includes('www.')) {
    return 'link';
  }
  return undefined;
};

// The icon of a resource, by its type, or by what its title looks like while it has none. Those that look like nothing in particular are taken for questions, as they are when backfilled.
export const getResourceIcon = ({ resource_type, title }: { resource_type?: ResourceType; title: string }): string => {
  return resourceTypeIcons[resource_type ?? detectResourceType(title) ?? 'question'];
};

export const isValidEmail = (value: string): boolean => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);

// The number as digits in a country, which is what is typed after the country's dial code
const parsePhone = (digits: string, country: CountryCode) => (
  parsePhoneNumberFromString(`+${getCountryCallingCode(country)}${digits.replace(/\D/g, '')}`)
);

export const isValidPhone = (digits: string, country: CountryCode): boolean => Boolean(parsePhone(digits, country)?.isValid());

// What is saved as the resource's title for a value typed as a type of resource, or nothing while the value is not valid.
// A phone number is saved in full international form (E.164), such as "+15551234567", whatever country it was typed for.
// A question longer than maxQuestionLength is not valid; with no maxQuestionLength yet, only the server limits it
export const normalizeResourceValue = (type: ResourceType, value: string, country: CountryCode, maxQuestionLength?: number): string | null => {
  const trimmed = value.trim();
  if (!trimmed) return null;

  switch (type) {
    case 'email':
      return isValidEmail(trimmed) ? trimmed : null;
    case 'link':
      return normalizeUrl(trimmed);
    case 'phone': {
      const phone = parsePhone(trimmed, country);
      return phone?.isValid() ? phone.number : null;
    }
    default:
      return maxQuestionLength === undefined || trimmed.length <= maxQuestionLength ? trimmed : null;
  }
};

// A saved phone number split back into the country picked and the number typed there, to edit it again
export const splitPhone = (title: string): { country: CountryCode; national: string } | null => {
  const phone = parsePhoneNumberFromString(title);
  return phone?.country ? { country: phone.country, national: phone.nationalNumber } : null;
};
